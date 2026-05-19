export const getApiUrl = (path: string) => {
  const base = import.meta.env.VITE_API_BASE_URL || '';
  return `${base}${path}`;
};
