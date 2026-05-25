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
    if (!offlineService.isOnline) {
      console.log('[MutationQueue] System is offline. Directing request directly into durable queue.');
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
      // Return empty mocked result to keep optimistic UI intact
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
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const item = this.queue.shift();

    if (item) {
      const { task, requestDetails, description } = item;
      try {
        const result = await task();
        if (this.onSyncComplete) {
          this.onSyncComplete(result);
        }
      } catch (error) {
        console.warn('[MutationQueue] Task failed. Rebounding into durable IndexedDB queue:', error);
        
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

        // Trigger optimistic completion callback even on offline queueing to avoid breaking UI flow
        if (this.onSyncComplete) {
          this.onSyncComplete({ status: 'queued_fallback', basket_version: Date.now() });
        }
      }
    }

    await this.process();
  }

  get isIdle() {
    return !this.processing && this.queue.length === 0;
  }
}
