export const getApiUrl = (path: string) => {
  const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${cleanPath}`;
  console.log(`[getApiUrl] Generated URL for "${path}":`, url);
  if (base === '') {
    console.warn(`[getApiUrl] VITE_API_BASE_URL is not set. Using relative path: ${url}`);
  }
  return url;
};

export function getOrderDisplayNo(orderId: string, createdAt?: string): string {
  if (!orderId) return "";
  // Check if orderId is already in date+7digit format to avoid double-processing
  if (/^\d{15}$/.test(orderId)) return orderId;
  const dateObj = createdAt ? new Date(createdAt) : new Date();
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  let hash = 0;
  for (let i = 0; i < orderId.length; i++) {
    hash = (hash << 5) - hash + orderId.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash);
  const sevenDigit = String(positiveHash % 10000000).padStart(7, '0');
  return `${dateStr}${sevenDigit}`;
}

