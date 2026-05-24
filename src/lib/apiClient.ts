import { useAuthStore } from '../store/useAuthStore';
import { networkMonitorInstance } from './networkMonitor';
import { getApiUrl } from './api';

export interface ApiClientOptions extends RequestInit {
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  deduplicate?: boolean;
  skipAuth?: boolean;
}

export class ApiError extends Error {
  public status?: number;
  public statusText?: string;
  public info?: any;

  constructor(message: string, status?: number, statusText?: string, info?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.info = info;
  }
}

// Map to track active in-flight requests for deduplication
const activeRequests = new Map<string, Promise<any>>();

/**
 * Generates a stable key for request deduplication
 */
function getRequestKey(url: string, options: ApiClientOptions): string {
  const method = options.method || 'GET';
  const bodyStr = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : '';
  return `${method}:${url}:${bodyStr}`;
}

/**
 * Enterprise client-side API layer normalized client.
 */
export async function apiClient<T = any>(url: string, options: ApiClientOptions = {}): Promise<T> {
  const resolvedUrl = url.startsWith('/') ? getApiUrl(url) : url;
  const method = options.method || 'GET';
  const maxRetries = options.maxRetries ?? (method === 'GET' ? 3 : 0); // Default 3 retries for GET, 0 for write actions unless specified
  const timeoutMs = options.timeout ?? 15000; // 15 seconds default timeout
  const baseDelay = options.retryDelay ?? 1000;
  const shouldDeduplicate = options.deduplicate ?? (method === 'GET'); // Deduplicate GET requests by default
  const traceId = 'tr_' + Math.random().toString(36).slice(2, 9);

  // 1. Offline Awareness Check
  if (!networkMonitorInstance.isOnline) {
    console.warn(`[API Client] [${traceId}] Network is currently offline. Blocking outgoing request to: ${resolvedUrl}`);
    throw new ApiError('No internet connection. Please check your network and try again.', 0, 'Offline');
  }

  // 2. Request Deduplication Logic
  const reqKey = getRequestKey(resolvedUrl, options);
  if (shouldDeduplicate && activeRequests.has(reqKey)) {
    console.log(`[API Client] [${traceId}] Deduplicating identical parallel request. Sharing pre-existing request-promise: ${resolvedUrl}`);
    return activeRequests.get(reqKey)!;
  }

  const execRequest = async (): Promise<T> => {
    let attempt = 0;

    while (attempt <= maxRetries) {
      attempt++;
      const startTime = performance.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Create proper request configuration
      const config: RequestInit = {
        ...options,
        signal: controller.signal,
      };

      // 3. Inject Headers and Authentication
      const headers = new Headers(config.headers || {});
      if (!headers.has('Content-Type') && !(config.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }

      // Add auth token if available and not skipped
      if (!options.skipAuth) {
        const token = useAuthStore.getState().token;
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        }
      }

      config.headers = headers;

      // 4. Tracing - Log execution flow
      console.log(
        `[API Client] [${traceId}] [Attempt ${attempt}/${maxRetries + 1}] Dispatching: ${method} ${resolvedUrl}`,
        { timeoutMs, skipAuth: options.skipAuth }
      );

      try {
        const response = await fetch(resolvedUrl, config);
        clearTimeout(timeoutId);

        const duration = Math.round(performance.now() - startTime);
        console.log(`[API Client] [${traceId}] Response received back in ${duration}ms with status: ${response.status}`);

        // 5. Response Validation
        if (!response.ok) {
          let errorInfo: any = null;
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            try {
              errorInfo = await response.json();
            } catch (_) {}
          } else {
            try {
              errorInfo = await response.text();
            } catch (_) {}
          }

          throw new ApiError(
            errorInfo?.error || errorInfo?.message || `API returned status code ${response.status}`,
            response.status,
            response.statusText,
            errorInfo
          );
        }

        // Return empty object on 204 No Content
        if (response.status === 204) {
          return {} as T;
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const parsedData = await response.json();
          // Custom deep-validation of JSON can be done here if needed
          return parsedData as T;
        }

        return (await response.text()) as unknown as T;

      } catch (err: any) {
        clearTimeout(timeoutId);
        const duration = Math.round(performance.now() - startTime);

        const isTimeout = err.name === 'AbortError';
        const isNetworkFailure = err instanceof TypeError; // fetch throws TypeError on DNS/connection failure

        console.error(
          `[API Client] [${traceId}] Request failed on attempt ${attempt}. Error: ${err.message || err}`,
          { isTimeout, isNetworkFailure, duration }
        );

        // If we still have retry attempts, and it is a temporary network issue/timeout or 5xx server error, we can retry with backoff
        const isRetryableError = isTimeout || isNetworkFailure || (err instanceof ApiError && err.status && err.status >= 500);
        
        if (attempt <= maxRetries && isRetryableError) {
          const backoffDelay = Math.pow(2, attempt - 1) * baseDelay;
          console.warn(`[API Client] [${traceId}] Error is retryable. Retrying in ${backoffDelay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          continue;
        }

        // Rethrow the error if we are out of retries or if it's a non-retryable error (such as 4xx validation or client error)
        if (isTimeout) {
          throw new ApiError(`Request to ${resolvedUrl} timed out after ${timeoutMs}ms`, 408, 'Request Timeout');
        }
        throw err;
      }
    }

    throw new ApiError('Unexpected error concluding request', 500, 'Internal Client Error');
  };

  if (shouldDeduplicate) {
    const freshPromise = execRequest().finally(() => {
      activeRequests.delete(reqKey);
    });
    activeRequests.set(reqKey, freshPromise);
    return freshPromise;
  }

  return execRequest();
}

/**
 * Standard utility API helpers mapping standard HTTP methods.
 */
apiClient.get = <T = any>(url: string, options?: ApiClientOptions) => 
  apiClient<T>(url, { ...options, method: 'GET' });

apiClient.post = <T = any>(url: string, body?: any, options?: ApiClientOptions) => 
  apiClient<T>(url, { ...options, method: 'POST', body: body ? JSON.stringify(body) : undefined });

apiClient.put = <T = any>(url: string, body?: any, options?: ApiClientOptions) => 
  apiClient<T>(url, { ...options, method: 'PUT', body: body ? JSON.stringify(body) : undefined });

apiClient.patch = <T = any>(url: string, body?: any, options?: ApiClientOptions) => 
  apiClient<T>(url, { ...options, method: 'PATCH', body: body ? JSON.stringify(body) : undefined });

apiClient.delete = <T = any>(url: string, options?: ApiClientOptions) => 
  apiClient<T>(url, { ...options, method: 'DELETE' });
