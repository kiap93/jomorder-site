import { supabaseAdmin } from "./dbService";

export interface IdempotencyRecord {
  status: 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  createdAt: number;
}

class IdempotencyService {
  private registry = new Map<string, IdempotencyRecord>();

  constructor() {
    // Run cleanup every hour representing standard TTL eviction policy
    if (typeof setInterval !== "undefined") {
      const interval = setInterval(() => {
        this.cleanup();
      }, 3600000);
      // Unref if in Node environment to prevent blocking process exits
      if (interval && typeof interval.unref === "function") {
        interval.unref();
      }
    }
  }

  /**
   * Force manual purge of expired keys
   */
  public cleanup(): void {
    const cutoff = Date.now() - 86450000; // ~24 hours expiration TTL
    let deletedCount = 0;
    for (const [key, record] of this.registry.entries()) {
      if (record.createdAt < cutoff) {
        this.registry.delete(key);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      console.log(`[IdempotencyService] Purged ${deletedCount} expired idempotency keys.`);
    }
  }

  public get(key: string): IdempotencyRecord | undefined {
    return this.registry.get(key);
  }

  public set(key: string, record: IdempotencyRecord): void {
    this.registry.set(key, record);
  }

  public delete(key: string): void {
    this.registry.delete(key);
  }

  /**
   * Safe transaction replay detector and high-concurrency lock.
   * If another identical request is active, polls for maximum 5 seconds before reporting processing state.
   */
  public async acquireLock(key: string): Promise<{ success: boolean; record?: IdempotencyRecord }> {
    let record = this.registry.get(key);
    
    if (record && record.status === 'processing') {
      console.log(`[IdempotencyService] Lock hit in processing state for key: ${key}. Polling for parallel execution...`);
      for (let i = 0; i < 50; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        record = this.registry.get(key);
        if (!record || record.status !== 'processing') break;
      }
    }

    if (record) {
      if (record.status === 'completed' || record.status === 'processing') {
        console.log(`[IdempotencyService] Replay match found. Status: ${record.status} for key: ${key}`);
        return { success: false, record };
      }
    }

    // Acquire lock and label with timestamp for TTL expiration checks
    this.registry.set(key, {
      status: 'processing',
      createdAt: Date.now()
    });

    return { success: true };
  }
}

export const idempotencyService = new IdempotencyService();
