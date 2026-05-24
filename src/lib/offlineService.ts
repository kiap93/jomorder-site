import { IndexedDbRepository, OfflineOrder, OfflineTable, OfflineCartItem, OfflineMutation } from './indexedDbRepository';
import { NetworkMonitor, networkMonitorInstance } from './networkMonitor';
import { QueueProcessor, QueueStatus } from './queueProcessor';
import { SyncService } from './syncService';
import { MutationJob } from '../types';

class OfflineService {
  public repository: IndexedDbRepository;
  public networkMonitor: NetworkMonitor;
  public queueProcessor: QueueProcessor;
  public syncService: SyncService;

  // Layer 1: Memory Cache Layer
  private ordersMemoryCache = new Map<string, OfflineOrder>();
  private tablesMemoryCache = new Map<string, OfflineTable>();
  private cartMemoryCache: OfflineCartItem[] = [];

  constructor() {
    this.repository = new IndexedDbRepository();
    this.networkMonitor = networkMonitorInstance;
    this.queueProcessor = new QueueProcessor(this.repository, this.networkMonitor);
    this.syncService = new SyncService(this.repository, this.networkMonitor, this.queueProcessor);

    this.repository.init().then(async () => {
      console.log('[OfflineService] Initialized Offline-First architecture correctly.');
      // Warm up Memory Cache from IndexedDB
      await this.warmUpMemoryCache();
    }).catch(err => {
      console.error('[OfflineService] IndexedDB failure during initialization:', err);
    });
  }

  /**
   * Warm up Layer 1 Memory Cache with persisted Layer 2 data on startup
   */
  private async warmUpMemoryCache(): Promise<void> {
    try {
      const orders = await this.repository.getOrders();
      for (const order of orders) {
        this.ordersMemoryCache.set(order.id, order);
      }

      const tables = await this.repository.getTables();
      for (const table of tables) {
        this.tablesMemoryCache.set(table.id, table);
      }

      const cart = await this.repository.getCart();
      this.cartMemoryCache = cart;

      console.log('[OfflineService] Memory Cache (Layer 1) warmed up successfully.');
    } catch (err) {
      console.error('[OfflineService] Failed to warm up memory cache:', err);
    }
  }

  // Connectivity
  subscribeConnectivity(callback: (isOnline: boolean) => void): () => void {
    return this.networkMonitor.subscribe(callback);
  }

  get isOnline(): boolean {
    return this.networkMonitor.isOnline;
  }

  // Queue and Sync Subscription
  subscribeQueueStatus(callback: (status: QueueStatus) => void): () => void {
    return this.queueProcessor.subscribe(callback);
  }

  async forceSyncAll(): Promise<void> {
    await this.queueProcessor.forceRetryAll();
  }

  async getMutations(): Promise<OfflineMutation[]> {
    return this.repository.getMutations();
  }

  async discardMutation(id: string): Promise<void> {
    await this.queueProcessor.discardMutation(id);
  }

  // Direct state read/write (Layer 1 reads first, falls back to Layer 2)
  async getLocalOrders(): Promise<OfflineOrder[]> {
    if (this.ordersMemoryCache.size > 0) {
      return Array.from(this.ordersMemoryCache.values());
    }
    const orders = await this.repository.getOrders();
    for (const order of orders) {
      this.ordersMemoryCache.set(order.id, order);
    }
    return orders;
  }

  async getLocalTables(): Promise<OfflineTable[]> {
    if (this.tablesMemoryCache.size > 0) {
      return Array.from(this.tablesMemoryCache.values());
    }
    const tables = await this.repository.getTables();
    for (const table of tables) {
      this.tablesMemoryCache.set(table.id, table);
    }
    return tables;
  }

  async getLocalCart(): Promise<OfflineCartItem[]> {
    if (this.cartMemoryCache.length > 0) {
      return this.cartMemoryCache;
    }
    const cart = await this.repository.getCart();
    this.cartMemoryCache = cart;
    return cart;
  }

  async saveLocalCart(cart: OfflineCartItem[]): Promise<void> {
    // Merge Layer 1 cache instantly for zero-latency Optimistic Updates
    this.cartMemoryCache = this.resolveBasketConflict(this.cartMemoryCache, cart);
    // Write-through to Layer 2 (IndexedDB)
    await this.repository.saveCart(this.cartMemoryCache);
  }

  async clearLocalCart(): Promise<void> {
    this.cartMemoryCache = [];
    await this.repository.clearCart();
  }

