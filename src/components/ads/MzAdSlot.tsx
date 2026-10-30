import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Megaphone, Tag, Volume2, VolumeX, X } from 'lucide-react';
import { useStore } from '@/app/store';
import { SafeImage } from '@/components/media/MediaCard';
import {
  adsEnabled,
  disableMzAds,
  fetchMzSlot,
  formatMzPrice,
  HOUSE_PROMOS,
  LS_PREROLL_LAST,
  resolveMzHref,
  resolveMzMediaUrl,
  shouldShowPreroll,
  SS_PREROLL_SHOWN,
  trackMzEvent,
  type MzAdItem,
  type MzSlot,
} from '@/lib/ads';

const LS_SNOOZE = 'siravex-mz-snooze';

function safeBgStyle(bg?: string): React.CSSProperties | undefined {
  if (!bg) return undefined;
  const trimmed = bg.trim();
  if (/[;\\]|url\s*\(|expression\s*\(/i.test(trimmed)) return undefined;
  if (/^(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|(linear|radial)-gradient\([^)]+\))$/i.test(trimmed)) {
    return { background: trimmed };
  }
  return undefined;
}

export interface MzAdSlotProps {
  slot?: MzSlot;
  placement?: 'home' | 'player' | 'epg' | string;
  compact?: boolean;
  className?: string;
}

/**
 * Mizanora Ad Slot — Zero-Collision Mobile-First Card + Signed Impression/Click Tracking.
 */
export function MzAdSlot({
  slot = 'auto',
  placement = 'home',
  compact = false,
  className = '',
}: MzAdSlotProps) {
  const { settings } = useStore();
  const showAds = adsEnabled(settings.showAds);
  const hostRef = useRef<HTMLDivElement>(null);
  const impressedIds = useRef<Set<string>>(new Set());

  const [snoozed, setSnoozed] = useState(() => {
    try { return Number(localStorage.getItem(LS_SNOOZE) ?? 0) > Date.now(); } catch { return false; }
  });
  const [ads, setAds] = useState<MzAdItem[]>([]);
  const [rotateMs, setRotateMs] = useState(8_000);
  const [adIdx, setAdIdx] = useState(0);
  const [promoIdx, setPromoIdx] = useState(() => (placement === 'player' ? 1 : 0));
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!showAds) {
      disableMzAds();
      setAds([]);
      return;
    }
    if (snoozed) return;
    let alive = true;
    void fetchMzSlot(slot, 3).then((res) => {
      if (!alive) return;
      setAds(res.ads);
      setRotateMs(res.rotateMs);
      setAdIdx(0);
    });
    return () => { alive = false; };
  }, [showAds, snoozed, slot, placement]);

  useEffect(() => {
    if (!showAds || snoozed || ads.length <= 1) return;
    const iv = window.setInterval(() => setAdIdx((i) => (i + 1) % ads.length), Math.max(5_000, rotateMs));
    return () => window.clearInterval(iv);
  }, [showAds, snoozed, ads.length, rotateMs]);

  useEffect(() => {
    if (!showAds || snoozed || ads.length > 0) return;
    const iv = window.setInterval(() => setPromoIdx((i) => (i + 1) % HOUSE_PROMOS.length), 6_000);
    return () => window.clearInterval(iv);
  }, [showAds, snoozed, ads.length]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !showAds || snoozed) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [showAds, snoozed, ads.length]);

  const activeAd = ads.length > 0 ? ads[adIdx % ads.length] : null;

  useEffect(() => {
    if (!inView || !activeAd) return;
    const key = `${placement}:${activeAd.id}`;
    if (impressedIds.current.has(key)) return;
    impressedIds.current.add(key);
    trackMzEvent('impression', activeAd);
  }, [inView, activeAd, placement]);

  if (!showAds || snoozed) return null;

  const snoozeFor24h = () => {
    try { localStorage.setItem(LS_SNOOZE, String(Date.now() + 24 * 3600 * 1000)); } catch { /* ignore */ }
    setSnoozed(true);
  };

  if (activeAd) {
    const isProduct = activeAd.type === 'product' && activeAd.product;
    const isVideo = activeAd.type === 'video' && activeAd.video?.url;
    const href = resolveMzHref(
      activeAd.href || (isProduct && activeAd.product?.slug ? `/product/${activeAd.product.slug}` : undefined),
    );
    const imgUrl = resolveMzMediaUrl(isProduct ? (activeAd.product?.image || activeAd.img) : activeAd.img);
    const videoUrl = isVideo ? resolveMzMediaUrl(activeAd.video?.url) : null;
    const videoPoster = isVideo ? resolveMzMediaUrl(activeAd.video?.poster || activeAd.img) : null;
    const title = (isProduct ? activeAd.product?.title : undefined) || activeAd.headline || activeAd.name || 'Mizanora Featured Offer';
    const sub = activeAd.sub || '';
    const cta = activeAd.cta || 'Shop on Mizanora';
    const price = isProduct ? formatMzPrice(activeAd.product?.price, activeAd.product?.currency) : null;
    const compareAt = isProduct ? formatMzPrice(activeAd.product?.compareAt, activeAd.product?.currency) : null;
    const badge = (isProduct ? activeAd.product?.badge : undefined) || (isProduct ? 'SHOP' : undefined);
    const customBg = safeBgStyle(activeAd.bg);

    return (
      <div ref={hostRef} className={`w-full min-w-0 max-w-full ${className}`} data-mz-ads={slot}>
        <div
          className="overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950 via-[#0a2e21] to-emerald-900 shadow-card"
          style={customBg}
        >
          {/* Non-overlapping top meta bar */}
          <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
              {isProduct ? <Tag size={10} aria-hidden /> : <Megaphone size={10} aria-hidden />}
              Ad · Mizanora
            </span>
            <div className="flex items-center gap-2">
              {ads.length > 1 && (
                <span className="flex gap-1" aria-hidden>
                  {ads.map((a, i) => (
                    <span key={a.id} className={`h-1.5 rounded-full transition-all ${i === (adIdx % ads.length) ? 'w-4 bg-[#F2C766]' : 'w-1.5 bg-white/30'}`} />
                  ))}
                </span>
              )}
              <button
                type="button"
                aria-label="Hide Mizanora ads for today"
                onClick={snoozeFor24h}
                className="grid h-6 w-6 place-items-center rounded-full bg-black/40 text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"
              >
                <X size={13} aria-hidden />
              </button>
            </div>
          </div>

          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={() => trackMzEvent('click', activeAd)}
            className="flex min-w-0 items-center gap-3 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyanx sm:gap-4 sm:p-3.5"
          >
            {videoUrl && !compact ? (
              <span className="relative h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-black sm:h-24 sm:w-36">
                <video
                  src={videoUrl}
                  poster={videoPoster ?? undefined}
                  muted
                  loop
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              </span>
            ) : imgUrl && !compact ? (
              <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-black/30 sm:h-24 sm:w-32">
                <SafeImage src={imgUrl} title={title} className="h-full w-full" />
              </span>
            ) : null}

            <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
              {(badge || price) && (
                <span className="flex flex-wrap items-center gap-1.5">
                  {badge && (
                    <span className="inline-flex rounded-full bg-[#F2C766] px-2 py-0.5 text-[10px] font-extrabold text-[#073D28]">
                      {badge}
                    </span>
                  )}
                  {price && (
                    <span className="inline-flex items-baseline gap-1.5 text-xs font-extrabold text-[#F2C766]">
                      <span>{price}</span>
                      {compareAt && <span className="text-[11px] font-normal text-white/50 line-through">{compareAt}</span>}
                    </span>
                  )}
                </span>
              )}
              <span className="line-clamp-1 text-sm font-extrabold text-white sm:text-base">{title}</span>
              {!compact && sub && <span className="line-clamp-1 text-xs text-emerald-100/85">{sub}</span>}
              <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-bold text-white sm:text-xs">
                {cta}
                <ExternalLink size={11} aria-hidden />
              </span>
            </span>
          </a>
        </div>
      </div>
    );
  }

  // Fallback: Mizanora shop house-promos
  const promo = HOUSE_PROMOS[promoIdx % HOUSE_PROMOS.length];
  return (
    <div ref={hostRef} className={`w-full min-w-0 max-w-full ${className}`} data-mz-ads={slot}>
      <div className="overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950 via-[#0a2e21] to-emerald-900 shadow-card">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
            <Megaphone size={10} aria-hidden />Ad · Mizanora
          </span>
          <div className="flex items-center gap-2">
            <span className="flex gap-1" aria-hidden>
              {HOUSE_PROMOS.map((p, i) => (
                <span key={p.id} className={`h-1.5 rounded-full transition-all ${i === (promoIdx % HOUSE_PROMOS.length) ? 'w-4 bg-[#F2C766]' : 'w-1.5 bg-white/30'}`} />
              ))}
            </span>
            <button
              type="button"
              aria-label="Hide Mizanora ads for today"
              onClick={snoozeFor24h}
              className="grid h-6 w-6 place-items-center rounded-full bg-black/40 text-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        </div>

        <a
          href={promo.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-3 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyanx sm:gap-4 sm:p-3.5"
        >
          {promo.img && !compact && (
            <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-black/30 sm:h-24 sm:w-32">
              <SafeImage src={promo.img} title={promo.title} className="h-full w-full" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <span className="inline-flex w-fit rounded-full bg-[#F2C766] px-2 py-0.5 text-[10px] font-extrabold text-[#073D28]">
              {promo.badge}
            </span>
            <span className="line-clamp-1 text-sm font-extrabold text-white sm:text-base">{promo.title}</span>
            {!compact && <span className="line-clamp-1 text-xs text-emerald-100/85">{promo.sub}</span>}
            <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-500 px-3 py-1 text-[11px] font-bold text-white sm:text-xs">
              Shop on Mizanora<ExternalLink size={11} aria-hidden />
            </span>
          </span>
        </a>
      </div>
    </div>
  );
}

/**
 * Fast Skippable Video Pre-Roll Gate — races `/api/ads/serve?slot=video` with a strict 900ms budget
 * so viewers NEVER wait on slow ad checks when opening a VOD stream.
 */
export function MzPreroll({ onDone }: { onDone: () => void }) {
  const { settings } = useStore();
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDoneRef.current();
  }, []);

  const [ad, setAd] = useState<MzAdItem | null>(null);
  const [muted, setMuted] = useState(true);
  const [skipIn, setSkipIn] = useState(5);

  useEffect(() => {
    if (!adsEnabled(settings.showAds)) {
      finish();
      return;
    }
    let cancelled = false;
    let matched = false;
    const fastBail = window.setTimeout(() => {
      if (!matched) finish();
    }, 900);
    const hardCap = window.setTimeout(finish, 18_000);

    void fetchMzSlot('video', 1).then((res) => {
      if (cancelled || doneRef.current) return;
      const candidate = res.ads.find((a) => a.type === 'video' && resolveMzMediaUrl(a.video?.url));
      if (!candidate) {
        finish();
        return;
      }
      matched = true;
      window.clearTimeout(fastBail);
      const skipSec = Math.min(8, Math.max(3, Number(candidate.video?.skipAfter ?? 5) || 5));
      setSkipIn(skipSec);
      setAd(candidate);
      trackMzEvent('impression', candidate);
    }).catch(() => finish());

    return () => {
      cancelled = true;
      window.clearTimeout(fastBail);
      window.clearTimeout(hardCap);
    };
  }, [settings.showAds, finish]);

  useEffect(() => {
    if (!ad) return;
    const cd = window.setInterval(() => setSkipIn((s) => Math.max(0, s - 1)), 1_000);
    return () => window.clearInterval(cd);
  }, [ad]);

  if (!ad) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black shadow-card" role="region" aria-label="Starting stream">
        <div className="absolute inset-0 grid place-items-center">
          <span className="grid place-items-center gap-2">
            <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/25 border-t-cyan-400" />
            <span className="text-xs text-white/70">Starting stream…</span>
          </span>
        </div>
      </div>
    );
  }

  const videoUrl = resolveMzMediaUrl(ad.video?.url) ?? '';
  const posterUrl = resolveMzMediaUrl(ad.video?.poster || ad.img) ?? undefined;
  const href = resolveMzHref(ad.href);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black shadow-card" role="region" aria-label="Advertisement">
      <video
        src={videoUrl}
        poster={posterUrl}
        autoPlay
        muted={muted}
        playsInline
        onEnded={finish}
        onError={finish}
        className="h-full w-full bg-black object-contain"
      />
      <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-black/65 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200 backdrop-blur">
          <Megaphone size={10} aria-hidden />Ad · Mizanora
        </span>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? 'Unmute ad' : 'Mute ad'}
          className="grid h-8 w-8 place-items-center rounded-full bg-black/65 text-white hover:bg-black"
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-8">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-white">{ad.headline || ad.name || 'Mizanora'}</p>
          {ad.sub && <p className="truncate text-xs text-white/75">{ad.sub}</p>}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={() => trackMzEvent('click', ad)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-emerald-500 px-3 text-xs font-extrabold text-white shadow hover:bg-emerald-400"
          >
            {ad.cta || 'Shop'}
            <ExternalLink size={12} aria-hidden />
          </a>
          <button
            type="button"
            disabled={skipIn > 0}
            onClick={finish}
            className="min-h-[38px] rounded-full bg-white px-3.5 text-xs font-extrabold text-black shadow disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"
          >
            {skipIn > 0 ? `Skip ${skipIn}s` : 'Skip Ad →'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** PlayerPage gate decision — frequency + session rules + respects settings.showAds live. */
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
    try {
      localStorage.setItem(LS_PREROLL_LAST, String(Date.now()));
      sessionStorage.setItem(SS_PREROLL_SHOWN, '1');
    } catch { /* ignore */ }
    setShow(false);
  }, []);
  return { show: show && adsEnabled(settings.showAds), dismiss };
}
