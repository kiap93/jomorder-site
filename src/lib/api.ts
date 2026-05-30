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

export function getOrderDisplayNo(orderId: string, createdAt?: any): string {
  if (!orderId) return "";
  // Check if orderId is already in date+7digit format to avoid double-processing
  if (/^\d{15}$/.test(orderId)) return orderId;

  let dateObj: Date;
  if (!createdAt) {
    dateObj = new Date();
  } else if (createdAt instanceof Date) {
    dateObj = createdAt;
  } else if (typeof createdAt === 'object' && typeof createdAt.toDate === 'function') {
    dateObj = createdAt.toDate();
  } else {
    dateObj = new Date(createdAt);
  }

  if (isNaN(dateObj.getTime())) {
    dateObj = new Date();
  }

  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  // Deterministic local storage-backed incremental sequence to keep it perfectly sequential across refreshes and components
  let seq = 1;
  const LOCAL_STORAGE_KEY = 'pos_order_display_no_map';
  
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(LOCAL_STORAGE_KEY) : null;
    const map: Record<string, { dateStr: string; seq: number }> = raw ? JSON.parse(raw) : {};
    
    if (map[orderId]) {
      seq = map[orderId].seq;
    } else {
      // Clean up entries older than 14 days to keep storage clean
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      const cleanThreshold = parseInt(
        `${fourteenDaysAgo.getFullYear()}${String(fourteenDaysAgo.getMonth() + 1).padStart(2, '0')}${String(fourteenDaysAgo.getDate()).padStart(2, '0')}`,
        10
      );
      
      const cleanedMap: Record<string, { dateStr: string; seq: number }> = {};
      Object.keys(map).forEach(key => {
        const item = map[key];
        const itemDateVal = parseInt(item.dateStr, 10);
        if (!isNaN(itemDateVal) && itemDateVal >= cleanThreshold) {
          cleanedMap[key] = item;
        }
      });

      const sameDateOrders = Object.values(cleanedMap).filter(item => item.dateStr === dateStr);
      // Find the maximum sequence assigned for this date to avoid overlaps
      const maxSeq = sameDateOrders.reduce((max, item) => Math.max(max, item.seq), 0);
      seq = maxSeq + 1;
      
      cleanedMap[orderId] = { dateStr, seq };
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cleanedMap));
      }
    }
  } catch (err) {
    console.error("Error generating sequential order display number, falling back to safe hash:", err);
    // Fallback deterministic numeric hashing to ensure it has some unique representation if localStorage fails
    let hash = 0;
    for (let i = 0; i < orderId.length; i++) {
      hash = (hash << 5) - hash + orderId.charCodeAt(i);
      hash |= 0;
    }
    const positiveHash = Math.abs(hash);
    seq = (positiveHash % 1000) + 1; // 1-1000 space
  }

  const sevenDigit = String(seq).padStart(7, '0');
  return `${dateStr}${sevenDigit}`;
}

