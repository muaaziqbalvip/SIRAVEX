import { APP_VERSION } from './version';

const KEY = 'siravex-app-version';

/**
 * Nayi version par purana runtime cache saaf — "purani hash clear" ka kaam.
 * Service worker apni precache khud sambhalta hai; yahan sirf runtime
 * (images) cache purani version par flush hota hai.
 * @returns true agar is load par version BADLA ho (pehli dafa nahi).
 */
export function consumeVersionChange(): boolean {
  try {
    const prev = localStorage.getItem(KEY);
    localStorage.setItem(KEY, APP_VERSION);
    if (prev && prev !== APP_VERSION) {
      void clearRuntimeCaches();
      return true;
    }
  } catch { /* private mode */ }
  return false;
}

export async function clearRuntimeCaches(): Promise<void> {
  try {
    if (!('caches' in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.includes('siravex-images') || k.includes('runtime')).map((k) => caches.delete(k)));
  } catch { /* ignore */ }
}

/** Settings wala button: tamam caches saaf karke fresh reload. */
export async function clearAllCachesAndReload(): Promise<void> {
  try {
    if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
  } catch { /* ignore */ }
  window.location.reload();
}
