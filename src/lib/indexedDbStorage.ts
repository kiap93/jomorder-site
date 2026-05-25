export class IndexedDbStorage {
  private dbName = 'session_storage_db';
  private storeName = 'kv_store';
  private version = 1;
  private dbPromise: Promise<IDBDatabase> | null = null;

  private init(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };
      request.onerror = (event) => {
        this.dbPromise = null;
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
    return this.dbPromise;
  }

  async getItem<T = any>(key: string): Promise<T | null> {
    try {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(key);
        request.onsuccess = () => {
          resolve(request.result !== undefined ? request.result as T : null);
        };
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error(`IndexedDbStorage failed to getItem for key ${key}:`, err);
      return null;
    }
  }

  async setItem<T = any>(key: string, value: T): Promise<void> {
    try {
      const db = await this.init();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.put(value, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error(`IndexedDbStorage failed to setItem for key ${key}:`, err);
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      const db = await this.init();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error(`IndexedDbStorage failed to removeItem for key ${key}:`, err);
    }
  }

  async keys(): Promise<string[]> {
    try {
      const db = await this.init();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.getAllKeys();
        request.onsuccess = () => resolve((request.result || []) as string[]);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('IndexedDbStorage failed to get keys:', err);
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      const db = await this.init();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(this.storeName, 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      console.error('IndexedDbStorage failed to clear:', err);
    }
  }
}

export const indexedDbStorage = new IndexedDbStorage();
