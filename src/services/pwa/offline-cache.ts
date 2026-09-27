const CACHE_PREFIX = 'promptdesk-shell-';

export async function clearOfflineShellCache(): Promise<boolean> {
  if (!('caches' in window)) return false;
  const keys = await window.caches.keys();
  const appCaches = keys.filter((key) => key.startsWith(CACHE_PREFIX));
  const results = await Promise.all(appCaches.map((key) => window.caches.delete(key)));
  return results.every(Boolean);
}
