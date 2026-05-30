import { IndexedDbRepository, OfflineOrder, OfflineTable, OfflineCartItem, OfflineMutation } from './indexedDbRepository';
import { NetworkMonitor, networkMonitorInstance } from './networkMonitor';
import { QueueProcessor, QueueStatus } from './queueProcessor';
import { SyncService } from './syncService';
import { MutationJob } from '../types';
import { indexedDbStorage } from './indexedDbStorage';

export interface ConflictLog {
  id: string;
  timestamp: number;
  entityType: 'order' | 'table';
  entityId: string;
  issue: string;
  localValue: unknown;
  remoteValue: unknown;
  policyApplied: 'smart' | 'server-wins' | 'client-wins' | 'timestamp-wins';
  resolvedValue: unknown;
}

class OfflineService {
  public repository: IndexedDbRepository;
  public networkMonitor: NetworkMonitor;
  public queueProcessor: QueueProcessor;
  public syncService: SyncService;

  // Layer 1: Memory Cache Layer
  private ordersMemoryCache = new Map<string, OfflineOrder>();
  private tablesMemoryCache = new Map<string, OfflineTable>();
  private cartMemoryCache: OfflineCartItem[] = [];

  // Conflict policy state
  private conflictPolicy: 'smart' | 'server-wins' | 'client-wins' | 'timestamp-wins' = 'smart';
  private conflictLogs: ConflictLog[] = [];

