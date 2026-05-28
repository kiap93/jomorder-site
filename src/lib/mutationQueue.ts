import { offlineService } from './offlineService';

function parseHeaders(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;
  if (headers instanceof Headers) {
    headers.forEach((val, key) => {
      result[key] = val;
    });
  } else if (Array.isArray(headers)) {
    headers.forEach(([key, val]) => {
      result[key] = val;
    });
  } else {
    Object.assign(result, headers);
  }
  return result;
}

export interface QueueSyncResult {
  status?: string;
  basket_version?: number;
  basket_id?: string;
  new_quantity?: number;
  error?: string;
}

type MutationTask = () => Promise<any>;

interface QueueItem {
  task: MutationTask;
  requestDetails?: { url: string; options?: RequestInit };
  description?: string;
}

// Global/persistent states for tracking deterministic sequences and client-side monotonic clock
let lastSeq = 0;
try {
  const saved = typeof window !== 'undefined' ? window.localStorage.getItem('pos_mutation_sequence') : null;
  if (saved) lastSeq = parseInt(saved, 10) || 0;
} catch (e) {}

let lastTimestamp = Date.now();

// Utility to safely inject sequence numbers and client timestamps into mutation bodies
function enrichRequestBody(body: any, seqNo: number, timestamp: number, syncId: string): any {
  if (!body) return body;
  try {
    let parsed: any;
    if (typeof body === 'string') {
      parsed = JSON.parse(body);
    } else {
      parsed = { ...(body as object) };
    }
    
    parsed.p_sequence_no = seqNo;
    parsed.p_client_timestamp = timestamp;
    parsed.p_sync_id = syncId;
    
    return typeof body === 'string' ? JSON.stringify(parsed) : parsed;
  } catch (err) {
    return body;
  }
}

export class MutationQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private onSyncComplete?: (data: QueueSyncResult) => void;

  constructor(onSyncComplete?: (data: QueueSyncResult) => void) {
    this.onSyncComplete = onSyncComplete;
  }

  async enqueue(
    task: MutationTask, 
    requestDetails?: { url: string; options?: RequestInit }, 
    description?: string
  ) {
    // Generate deterministic monotonic sequence IDs and client timestamps
    lastSeq++;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('pos_mutation_sequence', String(lastSeq));
      } catch (e) {}
    }

    const now = Date.now();
    const monotonicTimestamp = Math.max(now, lastTimestamp + 1);
    lastTimestamp = monotonicTimestamp;
    const deterministicSequenceId = `seq_${lastSeq}_${monotonicTimestamp}`;

    // Enrich requestDetails dynamically so that BOTH the immediate execution
    // and potentially postponed/offline-retried tasks bear identical sequence markers!
    if (requestDetails && requestDetails.options) {
      const opts = requestDetails.options;
      if (opts.body) {
        opts.body = enrichRequestBody(opts.body, lastSeq, monotonicTimestamp, deterministicSequenceId);
      }
      
      const hdrs = parseHeaders(opts.headers);
      hdrs['X-Sequence-No'] = String(lastSeq);
      hdrs['X-Client-Timestamp'] = String(monotonicTimestamp);
      hdrs['X-Sync-Id'] = deterministicSequenceId;
      opts.headers = hdrs;
    }

    // Protect sequential ordering: If offline or there already is a backlog
    // in the durable storage queue, immediately forward everything directly to IndexedDB.
    const queueStatus = await offlineService.queueProcessor.getQueueStatus();
    const hasBacklog = queueStatus.pendingCount > 0 || queueStatus.failedCount > 0 || queueStatus.processingCount > 0;

    if (!offlineService.isOnline || hasBacklog) {
      console.log('[MutationQueue] Durable backlog present or system offline. Forcing request directly to durable IndexedDB queue to preserve strict sequential order.');
      if (requestDetails) {
        const { url, options } = requestDetails;
        await offlineService.queueProcessor.enqueue(
          url,
          options?.method || 'POST',
          options?.body || '',
          parseHeaders(options?.headers),
          2,
          description || `Sync item offline: ${url}`
        );
      }
      
      if (this.onSyncComplete) {
        this.onSyncComplete({ status: 'queued_offline', basket_version: Date.now() });
      }
      return { status: 'queued_offline', basket_version: Date.now() };
    }

    this.queue.push({ task, requestDetails, description });
    if (!this.processing) {
      await this.process();
    }
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) continue;

      const { task, requestDetails, description } = item;
      try {
        const result = await task();
        if (this.onSyncComplete) {
          this.onSyncComplete(result);
        }
      } catch (error) {
        console.warn('[MutationQueue] Task failed. Rebounding current task and flushing queue into durable IndexedDB queue:', error);
        
        if (requestDetails) {
          const { url, options } = requestDetails;
          await offlineService.queueProcessor.enqueue(
            url,
            options?.method || 'POST',
            options?.body || '',
            parseHeaders(options?.headers),
            2,
            description || `Auto-retry for failed: ${url}`
          );
        }

        // Flush remainder of memory queue to durable queue in serial order!
        // This stops other queued requests from race-bypassing the failed head task!
        while (this.queue.length > 0) {
          const nextItem = this.queue.shift();
          if (nextItem && nextItem.requestDetails) {
            const { url, options } = nextItem.requestDetails;
            await offlineService.queueProcessor.enqueue(
              url,
              options?.method || 'POST',
              options?.body || '',
              parseHeaders(options?.headers),
              2,
              nextItem.description || `Autoforwarded queue: ${url}`
            );
          }
        }

        if (this.onSyncComplete) {
          this.onSyncComplete({ status: 'queued_fallback', basket_version: Date.now() });
        }
        break; // Halted memory processing completely
      }
    }

    this.processing = false;
  }

  get isIdle() {
    return !this.processing && this.queue.length === 0;
  }
}
