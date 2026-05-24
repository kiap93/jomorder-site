import { MutationJob } from '../types';

export interface OfflineOrder {
  id: string;
  table_id?: string;
  status: string;
  total_amount?: number;
  items?: any[];
  p_session_id?: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface OfflineTable {
  id: string;
  name: string;
  status: 'vacant' | 'active' | 'reserved';
  seating_capacity?: number;
  current_session_id?: string;
  updated_at: string;
  version: number;
}

export interface OfflineCartItem {
  id: string;
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  selection: any;
  subtotal: number;
  notes?: string;
}

export interface OfflineMutation {
  id: string;
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
  retry_count: number;
  status: 'pending' | 'failed' | 'processing';
  created_at: number;
  priority: number;
  description?: string;
  rollback_data?: any; // To allow reverting UI states if recovery is impossible
}

export class IndexedDbRepository {
  private dbName = 'pos_offline_db';
  private version = 2;
  private db: IDBDatabase | null = null;

  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('orders')) {
          db.createObjectStore('orders', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('tables')) {
          db.createObjectStore('tables', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('cart')) {
          db.createObjectStore('cart', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('mutations')) {
          db.createObjectStore('mutations', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('mutation_jobs')) {
          db.createObjectStore('mutation_jobs', { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject(new Error(`Failed to initialize IndexedDB: ${(event.target as IDBOpenDBRequest).error?.message}`));
      };
    });
  }

  private async getStore(storeName: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.init();
    const transaction = db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  // --- Orders ---
  async saveOrders(orders: OfflineOrder[]): Promise<void> {
    const store = await this.getStore('orders', 'readwrite');
    for (const order of orders) {
      store.put(order);
    }
  }

  async getOrders(): Promise<OfflineOrder[]> {
    const store = await this.getStore('orders', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getOrder(id: string): Promise<OfflineOrder | null> {
    const store = await this.getStore('orders', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteOrder(id: string): Promise<void> {
    const store = await this.getStore('orders', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Tables ---
  async saveTables(tables: OfflineTable[]): Promise<void> {
    const store = await this.getStore('tables', 'readwrite');
    for (const table of tables) {
      store.put(table);
    }
  }

  async getTables(): Promise<OfflineTable[]> {
    const store = await this.getStore('tables', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // --- Cart/Basket ---
  async saveCart(cart: OfflineCartItem[]): Promise<void> {
    const store = await this.getStore('cart', 'readwrite');
    // Clear first to keep fresh state, or overwrite
    await this.clearCart();
    for (const item of cart) {
      store.put(item);
    }
  }

  async getCart(): Promise<OfflineCartItem[]> {
    const store = await this.getStore('cart', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async clearCart(): Promise<void> {
    const store = await this.getStore('cart', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Pending Mutations ---
  async saveMutation(mutation: OfflineMutation): Promise<void> {
    const store = await this.getStore('mutations', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(mutation);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMutations(): Promise<OfflineMutation[]> {
    const store = await this.getStore('mutations', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const mutations = request.result || [];
        // Sort by priority (descending) and createdTime (ascending)
        mutations.sort((a, b) => {
          if (b.priority !== a.priority) {
            return b.priority - a.priority;
          }
          return a.created_at - b.created_at;
        });
        resolve(mutations);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteMutation(id: string): Promise<void> {
    const store = await this.getStore('mutations', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // --- Mutation Jobs ---
  async saveMutationJob(job: MutationJob): Promise<void> {
    const store = await this.getStore('mutation_jobs', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(job);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async saveMutationJobs(jobs: MutationJob[]): Promise<void> {
    const store = await this.getStore('mutation_jobs', 'readwrite');
    for (const job of jobs) {
      store.put(job);
    }
  }

  async getMutationJobs(): Promise<MutationJob[]> {
    const store = await this.getStore('mutation_jobs', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const jobs: MutationJob[] = request.result || [];
        // Sort payments first, then orders, then baskets.
        // We can do sync priorities based on entity type: payment > order > basket
        const priorityScore = (entity: string) => {
          if (entity === 'payment') return 3;
          if (entity === 'order') return 2;
          return 1;
        };
        jobs.sort((a, b) => {
          const pA = priorityScore(a.entity);
          const pB = priorityScore(b.entity);
          if (pA !== pB) return pB - pA; // Descending priority
          return a.createdAt - b.createdAt; // Ascending time
        });
        resolve(jobs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteMutationJob(id: string): Promise<void> {
    const store = await this.getStore('mutation_jobs', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clearAllData(): Promise<void> {
    const stores = ['orders', 'tables', 'cart', 'mutations', 'mutation_jobs'];
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(stores, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const s of stores) {
        transaction.objectStore(s).clear();
      }
    });
  }
}
