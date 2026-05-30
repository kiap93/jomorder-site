/**
 * High-performance, environmental logs router.
 * Elegantly structures server-side and browser-client telemetry.
 * In production environment, silences verbose console logs/debugs/infos to clean telemetry stream.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class StandardLogger {
  private get isProduction(): boolean {
    // browser dynamic check
    if (typeof window !== 'undefined') {
      return (
        import.meta.env?.PROD ||
        (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
      );
    }
    // backend/server CLI check
    return process.env.NODE_ENV === 'production';
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  public debug(message: string, ...args: any[]): void {
    if (!this.isProduction) {
      console.debug(this.formatMessage('debug', message), ...args);
    }
  }

  public info(message: string, ...args: any[]): void {
    if (!this.isProduction) {
      console.info(this.formatMessage('info', message), ...args);
    }
  }

  public warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage('warn', message), ...args);
  }

  public error(message: string, ...args: any[]): void {
    console.error(this.formatMessage('error', message), ...args);
  }
}

export const logger = new StandardLogger();

// Automatically self-patch console on module load in production to suppress legacy/noisy logs
const isProductionEnv = typeof window !== 'undefined'
  ? (import.meta.env?.PROD || (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'))
  : (process.env.NODE_ENV === 'production');

if (isProductionEnv) {
  try {
    console.log = () => {};
    console.info = () => {};
    console.debug = () => {};
  } catch (_) {
    // Non-fatal fallback if standard logger object holds locked attributes
  }
}
