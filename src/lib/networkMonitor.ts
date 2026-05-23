export type ConnectivityCallback = (isOnline: boolean) => void;

export class NetworkMonitor {
  private listeners: Set<ConnectivityCallback> = new Set();
  private online = true;

  constructor() {
    this.online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }

  private handleOnline = () => {
    this.online = true;
    this.notify();
  };

  private handleOffline = () => {
    this.online = false;
    this.notify();
  };

  subscribe(callback: ConnectivityCallback): () => void {
    this.listeners.add(callback);
    // Call immediately with current state
    callback(this.online);
    return () => {
      this.listeners.delete(callback);
    };
  }

  get isOnline(): boolean {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.listeners.clear();
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.online);
      } catch (e) {
        console.error('Error of network monitor subscriber', e);
      }
    }
  }
}

export const networkMonitorInstance = new NetworkMonitor();
