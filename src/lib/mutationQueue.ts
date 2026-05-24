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

type MutationTask = () => Promise<QueueSyncResult>;

export class MutationQueue {
  private queue: MutationTask[] = [];
  private processing = false;
  private onSyncComplete?: (data: QueueSyncResult) => void;

  constructor(onSyncComplete?: (data: QueueSyncResult) => void) {
    this.onSyncComplete = onSyncComplete;
  }

  async enqueue(task: MutationTask, description?: string) {
    if (!offlineService.isOnline) {
      console.log('[MutationQueue] System is offline. Directing request directly into durable queue.');
      await this.persistTaskOffline(task, description);
      // Return empty mocked result to keep optimistic UI intact
      if (this.onSyncComplete) {
        this.onSyncComplete({ status: 'queued_offline', basket_version: Date.now() });
      }
      return { status: 'queued_offline', basket_version: Date.now() };
    }

    this.queue.push(task);
    if (!this.processing) {
      await this.process(description);
    }
  }

  private async process(description?: string) {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const task = this.queue.shift();

    if (task) {
      // Setup dynamic spy interceptor on fetch
      const originalFetch = globalThis.fetch;
      let capturedRequest: { url: string; options?: RequestInit } | null = null;

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : (input as Request).url || input.toString();
        capturedRequest = { url, options: init };
        return originalFetch(input, init);
      };

      try {
        const result = await task();
        globalThis.fetch = originalFetch; // restore fetch
        
        if (this.onSyncComplete) {
          this.onSyncComplete(result);
        }
      } catch (error) {
        globalThis.fetch = originalFetch; // restore fetch
        console.warn('[MutationQueue] Task failed. Rebounding into durable IndexedDB queue:', error);
        
        if (capturedRequest) {
          const { url, options } = capturedRequest;
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

    await this.process(description);
  }

  private async persistTaskOffline(task: MutationTask, description?: string) {
    const originalFetch = globalThis.fetch;
    let capturedRequest: { url: string; options?: RequestInit } | null = null;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url || input.toString();
      capturedRequest = { url, options: init };
      // Cause an immediate network error to escape the block and capture parameters
      throw new TypeError('Failed to fetch (offline simulation)');
    };

    try {
      await task();
    } catch {
      // Ignored - the exception is simulated to extract options
    } finally {
      globalThis.fetch = originalFetch; // restore fetch
    }

    if (capturedRequest) {
      const { url, options } = capturedRequest;
      await offlineService.queueProcessor.enqueue(
        url,
        options?.method || 'POST',
        options?.body || '',
        parseHeaders(options?.headers),
        2,
        description || `Sync item offline: ${url}`
      );
      console.log(`[MutationQueue] Intercepted and saved offline task: ${url}`);
    }
  }

  get isIdle() {
    return !this.processing && this.queue.length === 0;
  }
}
