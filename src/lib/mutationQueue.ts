type MutationTask = () => Promise<any>;

export class MutationQueue {
  private queue: MutationTask[] = [];
  private processing = false;
  private onSyncComplete?: (data: any) => void;

  constructor(onSyncComplete?: (data: any) => void) {
    this.onSyncComplete = onSyncComplete;
  }

  async enqueue(task: MutationTask) {
    this.queue.push(task);
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
    const task = this.queue.shift();

    if (task) {
      try {
        const result = await task();
        if (this.onSyncComplete) {
          this.onSyncComplete(result);
        }
      } catch (error) {
        console.error('Mutation failed:', error);
        // Implement retry logic if needed, or clear queue on fatal error
      }
    }

    await this.process();
  }

  get isIdle() {
    return !this.processing && this.queue.length === 0;
  }
}