  constructor() {
    this.repository = new IndexedDbRepository();
    this.networkMonitor = networkMonitorInstance;
    this.queueProcessor = new QueueProcessor(this.repository, this.networkMonitor);
    this.syncService = new SyncService(this.repository, this.networkMonitor, this.queueProcessor);

    // Load active settings from localStorage
    const storedPolicy = localStorage.getItem('pos_offline_conflict_policy');
    if (storedPolicy && ['smart', 'server-wins', 'client-wins', 'timestamp-wins'].includes(storedPolicy)) {
      this.conflictPolicy = storedPolicy as 'smart' | 'server-wins' | 'client-wins' | 'timestamp-wins';
    }

    const storedLogs = localStorage.getItem('pos_offline_conflict_logs');
    if (storedLogs) {
      try {
        this.conflictLogs = JSON.parse(storedLogs);
      } catch (_) {
        this.conflictLogs = [];
      }
    }

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
      // Startup Recovery: Recover any mutations/jobs left in 'processing' or 'syncing' states
      // due to a previous browser crash or abrupt app termination.
      const mutations = await this.repository.getMutations();
      let recoveredCount = 0;
      for (const m of mutations) {
        if (m.status === 'processing') {
          m.status = 'pending';
          await this.repository.saveMutation(m);
          recoveredCount++;
        }
      }
      if (recoveredCount > 0) {
        console.log(`[OfflineService] Recovered ${recoveredCount} abandoned 'processing' mutations on startup.`);
      }

      const jobs = await this.repository.getMutationJobs();
      let recoveredJobsCount = 0;
      for (const j of jobs) {
        if (j.syncStatus === 'syncing') {
          j.syncStatus = 'pending';
          await this.repository.saveMutationJob(j);
          recoveredJobsCount++;
        }
      }
      if (recoveredJobsCount > 0) {
        console.log(`[OfflineService] Recovered ${recoveredJobsCount} abandoned 'syncing' jobs on startup.`);
      }

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

  // Conflict policy getters/setters
  getConflictPolicy(): 'smart' | 'server-wins' | 'client-wins' | 'timestamp-wins' {
    return this.conflictPolicy;
  }

  setConflictPolicy(policy: 'smart' | 'server-wins' | 'client-wins' | 'timestamp-wins'): void {
    this.conflictPolicy = policy;
    localStorage.setItem('pos_offline_conflict_policy', policy);
    console.log(`[OfflineService] Conflict policy switched to: ${policy}`);
  }

  getConflictLogs(): ConflictLog[] {
    return this.conflictLogs;
  }

  clearConflictLogs(): void {
    this.conflictLogs = [];
    localStorage.setItem('pos_offline_conflict_logs', JSON.stringify([]));
  }

  private addConflictLog(log: Omit<ConflictLog, 'id' | 'timestamp'>): void {
    const newLog: ConflictLog = {
      ...log,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now()
    };
    this.conflictLogs.unshift(newLog);
    // Max 100 logs
    if (this.conflictLogs.length > 100) {
      this.conflictLogs = this.conflictLogs.slice(0, 100);
    }
    localStorage.setItem('pos_offline_conflict_logs', JSON.stringify(this.conflictLogs));
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

    // Check if there is actual value mismatch to prevent spamming conflict logs
    const isStatusMismatch = local.status !== remote.status;
    const isItemsMismatch = JSON.stringify(local.items || []) !== JSON.stringify(remote.items || []);

    if (!isStatusMismatch && !isItemsMismatch) {
      // No discrepancy: clean exit, return whichever is newer or remote
      return local.version >= remote.version ? local : remote;
    }

    const policy = this.conflictPolicy;

    // 1. POLICY: SERVER WINS
    if (policy === 'server-wins') {
      this.addConflictLog({
        entityType: 'order',
        entityId: remote.id,
        issue: `Discrepancy detected (Status/Items). Server-Wins policy applied.`,
        localValue: { status: local.status, itemsCount: (local.items || []).length },
        remoteValue: { status: remote.status, itemsCount: (remote.items || []).length },
        policyApplied: 'server-wins',
        resolvedValue: { status: remote.status, itemsCount: (remote.items || []).length }
      });
      return remote;
    }

    // 2. POLICY: CLIENT WINS
    if (policy === 'client-wins') {
      this.addConflictLog({
        entityType: 'order',
        entityId: remote.id,
        issue: `Discrepancy detected (Status/Items). Client-Wins policy applied.`,
        localValue: { status: local.status, itemsCount: (local.items || []).length },
        remoteValue: { status: remote.status, itemsCount: (remote.items || []).length },
        policyApplied: 'client-wins',
        resolvedValue: { status: local.status, itemsCount: (local.items || []).length }
      });
      return local;
    }

    // 3. POLICY: LATEST TIMESTAMP WINS
    if (policy === 'timestamp-wins') {
      const isLocalNewer = localTime > remoteTime || (localTime === remoteTime && local.version > remote.version);
      const winner = isLocalNewer ? local : remote;
      this.addConflictLog({
        entityType: 'order',
        entityId: remote.id,
        issue: `Discrepancy detected. Last-Write-Wins (LWW) timestamp policy applied.`,
        localValue: { status: local.status, itemsCount: (local.items || []).length, updated: local.updated_at },
        remoteValue: { status: remote.status, itemsCount: (remote.items || []).length, updated: remote.updated_at },
        policyApplied: 'timestamp-wins',
        resolvedValue: { status: winner.status, itemsCount: (winner.items || []).length }
      });
      return winner;
    }

    // 4. POLICY: SMART MERGE (Role and Status Safety Overrides - DEFAULT)
    // Deterministic hierarchy rules to ensure zero disappearing items and maximum safety.
    const statusPrecedence: Record<string, number> = {
      'cancelled': 4,
      'completed': 3,
      'cooking': 2,
      'ready_to_serve': 2,
      'pending': 1
    };

    const localScore = statusPrecedence[local.status.toLowerCase()] || 0;
    const remoteScore = statusPrecedence[remote.status.toLowerCase()] || 0;

    let resolvedStatus = remote.status;
    let statusSource = 'Server Status Priority';

    if (localScore > remoteScore) {
      resolvedStatus = local.status;
      statusSource = 'Local Status override (Higher precedence)';
    } else if (remoteScore > localScore) {
      resolvedStatus = remote.status;
      statusSource = 'Remote Status override (Higher precedence)';
    } else {
      // Equal status score. Tie-break: use newest modifier
      resolvedStatus = localTime >= remoteTime ? local.status : remote.status;
      statusSource = localTime >= remoteTime ? 'Local status (Newer modification)' : 'Remote status (Newer modification)';
    }

    // Safe items Union: Never discard added items concurrently!
    const mergedItems = [...(remote.items || [])];
    const secondaryItems = local.items || [];
    let itemsAddedCount = 0;

    for (const sItem of secondaryItems) {
      const match = mergedItems.find(bItem => 
        bItem.menuItemId === sItem.menuItemId && 
        JSON.stringify(bItem.options || []) === JSON.stringify(sItem.options || [])
      );

      if (match) {
        // Safe item update: take the max quantity so chef never under-prepares
        if (sItem.quantity > match.quantity) {
          match.quantity = sItem.quantity;
        }
      } else {
        mergedItems.push({ ...sItem });
        itemsAddedCount++;
      }
    }

    // Recompute total amount
    const totalAmount = mergedItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);

    const resolvedOrder: OfflineOrder = {
      ...(local.version > remote.version ? local : remote),
      status: resolvedStatus,
      items: mergedItems,
      total_amount: totalAmount,
      updated_at: new Date().toISOString(),
      version: Math.max(local.version, remote.version) + 1
    };

    this.addConflictLog({
      entityType: 'order',
      entityId: remote.id,
      issue: `Smart Merge: Status conflict resolved via [${statusSource}]. Merged duplicate items safely.`,
      localValue: { status: local.status, itemsCount: (local.items || []).length },
      remoteValue: { status: remote.status, itemsCount: (remote.items || []).length },
      policyApplied: 'smart',
      resolvedValue: { status: resolvedOrder.status, itemsCount: resolvedOrder.items?.length || 0, total: totalAmount }
    });

    return resolvedOrder;
  }

