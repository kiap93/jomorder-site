import { IndexedDbRepository, OfflineMutation } from './indexedDbRepository';
import { NetworkMonitor } from './networkMonitor';
import { MutationJob } from '../types';
import { indexedDbStorage } from './indexedDbStorage';

let lastQueueTimestamp = Date.now();

export interface QueueStatus {
  pendingCount: number;
  failedCount: number;
  processingCount: number;
  isSyncing: boolean;
}

export type QueueStatusCallback = (status: QueueStatus) => void;

type QueueItem = 
  | { type: 'mutation'; item: OfflineMutation; score: number }
  | { type: 'job'; item: MutationJob; score: number };

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
    const jobs = await this.repository.getMutationJobs();

    const pendingMutations = mutations.filter(m => m.status === 'pending');
    const failedMutations = mutations.filter(m => m.status === 'failed');
    const processingMutations = mutations.filter(m => m.status === 'processing');

    const pendingJobs = jobs.filter(j => j.syncStatus === 'pending');
    const failedJobs = jobs.filter(j => j.syncStatus === 'failed');
    const processingJobs = jobs.filter(j => j.syncStatus === 'syncing');

    return {
      pendingCount: pendingMutations.length + pendingJobs.length,
      failedCount: failedMutations.length + failedJobs.length,
      processingCount: processingMutations.length + processingJobs.length,
      isSyncing: this.isProcessing || processingMutations.length > 0 || processingJobs.length > 0
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
    body: unknown,
    headers: Record<string, string> = {},
    priority = 1,
    description?: string,
    rollback_data?: unknown
  ): Promise<OfflineMutation> {
    const now = Date.now();
    const monotonicTimestamp = Math.max(now, lastQueueTimestamp + 1);
    lastQueueTimestamp = monotonicTimestamp;

    const mutation: OfflineMutation = {
      id: Math.random().toString(36).slice(2) + monotonicTimestamp.toString(36),
      url,
      method,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      retry_count: 0,
      status: 'pending',
      created_at: monotonicTimestamp,
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
   * Adds a new structured MutationJob to the queue with defined priority
   */
  async enqueueJob(
    entity: 'order' | 'payment' | 'basket',
    operation: 'create' | 'update' | 'delete',
    payload: unknown
  ): Promise<MutationJob> {
    const now = Date.now();
    const monotonicTimestamp = Math.max(now, lastQueueTimestamp + 1);
    lastQueueTimestamp = monotonicTimestamp;

    const job: MutationJob = {
      id: 'job_' + Math.random().toString(36).slice(2) + monotonicTimestamp.toString(36),
      entity,
      operation,
      payload,
      retries: 0,
      createdAt: monotonicTimestamp,
      syncStatus: 'pending'
    };

    await this.repository.saveMutationJob(job);
    this.notify();

    // Trigger process queue asynchronously
    this.processQueue();

    return job;
  }

  /**
   * Processes both queues based on sync priorities:
   * 1. MutationJob entity 'payment' (highest priority - score 5)
   * 2. Any payment mutations / high-priority standard mutations (score 4)
   * 3. MutationJob entity 'order' (score 3)
   * 4. MutationJob entity 'basket' (score 2)
   * 5. General mutations / analytics (lowest priority - score 1)
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
      while (this.networkMonitor.isOnline) {
        const mutations = await this.repository.getMutations();
        const jobs = await this.repository.getMutationJobs();

        // Map and prioritize all active items
        const pool: QueueItem[] = [];

        for (const m of mutations) {
          if (m.status !== 'pending' && m.status !== 'failed') continue;
          
          let score = 1; // Default
          if (m.priority >= 3) {
            score = 4;
          } else if (m.url.includes('/payments')) {
            score = 5; // Payment URLs have highest priority
          }
          
          pool.push({ type: 'mutation', item: m, score });
        }

        for (const j of jobs) {
          if (j.syncStatus !== 'pending' && j.syncStatus !== 'failed') continue;
          
          let score = 2; // Default (basket)
          if (j.entity === 'payment') {
            score = 5; // Payment Jobs have highest priority
          } else if (j.entity === 'order') {
            score = 3; // Orders inside POS have normal-high priority
          }
          
          pool.push({ type: 'job', item: j, score });
        }

        if (pool.length === 0) {
          break; // Queue is fully synchronized!
        }

        // Sort pool: highest score first, then earliest creation time
        pool.sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          const timeA = a.type === 'mutation' ? a.item.created_at : a.item.createdAt;
          const timeB = b.type === 'mutation' ? b.item.created_at : b.item.createdAt;
          return timeA - timeB;
        });

        const active = pool[0];
        let success = false;

        if (active.type === 'mutation') {
          success = await this.executeMutation(active.item);
        } else {
          success = await this.executeMutationJob(active.item);
        }

        if (!success) {
          // If transaction didn't pass, break the loop to keep serialization order and retry later
          console.warn('[QueueProcessor] Worker execution halted due to temporary channel error. Postponing next sync.');
          break;
        }
      }
    } catch (e) {
      console.error('[QueueProcessor] Error during queue processing loop', e);
    } finally {
      this.isProcessing = false;
      this.notify();
    }
  }

  /**
   * Cleans / discards a mutation or job
   */
  async discardMutation(id: string): Promise<void> {
    if (id.startsWith('job_')) {
      await this.repository.deleteMutationJob(id);
    } else {
      await this.repository.deleteMutation(id);
    }
    this.notify();
  }

  /**
   * Forces retrying all failed mutations and jobs
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

    const jobs = await this.repository.getMutationJobs();
    for (const j of jobs) {
      if (j.syncStatus === 'failed') {
        j.syncStatus = 'pending';
        j.retries = 0;
        await this.repository.saveMutationJob(j);
      }
    }

    this.notify();
    await this.processQueue();
  }

  /**
   * Forces retrying a single mutation or job
   */
  async forceRetry(id: string): Promise<void> {
    if (id.startsWith('job_')) {
      const jobs = await this.repository.getMutationJobs();
      const job = jobs.find(j => j.id === id);
      if (job) {
        job.syncStatus = 'pending';
        job.retries = 0;
        await this.repository.saveMutationJob(job);
        this.notify();
        await this.processQueue();
      }
    } else {
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
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.warn(`[QueueProcessor] Connection or transient error processing mutation ${mutation.id}:`, errorMsg);
      
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

  private async executeMutationJob(job: MutationJob): Promise<boolean> {
    job.syncStatus = 'syncing';
    await this.repository.saveMutationJob(job);
    this.notify();

    const backoffTime = Math.pow(2, job.retries) * this.baseBackoffMs;

    try {
      console.log(`[QueueProcessor] Syncing MutationJob ${job.id} [${job.entity}/${job.operation}]`);

      let url = '';
      let method = 'POST';
      let body: unknown = null;

      // Map structured queue entities to REST POS endpoints
      if (job.entity === 'order') {
        if (job.operation === 'create') {
          url = '/api/public/place-order'; // Fallback to public place-order if POS API lacks a dedicated route
          method = 'POST';
          body = job.payload;
        } else if (job.operation === 'update') {
          url = `/api/orders/${job.payload.id || job.payload.orderId}`;
          method = 'PATCH';
          body = job.payload;
        } else if (job.operation === 'delete') {
          url = `/api/orders/${job.payload.id || job.payload.orderId}`;
          method = 'DELETE';
          body = job.payload;
        }
      } else if (job.entity === 'payment') {
        if (job.operation === 'create') {
          url = '/api/public/payments';
          method = 'POST';
          body = job.payload;
        } else if (job.operation === 'update') {
          url = `/api/public/payments/${job.payload.id || job.payload.paymentId}/initialize`;
          method = 'POST';
          body = job.payload;
        }
      } else if (job.entity === 'basket') {
        if (job.operation === 'update' || job.operation === 'create') {
          url = '/api/public/sync-basket-item';
          method = 'POST';
          body = job.payload;
        }
      }

      if (!url) {
        console.error(`[QueueProcessor] Invalid Job Scheme: no endpoint resolved for ${job.entity}`);
        await this.repository.deleteMutationJob(job.id);
        this.notify();
        return true; 
      }

      // Automatically attach Auth JWT token if available
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      
      const token = await indexedDbStorage.getItem<string>('manual_supabase_jwt');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      console.log(`[QueueProcessor] Dispatching fetch to resolved path: ${url}`);
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });

      if (response.ok) {
        console.log(`[QueueProcessor] MutationJob ${job.id} synchronized successfully.`);
        await this.repository.deleteMutationJob(job.id);
        this.notify();
        return true;
      }

      if (response.status >= 400 && response.status < 500) {
        const errorDetail = await response.text();
        console.error(`[QueueProcessor] Client error ${response.status} on MutationJob ${job.id}:`, errorDetail);
        job.syncStatus = 'failed';
        job.retries += 1;
        await this.repository.saveMutationJob(job);
        this.notify();
        return false;
      }

      throw new Error(`Server returned HTTP ${response.status}`);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.warn(`[QueueProcessor] Connection error on MutationJob ${job.id}:`, errorMsg);
      job.retries += 1;
      
      if (job.retries >= this.maxRetries) {
        job.syncStatus = 'failed';
        console.error(`[QueueProcessor] MutationJob ${job.id} reached retry ceiling. Stopping.`);
      } else {
        job.syncStatus = 'pending';
        // Wait exponential backoff before continuing queue execution
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }

      await this.repository.saveMutationJob(job);
      this.notify();
      return false;
    }
  }
}
