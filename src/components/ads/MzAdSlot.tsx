import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Megaphone, X } from 'lucide-react';
import { useStore } from '@/app/store';
import { HOUSE_PROMOS, LS_PREROLL_LAST, SS_PREROLL_SHOWN, ensureMzAdsLoaded, refreshMzAds, shouldShowPreroll, type MzSlot } from '@/lib/ads';
import { SafeImage } from '@/components/media/MediaCard';

const LS_SNOOZE = 'siravex-mz-snooze';

/**
 * Mizanora ad slot — embed.js is div ko bharta hai. Agar API se ad na
 * aye (abhi campaigns inactive hain) to 2.5s baad bundled house-promo
 * fallback nazar ata hai, taake jagah khali na lage. API se pehla asal
 * ad ate hi fallback khud hat jata hai (slot ke andar content ajata hai).
 */
export function MzAdSlot({ slot = 'auto', placement, className = '' }: { slot?: MzSlot; placement: 'home' | 'player'; className?: string }) {
  const { settings } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [filled, setFilled] = useState(false);
  const [snoozed, setSnoozed] = useState(() => { try { return Number(localStorage.getItem(LS_SNOOZE) ?? 0) > Date.now(); } catch { return false; } });
  const [promoIdx, setPromoIdx] = useState(0);
  const showAds = settings.showAds;

  useEffect(() => {
    if (!showAds) return;
    let alive = true;
    void ensureMzAdsLoaded().then(() => { if (alive) refreshMzAds(); });
    // Slot bhar gaya hai ya nahi — polling se detect (embed.js DOM bharta hai)
    const iv = window.setInterval(() => {
      const el = ref.current;
      if (el && el.childElementCount > 0) { setFilled(true); }
    }, 600);
    const stop = window.setTimeout(() => window.clearInterval(iv), 15000);
    return () => { alive = false; window.clearInterval(iv); window.clearTimeout(stop); };
  }, [showAds]);

  // House-promo rotation jab tak asal ad nahi ata
  useEffect(() => {
    if (filled || snoozed || !showAds) return;
    const iv = window.setInterval(() => setPromoIdx((i) => (i + 1) % HOUSE_PROMOS.length), 6000);
    return () => window.clearInterval(iv);
  }, [filled, snoozed, showAds]);

  if (!showAds || snoozed) return null;
  const promo = HOUSE_PROMOS[promoIdx % HOUSE_PROMOS.length];
  return (
    <div className={`relative ${className}`}>
      <div ref={ref} data-mz-ads={slot} className={filled ? '' : 'hidden'} aria-label="Mizanora advertisement" />
      {!filled && (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950 via-[#0a2e21] to-emerald-900 shadow-card">
          <span className="absolute left-3 top-2.5 z-10 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200"><Megaphone size={10} aria-hidden />Ad · Mizanora</span>
          <button type="button" aria-label="Hide Mizanora ads for today" onClick={() => { try { localStorage.setItem(LS_SNOOZE, String(Date.now() + 24 * 3600 * 1000)); } catch { /* ignore */ } setSnoozed(true); }} className="absolute right-2 top-2 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><X size={14} aria-hidden /></button>
          <a href={promo.href} target="_blank" rel="noopener noreferrer" className="flex min-h-[104px] items-stretch gap-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyanx">
            {promo.img && <span className="relative hidden w-32 shrink-0 min-[420px]:block sm:w-40"><SafeImage src={promo.img} title={promo.title} className="absolute inset-0 h-full w-full" /></span>}
            <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-3.5 pl-4">
              <span className="inline-flex w-fit rounded-full bg-[#F2C766] px-2 py-0.5 text-[10px] font-extrabold text-[#073D28]">{promo.badge}</span>
              <span className="truncate text-base font-extrabold text-white sm:text-lg">{promo.title}</span>
              <span className="truncate text-xs text-emerald-100/85 sm:text-sm">{promo.sub}</span>
              <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white">Shop on Mizanora<ExternalLink size={12} aria-hidden /></span>
            </span>
          </a>
          <span className="absolute bottom-2 right-3 flex gap-1" aria-hidden>{HOUSE_PROMOS.map((p, i) => <span key={p.id} className={`h-1.5 rounded-full transition-all ${i === (promoIdx % HOUSE_PROMOS.length) ? 'w-4 bg-[#F2C766]' : 'w-1.5 bg-white/30'}`} />)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Video pre-roll gate — player se pehle Mizanora video ad. Agar API se
 * video ad na aye (slot khali rahe) to 3s me khud dismiss ho jata hai —
 * viewer kabhi ad ki wajah se nahi rukta.
 */
export function MzPreroll({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [filled, setFilled] = useState(false);
  const [skipIn, setSkipIn] = useState(5);
  const doneRef = useRef(false);
  const finish = useCallback(() => { if (!doneRef.current) { doneRef.current = true; onDone(); } }, [onDone]);

  useEffect(() => {
    void ensureMzAdsLoaded().then(() => refreshMzAds());
    const started = Date.now();
    const iv = window.setInterval(() => {
      const el = ref.current;
      if (el && el.childElementCount > 0) setFilled(true);
      if (!filled && Date.now() - started > 3000) { window.clearInterval(iv); finish(); }
      if (Date.now() - started > 30000) { window.clearInterval(iv); finish(); } // max 30s gate
    }, 400);
    const cd = window.setInterval(() => setSkipIn((s) => Math.max(0, s - 1)), 1000);
    return () => { window.clearInterval(iv); window.clearInterval(cd); };
  }, [finish, filled]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black shadow-card" role="region" aria-label="Advertisement">
      <div ref={ref} data-mz-ads="video" className="absolute inset-0 [&>*]:h-full" />
      {!filled && <div className="absolute inset-0 grid place-items-center"><span className="grid place-items-center gap-2"><span className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/25 border-t-emerald-400" /><span className="text-xs text-white/70">Ad load ho raha hai…</span></span></div>}
      <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200"><Megaphone size={10} aria-hidden />Ad · Mizanora</span>
      <button type="button" disabled={skipIn > 0} onClick={finish} className="absolute bottom-3 right-3 min-h-[40px] rounded-full bg-white px-4 text-xs font-extrabold text-black shadow disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">
        {skipIn > 0 ? `Skip in ${skipIn}s` : 'Skip Ad →'}
      </button>
    </div>
  );
}

/** PlayerPage ke liye gate decision — frequency + session rules. */
export function usePrerollGate(): { show: boolean; dismiss: () => void } {
  const { settings } = useStore();
  const [show, setShow] = useState(() => {
    if (!settings.showAds) return false;
    try {
      const last = Number(localStorage.getItem(LS_PREROLL_LAST) ?? 0);
      const sessionShown = sessionStorage.getItem(SS_PREROLL_SHOWN) === '1';
      return shouldShowPreroll({ lastShownAt: last, sessionShown, now: Date.now() });
    } catch { return false; }
  });
  const dismiss = useCallback(() => {
    try { localStorage.setItem(LS_PREROLL_LAST, String(Date.now())); sessionStorage.setItem(SS_PREROLL_SHOWN, '1'); } catch { /* ignore */ }
    setShow(false);
  }, []);
  return { show, dismiss };
}
