import { IndexedDbRepository, OfflineMutation } from './indexedDbRepository';
import { NetworkMonitor } from './networkMonitor';

export interface QueueStatus {
  pendingCount: number;
  failedCount: number;
  processingCount: number;
  isSyncing: boolean;
}

export type QueueStatusCallback = (status: QueueStatus) => void;

export class QueueProcessor {
  private repository: IndexedDbRepository;
  private networkMonitor: NetworkMonitor;
  private isProcessing = false;
  private listeners: Set<QueueStatusCallback> = new Set();
  private maxRetries = 5;
  private baseBackoffMs = 1000;

  constructor(repository: IndexedDbRepository, networkMonitor: NetworkMonitor) {
    this.repository = repository;
    this.networkMonitor = networkMonitor;

    // Listen to network changes to automatically trigger processing when coming online
    this.networkMonitor.subscribe((isOnline) => {
      if (isOnline) {
        this.processQueue();
      }
    });
  }

  subscribe(callback: QueueStatusCallback): () => void {
    this.listeners.add(callback);
    this.getQueueStatus().then(status => callback(status));
    return () => {
      this.listeners.delete(callback);
    };
  }

  async getQueueStatus(): Promise<QueueStatus> {
    const mutations = await this.repository.getMutations();
    const pending = mutations.filter(m => m.status === 'pending');
    const failed = mutations.filter(m => m.status === 'failed');
    const processing = mutations.filter(m => m.status === 'processing');

    return {
      pendingCount: pending.length,
      failedCount: failed.length,
      processingCount: processing.length,
      isSyncing: this.isProcessing || processing.length > 0
    };
  }

  private notify() {
    this.getQueueStatus().then((status) => {
      for (const listener of this.listeners) {
        try {
          listener(status);
        } catch (e) {
          console.error('Error notifying QueueProcessor listener', e);
        }
      }
    });
  }

  /**
   * Adds a new mutation to local queue and triggers non-blocking processing
   */
  async enqueue(
    url: string,
    method: string,
    body: any,
    headers: Record<string, string> = {},
    priority = 1,
    description?: string,
    rollback_data?: any
  ): Promise<OfflineMutation> {
    const mutation: OfflineMutation = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      url,
      method,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      retry_count: 0,
      status: 'pending',
      created_at: Date.now(),
      priority,
      description,
      rollback_data
    };

    await this.repository.saveMutation(mutation);
    this.notify();

    // Trigger process queue asynchronously
    this.processQueue();

    return mutation;
  }

  /**
   * Processes the entire queue sequentially
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    if (!this.networkMonitor.isOnline) {
      console.log('[QueueProcessor] Device is offline, skipping background sync');
      return;
    }

    this.isProcessing = true;
    this.notify();

    try {
      let mutations = await this.repository.getMutations();
      
      // Process items that are either pending or failed. We execute them sequentially.
      while (mutations.length > 0 && this.networkMonitor.isOnline) {
        const activeMutation = mutations[0];

        // Skip if status is already processing in another lock, though we have sequential lock here
        if (activeMutation.status === 'processing') {
          break;
        }

        const success = await this.executeMutation(activeMutation);
        if (!success) {
          // If execution failed due to network, stop processing subsequent mutations to preserve sequential order
          console.warn('[QueueProcessor] Mutation execution failed. Halting queue processing for safety.');
          break;
        }

        // Fetch refreshed queue state
        mutations = await this.repository.getMutations();
      }
    } catch (e) {
      console.error('[QueueProcessor] Error during queue processing loop', e);
    } finally {
      this.isProcessing = false;
      this.notify();
    }
  }

  /**
   * Cleans / discards a mutation
   */
  async discardMutation(id: string): Promise<void> {
    await this.repository.deleteMutation(id);
    this.notify();
  }

  /**
   * Forces retrying a specific mutation (or all failed mutations)
   */
  async forceRetryAll(): Promise<void> {
    const mutations = await this.repository.getMutations();
    for (const m of mutations) {
      if (m.status === 'failed') {
        m.status = 'pending';
        m.retry_count = 0;
        await this.repository.saveMutation(m);
      }
    }
    this.notify();
    await this.processQueue();
  }

  /**
   * Forces retrying a single mutation
   */
  async forceRetry(id: string): Promise<void> {
    const mutations = await this.repository.getMutations();
    const mutation = mutations.find(m => m.id === id);
    if (mutation) {
      mutation.status = 'pending';
      mutation.retry_count = 0;
      await this.repository.saveMutation(mutation);
      this.notify();
      await this.processQueue();
    }
  }

  private async executeMutation(mutation: OfflineMutation): Promise<boolean> {
    mutation.status = 'processing';
    await this.repository.saveMutation(mutation);
    this.notify();

    const backoffTime = Math.pow(2, mutation.retry_count) * this.baseBackoffMs;

    try {
      console.log(`[QueueProcessor] Syncing mutation ${mutation.id} (${mutation.description || mutation.url})`);
      
      const response = await fetch(mutation.url, {
        method: mutation.method,
        headers: mutation.headers,
        body: mutation.body
      });

      if (response.ok) {
        console.log(`[QueueProcessor] Mutation ${mutation.id} synchronized successfully.`);
        await this.repository.deleteMutation(mutation.id);
        this.notify();
        return true;
      }

      // Handle server-side 400-499 errors (client errors)
      // These are usually logical errors (bad validation, concurrent constraints, nonexistent resources)
      // Retrying them forever would block the sync pipeline.
      if (response.status >= 400 && response.status < 500) {
        const errorDetail = await response.text();
        console.error(`[QueueProcessor] Client error ${response.status} resolving mutation ${mutation.id}:`, errorDetail);
        
        mutation.status = 'failed';
        mutation.retry_count += 1;
        await this.repository.saveMutation(mutation);
        this.notify();
        return false;
      }

      // 5xx error or connection error: treat as temporary, retry with backoff later
      throw new Error(`Server returned HTTP ${response.status}`);
    } catch (e: any) {
      console.warn(`[QueueProcessor] Connection or transient error processing mutation ${mutation.id}:`, e.message || e);
      
      mutation.retry_count += 1;
      if (mutation.retry_count >= this.maxRetries) {
        mutation.status = 'failed';
        console.error(`[QueueProcessor] Mutation ${mutation.id} exceeded maximum retries. Disabling auto-retry.`);
      } else {
        mutation.status = 'pending'; // Put back in queue to allow exponential backoff retries
        // Delay before continuing to let network settle
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }

      await this.repository.saveMutation(mutation);
      this.notify();
      return false;
    }
  }
}
