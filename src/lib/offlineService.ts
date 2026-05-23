import { IndexedDbRepository, OfflineOrder, OfflineTable, OfflineCartItem, OfflineMutation } from './indexedDbRepository';
import { NetworkMonitor, networkMonitorInstance } from './networkMonitor';
import { QueueProcessor, QueueStatus } from './queueProcessor';
import { SyncService } from './syncService';

class OfflineService {
  public repository: IndexedDbRepository;
  public networkMonitor: NetworkMonitor;
  public queueProcessor: QueueProcessor;
  public syncService: SyncService;

  constructor() {
    this.repository = new IndexedDbRepository();
    this.networkMonitor = networkMonitorInstance;
    this.queueProcessor = new QueueProcessor(this.repository, this.networkMonitor);
    this.syncService = new SyncService(this.repository, this.networkMonitor, this.queueProcessor);

    this.repository.init().then(() => {
      console.log('[OfflineService] Initialized Offline-First architecture correctly.');
    }).catch(err => {
      console.error('[OfflineService] IndexedDB failure:', err);
    });
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

  // Direct state read/write (e.g. for page loads)
  async getLocalOrders(): Promise<OfflineOrder[]> {
    return this.repository.getOrders();
  }

  async getLocalTables(): Promise<OfflineTable[]> {
    return this.repository.getTables();
  }

  async getLocalCart(): Promise<OfflineCartItem[]> {
    return this.repository.getCart();
  }

  async saveLocalCart(cart: OfflineCartItem[]): Promise<void> {
    await this.repository.saveCart(cart);
  }

  async clearLocalCart(): Promise<void> {
    await this.repository.clearCart();
  }

  /**
   * Performs an Optimistic UI mutation: registers the item in dynamic Local DB first,
   * then enqueues the mutation payload to sync.
   * If the queue fails permanently, rollbackData can be triggered.
   */
  async updateOrderOptimistic(order: OfflineOrder, description: string): Promise<void> {
    // 1. Persist local update immediately to preserve state
    await this.repository.saveOrders([order]);

    // 2. Schedule push request to the server
    await this.queueProcessor.enqueue(
      `/api/orders/${order.id}`,
      'PUT',
      order,
      {},
      2, // High priority for orders
      description,
      { type: 'order', id: order.id } // Rollback reference
    );
  }

  /**
   * Create an order optimistically
   */
  async createOrderOptimistic(order: OfflineOrder, description: string): Promise<void> {
    await this.repository.saveOrders([order]);

    await this.queueProcessor.enqueue(
      `/api/orders`,
      'POST',
      order,
      {},
      3, // Core priority for new ordering
      description,
      { type: 'order_create', id: order.id }
    );
  }

  /**
   * Update a dining table optimistically
   */
  async updateTableOptimistic(table: OfflineTable, description: string): Promise<void> {
    await this.repository.saveTables([table]);

    await this.queueProcessor.enqueue(
      `/api/tables/${table.id}`,
      'PUT',
      table,
      {},
      1, // Lower priority for table details
      description,
      { type: 'table', id: table.id }
    );
  }
}

export const offlineService = new OfflineService();
export default offlineService;