  /**
   * Performs an Optimistic UI mutation: registers order in Memory Cache (L1) & DB (L2) instantly,
   * then schedules push request / MutationJob (L3) to synchronize
   */
  async updateOrderOptimistic(order: OfflineOrder, description: string): Promise<void> {
    // 1. Conflict resolution verification before executing cache write
    const existing = this.ordersMemoryCache.get(order.id);
    const resolvedOrder = existing 
      ? this.resolveOrderConflict(existing, order) 
      : order;

    // 2. Perform optimistic memory cache write (L1) and persistent write (L2)
    this.ordersMemoryCache.set(resolvedOrder.id, resolvedOrder);
    await this.repository.saveOrders([resolvedOrder]);

    // 3. Dispatch structured MutationJob to the priority queue
    await this.queueProcessor.enqueueJob('order', 'update', resolvedOrder);
  }

  /**
   * Create an order optimistically
   */
  async createOrderOptimistic(order: OfflineOrder, description: string): Promise<void> {
    this.ordersMemoryCache.set(order.id, order);
    await this.repository.saveOrders([order]);

    await this.queueProcessor.enqueueJob('order', 'create', order);
  }

  /**
   * Update a dining table optimistically
   */
  async updateTableOptimistic(table: OfflineTable, description: string): Promise<void> {
    this.tablesMemoryCache.set(table.id, table);
    await this.repository.saveTables([table]);

    await this.queueProcessor.enqueue(
      `/api/tables/${table.id}`,
      'PUT',
      table,
      {},
      1,
      description,
      { type: 'table', id: table.id }
    );
  }

  /**
   * Creates a payment optimistically, utilizing idempotency keys to handle duplicates
   */
  async createPaymentOptimistic(paymentPayload: { id: string; orderId: string; amount: number; idempotencyKey: string }): Promise<void> {
    // Prevent duplicate payment processing instantly if already exists in memory or retry queue
    const activeJobs = await this.repository.getMutationJobs();
    const duplicate = activeJobs.find(j => 
      j.entity === 'payment' && 
      j.payload && 
      (j.payload.idempotencyKey === paymentPayload.idempotencyKey || j.payload.id === paymentPayload.id)
    );

    if (duplicate) {
      console.warn('[OfflineService] Payment duplication attempt protected by idempotency check:', paymentPayload.id);
      return;
    }

    // Dispatch payment mutation job as top sync priority
    await this.queueProcessor.enqueueJob('payment', 'create', paymentPayload);
  }

  // ==========================================
  // Layer 4: Conflict Resolution Algorithms
  // ==========================================

  /**
   * Safely merges same order edited on 2 different devices or systems.
   * Compares versions / timestamps, merges non-duplicate item lists, and recalculates totals.
   */
  public resolveOrderConflict(local: OfflineOrder, remote: OfflineOrder): OfflineOrder {
    const localTime = new Date(local.updated_at || 0).getTime();
    const remoteTime = new Date(remote.updated_at || 0).getTime();

    // Determine base based on version & timestamp
    const base = (local.version > remote.version || localTime > remoteTime) ? local : remote;
    const secondary = base === local ? remote : local;

    // Merge items array cleanly so no added menu items or selections are overwritten
    const mergedItems = [...(base.items || [])];
    const secondaryItems = secondary.items || [];

    for (const sItem of secondaryItems) {
      const match = mergedItems.find(bItem => 
        bItem.menuItemId === sItem.menuItemId && 
        JSON.stringify(bItem.options || []) === JSON.stringify(sItem.options || [])
      );

      if (match) {
        // Choose the highest quantity requested to prevent missing orders
        match.quantity = Math.max(match.quantity, sItem.quantity);
      } else {
        mergedItems.push({ ...sItem });
      }
    }

    // Recalculate totalPrice
    const totalAmount = mergedItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);

    return {
      ...base,
      items: mergedItems,
      total_amount: totalAmount,
      updated_at: new Date().toISOString(),
      version: Math.max(local.version, remote.version) + 1
    };
  }

  /**
   * Merges two baskets/carts, summing up quantities for identical configured items
   */
  public resolveBasketConflict(localCart: OfflineCartItem[], incomingCart: OfflineCartItem[]): OfflineCartItem[] {
    const merged = [...localCart];

    for (const incoming of incomingCart) {
      const matchIndex = merged.findIndex(item => 
        item.menuItemId === incoming.menuItemId && 
        JSON.stringify(item.selection || null) === JSON.stringify(incoming.selection || null)
      );

      if (matchIndex > -1) {
        merged[matchIndex].quantity += incoming.quantity;
        merged[matchIndex].subtotal = merged[matchIndex].quantity * merged[matchIndex].price;
      } else {
        merged.push({ ...incoming });
      }
    }

    return merged;
  }
}

export const offlineService = new OfflineService();
export default offlineService;
