/**
 * Mizanora Ads API — SIRAVEX client integration.
 *
 * Mizanora (mizanora.vercel.app) par pehle se aik mukammal Ads API chalta
 * hai: campaigns Firestore me, API keys (`mza_…`), auto-optimise engine,
 * HMAC-token se mehfooz impression/click stats, aur `embed.js` script jo
 * kisi bhi site par `data-mz-ads` slots bhar deta hai. SIRAVEX usi ka
 * client hai — apna alag ads system nahi.
 *
 * Key publishable hai (script tag me lagti hai, AdSense publisher ID ki
 * tarah) — admin isay kabhi bhi revoke kar sakta hai. Stats ka fraud
 * mumkin nahi: har serve response ke sath short-lived signed token ata
 * hai jis ke baghair impression/click count nahi hota (server-side).
 *
 * Placements jo SIRAVEX istemal karta hai:
 *   '' / 'auto'  -> Home (server best ad chunta hai)
 *   'banner'     -> player ke neeche
 *   'video'      -> stream se pehle pre-roll (frequency-capped)
 *   'product'    -> Home par Mizanora product cards
 * Agar API se koi ad na aye (campaign inactive / key restricted) to slot
 * khali rehta hai — SIRAVEX wahan aik bundled house-promo dikhata hai
 * taake jagah kabhi khali na lage.
 */

export const MZ_ADS_HOST = 'https://mizanora.vercel.app';
export const MZ_ADS_KEY = 'mza_uMSJ8X9Q_UTiQWuxA3NQEUTp';

export type MzSlot = '' | 'auto' | 'banner' | 'video' | 'animation' | 'product' | 'html';

export function embedScriptUrl(key: string = MZ_ADS_KEY): string {
  return `${MZ_ADS_HOST}/api/ads/embed.js?key=${encodeURIComponent(key)}`;
}

/** Live check ke liye (diagnostics): serve endpoint ka URL. */
export function serveUrl(slot: MzSlot | string = 'auto', count = 1, key: string = MZ_ADS_KEY): string {
  return `${MZ_ADS_HOST}/api/ads/serve?key=${encodeURIComponent(key)}&slot=${encodeURIComponent(slot)}&count=${count}`;
}

interface MzAdsApi { refresh: () => void; disable: () => void; version?: string }
declare global {
  interface Window {
    MZADS?: { key?: string; rotate?: number; auto?: boolean };
    MZADS_API?: MzAdsApi;
    MZADS_LOADED?: number;
  }
}

let loadPromise: Promise<boolean> | null = null;

/** embed.js aik dafa load karo (idempotent). Kabhi reject nahi karta. */
export function ensureMzAdsLoaded(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(false);
  if (window.MZADS_API) return Promise.resolve(true);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<boolean>((resolve) => {
    try {
      window.MZADS = { ...(window.MZADS ?? {}), key: MZ_ADS_KEY, rotate: 8000, auto: false };
      const s = document.createElement('script');
      s.async = true;
      s.src = embedScriptUrl();
      s.onload = () => resolve(Boolean(window.MZADS_API));
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      window.setTimeout(() => resolve(Boolean(window.MZADS_API)), 4000); // slow network par bhi UI na atke
    } catch { resolve(false); }
  });
  return loadPromise;
}

/** Late-mount honay walay slots (route change) ko bharne ke liye. */
export function refreshMzAds(): void {
  try { window.MZADS_API?.refresh(); } catch { /* ignore */ }
}

export function disableMzAds(): void {
  try { window.MZADS_API?.disable(); } catch { /* ignore */ }
}

/** Pre-roll frequency: aik session me aik dafa + kam az kam freqMinutes ka gap. */
export const PREROLL_FREQ_MINUTES = 30;
export function shouldShowPreroll(opts: { lastShownAt: number; sessionShown: boolean; now: number; freqMinutes?: number }): boolean {
  if (opts.sessionShown) return false;
  if (!opts.lastShownAt) return true;
  return opts.now - opts.lastShownAt >= Math.max(1, opts.freqMinutes ?? PREROLL_FREQ_MINUTES) * 60000;
}

export const LS_PREROLL_LAST = 'siravex-mz-preroll-last';
export const SS_PREROLL_SHOWN = 'siravex-mz-preroll-shown';

/**
 * Bundled house-promos — jab tak Mizanora API se ads active nahi hote,
 * khali jagah par ye nazar ate hain (asal Mizanora offers, asal links).
 * API se pehla ad ate hi ye khud retire ho jate hain.
 */
export interface HousePromo { id: string; badge: string; title: string; sub: string; href: string; img?: string }
export const HOUSE_PROMOS: HousePromo[] = [
  { id: 'winter', badge: 'NEW SEASON', title: 'Mizanora Winter Collection', sub: 'Jackets, sweaters, shawls · Cash on Delivery', href: `${MZ_ADS_HOST}/`, img: 'https://i.ibb.co/8gwKB2Py/mizanora-1791569134352.jpg' },
  { id: 'footwear', badge: '60% OFF', title: 'Footwear Collection — 60% OFF', sub: 'Shoes & boots ki bari sale · COD', href: `${MZ_ADS_HOST}/category/footwear`, img: 'https://i.ibb.co/qYdYx9Qp/mizanora-1791568841712.jpg' },
  { id: 'watch', badge: '40% OFF', title: 'Watch Collection — 40% Discount', sub: 'Stylish watches, honest prices', href: `${MZ_ADS_HOST}/category/watch`, img: 'https://i.ibb.co/MDpm2Fyk/mizanora-1791567035676.jpg' },
  { id: 'cod', badge: 'COD', title: 'Cash on Delivery — Poore Pakistan Me', sub: 'Prices Rs 83 se shuru · WhatsApp support', href: `${MZ_ADS_HOST}/products` },
];
