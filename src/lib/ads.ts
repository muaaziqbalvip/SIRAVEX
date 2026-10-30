/**
 * Mizanora Ads API — SIRAVEX v3.5.0 Direct Client Integration
 *
 * Connects directly to Mizanora's CORS-enabled `/api/ads/serve`, `/api/ads/impression`,
 * and `/api/ads/click` endpoints with signed HMAC tokens so SPA navigations, viewport
 * impressions, relative `/product/...` shop links, and video pre-rolls work reliably
 * without hidden-DOM IntersectionObserver deadlocks.
 */

export const MZ_ADS_HOST = 'https://mizanora.vercel.app';
export const MZ_ADS_KEY = 'mza_uMSJ8X9Q_UTiQWuxA3NQEUTp';

export type MzSlot = '' | 'auto' | 'banner' | 'sidebar' | 'feed' | 'video' | 'animation' | 'product' | 'footer' | 'html';

export function embedScriptUrl(key: string = MZ_ADS_KEY): string {
  return `${MZ_ADS_HOST}/api/ads/embed.js?key=${encodeURIComponent(key)}`;
}

/** Live serve endpoint URL for Mizanora campaigns & diagnostics. */
export function serveUrl(slot: MzSlot | string = 'auto', count = 1, key: string = MZ_ADS_KEY): string {
  return `${MZ_ADS_HOST}/api/ads/serve?key=${encodeURIComponent(key)}&slot=${encodeURIComponent(slot)}&count=${count}`;
}

export interface MzProductMeta {
  title?: string;
  price?: number | string;
  compareAt?: number | string;
  currency?: string;
  image?: string;
  badge?: string;
  slug?: string;
}

export interface MzVideoMeta {
  url?: string;
  poster?: string;
  duration?: number;
  skipAfter?: number;
  muted?: boolean;
}

export interface MzAdItem {
  id: string;
  type: 'banner' | 'native' | 'product' | 'video' | 'html';
  name?: string;
  headline?: string;
  sub?: string;
  cta?: string;
  href?: string;
  img?: string;
  bg?: string;
  anim?: 'fade' | 'pulse' | 'float' | 'shine' | 'none' | string;
  video?: MzVideoMeta | null;
  product?: MzProductMeta | null;
  html?: string | null;
  token?: string;
}

export interface MzServeResult {
  ok: boolean;
  ads: MzAdItem[];
  rotateMs: number;
  error?: string;
}

interface MzAdsApi {
  refresh?: () => void;
  disable?: () => void;
  disabled?: boolean;
  version?: string;
}

declare global {
  interface Window {
    MZADS?: { key?: string; rotate?: number; auto?: boolean };
    MZADS_API?: MzAdsApi;
    MZADS_LOADED?: number;
  }
}

export type AdsLoadState = 'idle' | 'loading' | 'ready' | 'failed';

let state: AdsLoadState = 'idle';
let disabledRuntime = false;

interface CacheEntry {
  at: number;
  promise: Promise<MzServeResult>;
}
const serveCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 45_000;
const FETCH_TIMEOUT_MS = 2_000;

export function getAdsState(): AdsLoadState {
  return state;
}

export function adsEnabled(settingOn: boolean): boolean {
  return Boolean(settingOn);
}

/**
 * Safely resolves Mizanora campaign destination URLs.
 * Relative paths (such as `/product/slug` from Mizanora product ads) resolve against
 * `https://mizanora.vercel.app` instead of breaking on SIRAVEX's own domain.
 * Blocks unsafe schemes (`javascript:`, `data:`, `vbscript:`).
 */
export function resolveMzHref(raw?: string | null): string {
  const s = (raw ?? '').trim();
  if (!s) return MZ_ADS_HOST;
  try {
    const u = s.startsWith('/') ? new URL(s, MZ_ADS_HOST) : new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return MZ_ADS_HOST;
    return u.toString();
  } catch {
    return MZ_ADS_HOST;
  }
}

/** Safely resolves campaign image or video URLs (supports relative paths on Mizanora). */
export function resolveMzMediaUrl(raw?: string | null): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  try {
    const u = s.startsWith('/') ? new URL(s, MZ_ADS_HOST) : new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function formatMzPrice(val?: number | string | null, currency = 'PKR'): string | null {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0) return String(val);
  const sym = currency.toUpperCase() === 'USD' ? '$' : currency.toUpperCase() === 'PKR' ? 'Rs. ' : `${currency} `;
  return `${sym}${n.toLocaleString()}`;
}

/** Ensure ads runtime is warm. Never rejects. */
export function ensureMzAdsLoaded(): Promise<boolean> {
  disabledRuntime = false;
  if (typeof window !== 'undefined' && window.MZADS_API) {
    window.MZADS_API.disabled = false;
  }
  if (state === 'ready') return Promise.resolve(true);
  return fetchMzSlot('auto', 1).then((res) => res.ok);
}

/** Clear slot cache so route transitions can load fresh Mizanora campaigns. */
export function refreshMzAds(): void {
  serveCache.clear();
  try { window.MZADS_API?.refresh?.(); } catch { /* ignore */ }
}