  /**
   * Centralized Table Conflict resolution
   */
  public resolveTableConflict(local: OfflineTable, remote: OfflineTable): OfflineTable {
    const localTime = new Date(local.updated_at || 0).getTime();
    const remoteTime = new Date(remote.updated_at || 0).getTime();

    if (local.status === remote.status && local.current_session_id === remote.current_session_id) {
      return local.version >= remote.version ? local : remote;
    }

    const policy = this.conflictPolicy;

    if (policy === 'server-wins') {
      return remote;
    }
    if (policy === 'client-wins') {
      return local;
    }
    if (policy === 'timestamp-wins') {
      return localTime >= remoteTime ? local : remote;
    }

    // Smart Merge for tables: keep seated or active states rather than clearing, to prevent seating overlaps.
    const tableStatusScore = {
      'active': 3,
      'reserved': 2,
      'vacant': 1
    };

    const localScore = tableStatusScore[local.status] || 0;
    const remoteScore = tableStatusScore[remote.status] || 0;

    let resolvedStatus: 'active' | 'reserved' | 'vacant' = remote.status;
    if (localScore > remoteScore) {
      resolvedStatus = local.status;
    }

    const resolvedTable: OfflineTable = {
      ...(local.version >= remote.version ? local : remote),
      status: resolvedStatus,
      current_session_id: local.current_session_id || remote.current_session_id,
      updated_at: new Date().toISOString(),
      version: Math.max(local.version, remote.version) + 1
    };

    this.addConflictLog({
      entityType: 'table',
      entityId: remote.id,
      issue: `Smart Seating Merge applied to prevent Seat Overlaps. Status merged to: ${resolvedStatus}.`,
      localValue: { status: local.status, session: local.current_session_id },
      remoteValue: { status: remote.status, session: remote.current_session_id },
      policyApplied: 'smart',
      resolvedValue: { status: resolvedTable.status, session: resolvedTable.current_session_id }
    });

    return resolvedTable;
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

  /**
   * Clears ALL local caches and IndexedDB database stores to safeguard session integrity,
   * preventing cross-session desync or data leakage on multi-user or shared terminals.
   */
  public async purgeTenantData(): Promise<void> {
    console.log('[OfflineService] Purging all tenant-scoped data from Layer 1 Memory and Layer 2 IndexedDB.');
    // Clear Layer 1 Memory caches
    this.ordersMemoryCache.clear();
    this.tablesMemoryCache.clear();
    this.cartMemoryCache = [];
    this.conflictLogs = [];
    
    // Clear Layer 2 IndexedDB stores
    await this.repository.clearAllData();
    
    // Clear localStorage values
    localStorage.removeItem('pos_offline_conflict_policy');
    localStorage.removeItem('pos_offline_conflict_logs');
    
    // Reset policy to default
    this.conflictPolicy = 'smart';

    // Broadcast update to notify any reactive listeners or hook subscriptions
    this.queueProcessor['notify']();
  }
}

export const offlineService = new OfflineService();
export default offlineService;

export async function clearTenantScopedIndexedDB(): Promise<void> {
  console.log('[clearTenantScopedIndexedDB] Initiating complete tenant block wipeout on IndexedDB databases...');
  
  // 1. Wipe offline service layers (Memory caches, cart, tables, orders, pending mutations and logs)
  try {
    await offlineService.purgeTenantData();
  } catch (err) {
    console.warn('[clearTenantScopedIndexedDB] Failed purging offlineService:', err);
  }

  // 2. Clear KV session storage database (JWT tokens, cached workspace items)
  try {
    await indexedDbStorage.clear();
  } catch (err) {
    console.warn('[clearTenantScopedIndexedDB] Failed clearing indexedDbStorage:', err);
  }

  // 3. Clear relevant sessionStorage items and client-side storage keys as final safety margin
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
  } catch (err) {
    console.warn('[clearTenantScopedIndexedDB] sessionStorage clearance bypassed:', err);
  }

  console.log('[clearTenantScopedIndexedDB] Offline database wipeout complete.');
}

declare global {
  interface Window {
    clearTenantScopedIndexedDB?: typeof clearTenantScopedIndexedDB;
  }
}

// Bind to window to guarantee full accessibility in test suites and terminal scripts
if (typeof window !== 'undefined') {
  window.clearTenantScopedIndexedDB = clearTenantScopedIndexedDB;
}
