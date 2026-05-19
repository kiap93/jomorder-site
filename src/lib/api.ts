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
