import { IndexedDbRepository, OfflineOrder, OfflineTable } from './indexedDbRepository';
import { NetworkMonitor } from './networkMonitor';
import { QueueProcessor } from './queueProcessor';
import { offlineService } from './offlineService';
import { OrderItem } from '../types';

interface RawRemoteOrder {
  id: string;
  table_id?: string;
  tableSlotId?: string;
  status: string;
  total_amount?: number;
  price_gross?: number;
  items?: OrderItem[];
  order_items?: OrderItem[];
  p_session_id?: string;
  session_id?: string;
  created_at: string;
  updated_at?: string;
  modified_at?: string;
  version?: number;
}

interface RawRemoteTable {
  id: string;
  name: string;
  status?: 'vacant' | 'active' | 'reserved';
  seating_capacity?: number;
  capacity?: number;
  current_session_id?: string;
  session_id?: string;
  updated_at?: string;
  modified_at?: string;
  version?: number;
}

export class SyncService {
  private repository: IndexedDbRepository;
  private networkMonitor: NetworkMonitor;
  private queueProcessor: QueueProcessor;

  constructor(repository: IndexedDbRepository, networkMonitor: NetworkMonitor, queueProcessor: QueueProcessor) {
    this.repository = repository;
    this.networkMonitor = networkMonitor;
    this.queueProcessor = queueProcessor;
  }

  /**
   * Pulls remote orders and updates local IndexedDB, performing conflict resolution if necessary.
   */
  async pullOrders(restaurantId: string, fetchOptions: RequestInit = {}): Promise<OfflineOrder[]> {
    if (!this.networkMonitor.isOnline) {
      console.log('[SyncService] Offline - loading cached orders from IndexedDB');
      return this.repository.getOrders();
    }

    try {
      const response = await fetch(`/api/restaurants/${restaurantId}/orders`, fetchOptions);
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const remoteOrders: RawRemoteOrder[] = await response.json();

      const localOrders = await this.repository.getOrders();
      const localOrdersMap = new Map(localOrders.map(o => [o.id, o]));
      const ordersToSave: OfflineOrder[] = [];

      for (const remote of remoteOrders) {
        const local = localOrdersMap.get(remote.id);
        const resolved = this.resolveConflict(local, {
          id: remote.id,
          table_id: remote.table_id || remote.tableSlotId,
          status: remote.status,
          total_amount: remote.total_amount || remote.price_gross,
          items: remote.items || remote.order_items || [],
          p_session_id: remote.p_session_id || remote.session_id,
          created_at: remote.created_at,
          updated_at: remote.updated_at || remote.modified_at || remote.created_at,
          version: remote.version || 1
        });
        ordersToSave.push(resolved);
      }

      // Save resolved orders back to IndexedDB
      if (ordersToSave.length > 0) {
        await this.repository.saveOrders(ordersToSave);
      }

      return this.repository.getOrders();
    } catch (e) {
      console.error('[SyncService] Failed to sync orders, loading from cache:', e);
      return this.repository.getOrders();
    }
  }

  /**
   * Pulls remote tables and updates local IndexedDB.
   */
  async pullTables(restaurantId: string, fetchOptions: RequestInit = {}): Promise<OfflineTable[]> {
    if (!this.networkMonitor.isOnline) {
      console.log('[SyncService] Offline - loading cached tables from IndexedDB');
      return this.repository.getTables();
    }

    try {
      const response = await fetch(`/api/restaurants/${restaurantId}/tables`, fetchOptions);
      if (!response.ok) throw new Error(`HTTP error ${response.status}`);
      const remoteTables: RawRemoteTable[] = await response.json();

      const localTables = await this.repository.getTables();
      const localMap = new Map(localTables.map(t => [t.id, t]));
      const tablesToSave: OfflineTable[] = [];

      for (const remote of remoteTables) {
        const local = localMap.get(remote.id);
        const remoteTable: OfflineTable = {
          id: remote.id,
          name: remote.name,
          status: remote.status || 'vacant',
          seating_capacity: remote.seating_capacity || remote.capacity,
          current_session_id: remote.current_session_id || remote.session_id,
          updated_at: remote.updated_at || remote.modified_at || new Date().toISOString(),
          version: remote.version || 1
        };

        const resolved = this.resolveConflict(local, remoteTable);
        tablesToSave.push(resolved);
      }

      if (tablesToSave.length > 0) {
        await this.repository.saveTables(tablesToSave);
      }

      return this.repository.getTables();
    } catch (e) {
      console.error('[SyncService] Failed to sync tables, loading from cache:', e);
      return this.repository.getTables();
    }
  }

  /**
   * Last-Write-Wins and Timestamp/Version conflict resolution helper.
   * If local has mutations queued, we assume local changes have high priority, or we merge.
   */
  private resolveConflict<T extends { id: string; updated_at: string; version: number }>(local: T | undefined, remote: T): T {
    if (!local) return remote;

    // Special order merging resolution for Layer 4 Conflict Resolver
    if ('items' in remote) {
      return offlineService.resolveOrderConflict(local as unknown as OfflineOrder, remote as unknown as OfflineOrder) as unknown as T;
    }

    // Special table conflict resolution
    if ('name' in remote && 'status' in remote) {
      return offlineService.resolveTableConflict(local as any, remote as any) as unknown as T;
    }

    // Compare versions and timestamps for general objects
    const localTime = new Date(local.updated_at).getTime();
    const remoteTime = new Date(remote.updated_at).getTime();

    if (local.version > remote.version || localTime > remoteTime) {
      // Local is newer: preserve local info
      console.log(`[SyncService] Conflict detected: Local state is newer. Keeping local. ID: ${local.id}`);
      return local;
    }

    // Remote is newer: use remote
    return remote;
  }
}