/** Disable Mizanora runtime & clear slot cache when user disables ads in Settings. */
export function disableMzAds(): void {
  disabledRuntime = true;
  serveCache.clear();
  state = 'idle';
  if (typeof window !== 'undefined' && window.MZADS_API) {
    try {
      window.MZADS_API.disabled = true;
      window.MZADS_API.disable?.();
    } catch { /* ignore */ }
  }
}

/** Clear test/runtime cache (helpful in unit tests). */
export function clearMzAdsCache(): void {
  disabledRuntime = false;
  serveCache.clear();
  state = 'idle';
}

/**
 * Fetch campaigns directly from Mizanora `/api/ads/serve`.
 * Dedupes concurrent requests per `(slot, count)` for 25s so SPA transitions stay snappy.
 */
export function fetchMzSlot(slot: MzSlot = 'auto', count = 3, force = false): Promise<MzServeResult> {
  if (disabledRuntime && !force) {
    return Promise.resolve({ ok: false, ads: [], rotateMs: 12_000, error: 'disabled' });
  }
  disabledRuntime = false;
  const normalizedSlot = slot || 'auto';
  const cacheKey = `${normalizedSlot}:${count}`;
  const now = Date.now();
  const hit = !force ? serveCache.get(cacheKey) : undefined;
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.promise;

  if (state === 'idle') state = 'loading';

  const promise = (async (): Promise<MzServeResult> => {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const url = serveUrl(normalizedSlot, count, MZ_ADS_KEY);
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal: ctrl?.signal,
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        state = 'failed';
        serveCache.delete(cacheKey);
        return { ok: false, ads: [], rotateMs: 12_000, error: `HTTP ${res.status}` };
      }
      const data = (await res.json()) as Partial<MzServeResult>;
      const ads = Array.isArray(data?.ads) ? data.ads.filter((a): a is MzAdItem => Boolean(a && a.id)) : [];
      const rotateMs = typeof data?.rotateMs === 'number' && data.rotateMs >= 4_000 ? data.rotateMs : 12_000;
      state = 'ready';
      return { ok: Boolean(data?.ok ?? true), ads, rotateMs };
    } catch (err) {
      state = 'failed';
      serveCache.delete(cacheKey);
      return { ok: false, ads: [], rotateMs: 12_000, error: err instanceof Error ? err.message : 'network' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  serveCache.set(cacheKey, { at: now, promise });
  return promise;
}

/** Fire signed Mizanora impression or click event (non-blocking, cookie-free). */
export function trackMzEvent(kind: 'impression' | 'click', ad: Pick<MzAdItem, 'id' | 'token' | 'href'>): void {
  if (!ad?.id || !ad?.token || disabledRuntime) return;
  const endpoint = `${MZ_ADS_HOST}/api/ads/${kind === 'click' ? 'click' : 'impression'}`;
  const payload = JSON.stringify({
    key: MZ_ADS_KEY,
    campaign: ad.id,
    token: ad.token,
    href: resolveMzHref(ad.href),
  });
  try {
    void fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => undefined);
  } catch { /* ignore ad-blocker / offline */ }
}

/** Pre-roll frequency: once per session AND at least `freqMinutes` apart across tabs. */
export const PREROLL_FREQ_MINUTES = 30;
export function shouldShowPreroll(opts: {
  lastShownAt: number;
  sessionShown: boolean;
  now: number;
  freqMinutes?: number;
}): boolean {
  if (opts.sessionShown) return false;
  if (!opts.lastShownAt) return true;
  return opts.now - opts.lastShownAt >= Math.max(1, opts.freqMinutes ?? PREROLL_FREQ_MINUTES) * 60_000;
}

export const LS_PREROLL_LAST = 'siravex-mz-preroll-last';
export const SS_PREROLL_SHOWN = 'siravex-mz-preroll-shown';

/**
 * Bundled Mizanora shop house-promos — shown when no live API campaign is active
 * for a slot so placements stay polished with real Mizanora offers.
 */
export interface HousePromo {
  id: string;
  badge: string;
  title: string;
  sub: string;
  href: string;
  img?: string;
}

export const HOUSE_PROMOS: HousePromo[] = [
  {
    id: 'winter',
    badge: 'NEW SEASON',
    title: 'Mizanora Winter Collection',
    sub: 'Jackets, sweaters, shawls · Cash on Delivery',
    href: `${MZ_ADS_HOST}/`,
    img: 'https://i.ibb.co/8gwKB2Py/mizanora-1791569134352.jpg',
  },
  {
    id: 'footwear',
    badge: '60% OFF',
    title: 'Footwear Collection — 60% OFF',
    sub: 'Shoes & boots ki bari sale · COD',
    href: `${MZ_ADS_HOST}/category/footwear`,
    img: 'https://i.ibb.co/qYdYx9Qp/mizanora-1791568841712.jpg',
  },
  {
    id: 'watch',
    badge: '40% OFF',
    title: 'Watch Collection — 40% Discount',
    sub: 'Stylish watches, honest prices',
    href: `${MZ_ADS_HOST}/category/watch`,
    img: 'https://i.ibb.co/MDpm2Fyk/mizanora-1791567035676.jpg',
  },
  {
    id: 'cod',
    badge: 'COD',
    title: 'Cash on Delivery — Poore Pakistan Me',
    sub: 'Prices Rs 83 se shuru · WhatsApp support',
    href: `${MZ_ADS_HOST}/products`,
  },
];
