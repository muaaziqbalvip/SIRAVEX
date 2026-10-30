import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Play, Star, Tv } from 'lucide-react';
import type { MediaItem } from '@/types/models';
import { useStore } from '@/app/store';
import { cleanGroup, cleanTitle } from '@/lib/display';

function initials(title: string): string {
  return title.replace(/[^A-Za-z0-9 ]/g, ' ').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'S';
}

/** Broken provider images used to leave a blank box (looked like a glitch). Now: branded fallback. */
export function SafeImage({ src, title, className, contain = false }: { src?: string; title: string; className?: string; contain?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) {
    return (
      <span className={`grid place-items-center bg-gradient-to-br from-sky-950 via-panel to-ink ${className ?? ''}`} aria-hidden>
        <span className="grid place-items-center gap-1 p-2 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-sky-500/15 font-extrabold text-sky-300">{initials(title)}</span>
          <span className="line-clamp-2 text-[11px] font-semibold leading-4 text-silver/90">{title}</span>
        </span>
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${contain ? 'object-contain' : 'object-cover'} ${className ?? ''}`} />;
}

export const MediaCard = memo(function MediaCard({ item, progressPct }: { item: MediaItem; progressPct?: number }) {
  const { toggleFavourite, isFavourite } = useStore();
  const fav = isFavourite(item.id);
  const img = item.poster || item.logo;
  const displayTitle = cleanTitle(item.title);
  return (
    <article className="group w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-border bg-card shadow-card focus-within:ring-2 focus-within:ring-cyanx">
      <Link to={`/player/${encodeURIComponent(item.id)}`} className="block focus:outline-none" aria-label={`Play ${displayTitle}`}>
        <span className="relative block aspect-[2/3] overflow-hidden bg-panel">
          <SafeImage src={img} title={item.title} className="h-full w-full transition duration-300 group-hover:scale-[1.03]" />
          <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"><Play className="text-white drop-shadow" size={36} aria-hidden /></span>
          {item.kind === 'live' && <span className="absolute left-2 top-2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-white">LIVE</span>}
          {item.rating ? <span className="absolute right-2 top-2 inline-flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-bold text-amber-300"><Star size={11} aria-hidden />{item.rating.toFixed(1)}</span> : null}
          {progressPct !== undefined && progressPct > 0 && <span className="absolute inset-x-0 bottom-0 h-1.5 bg-black/60"><span className="block h-full bg-sky-400" style={{ width: `${Math.min(100, progressPct)}%` }} /></span>}
        </span>
      </Link>
      <div className="flex min-w-0 items-start gap-1.5 p-2.5">
        <div className="min-w-0 flex-1">
          <Link to={`/player/${encodeURIComponent(item.id)}`} className="break-anywhere line-clamp-2 min-h-[2.1em] text-[13px] font-semibold leading-snug text-silver hover:text-cyanx" title={item.title}>{displayTitle}</Link>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">{[item.year, item.durationLabel, item.genre].filter(Boolean).join(' · ') || cleanGroup(item.group)}</p>
        </div>
        <button type="button" onClick={() => void toggleFavourite(item.id)} aria-label={fav ? `Remove ${item.title} from favourites` : `Add ${item.title} to favourites`} aria-pressed={fav} className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Heart size={17} className={fav ? 'fill-red-400 text-red-400' : 'text-muted'} /></button>
      </div>
    </article>
  );
});

export const ChannelCard = memo(function ChannelCard({ item, nowTitle }: { item: MediaItem; nowTitle?: string }) {
  const { toggleFavourite, isFavourite } = useStore();
  const fav = isFavourite(item.id);
  return (
    <article className="group relative w-[150px] shrink-0 snap-start overflow-hidden rounded-2xl border border-border bg-card shadow-card focus-within:ring-2 focus-within:ring-cyanx sm:w-[170px]">
      <Link to={`/player/${encodeURIComponent(item.id)}`} className="block focus:outline-none" aria-label={`Watch ${item.title}`}>
        <span className="relative grid aspect-video place-items-center bg-panel p-3">
          <SafeImage src={item.logo} title={item.title} contain className="max-h-full max-w-full" />
          <span className="absolute left-2 top-2 rounded bg-red-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white">LIVE</span>
          <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"><Play className="text-white" size={30} aria-hidden /></span>
        </span>
        <span className="block min-w-0 px-2.5 pb-1 pt-2"><span className="break-anywhere line-clamp-2 min-h-[2.2em] text-[13px] font-semibold leading-snug text-silver" title={item.title}>{cleanTitle(item.title)}</span>
        <span className="line-clamp-1 text-[11px] text-muted">{nowTitle ? `Now: ${cleanTitle(nowTitle)}` : cleanGroup(item.group)}</span></span>
      </Link>
      <button type="button" onClick={() => void toggleFavourite(item.id)} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={fav} className="absolute bottom-1 right-1 grid h-9 w-9 place-items-center rounded-full bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Heart size={16} className={fav ? 'fill-red-400 text-red-400' : 'text-white/80'} /></button>
    </article>
  );
});

export const ChannelRow = memo(function ChannelRow({ item, nowTitle, nextTitle }: { item: MediaItem; nowTitle?: string; nextTitle?: string }) {
  const { toggleFavourite, isFavourite } = useStore();
  const fav = isFavourite(item.id);
  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-xl border border-border bg-card px-2.5 py-2 hover:border-sky-500/50 sm:gap-3 sm:px-3">
      <span className="grid h-11 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-panel p-1"><SafeImage src={item.logo} title={item.title} contain className="max-h-full max-w-full" /></span>
      <Link to={`/player/${encodeURIComponent(item.id)}`} className="min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">
        <span className="flex min-w-0 items-center gap-2"><span className="break-anywhere line-clamp-1 min-w-0 flex-1 text-sm font-semibold leading-snug text-silver" title={item.title}>{cleanTitle(item.title)}</span><span className="shrink-0 rounded bg-red-600 px-1 py-px text-[9px] font-extrabold text-white">LIVE</span></span>
        <span className="block truncate text-xs text-muted">{nowTitle ? `Now: ${cleanTitle(nowTitle)}${nextTitle ? ` · Next: ${cleanTitle(nextTitle)}` : ''}` : cleanGroup(item.group)}</span>
      </Link>
      <button type="button" onClick={() => void toggleFavourite(item.id)} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={fav} className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Heart size={18} className={fav ? 'fill-red-400 text-red-400' : 'text-muted'} /></button>
      <Link to={`/player/${encodeURIComponent(item.id)}`} aria-label={`Play ${item.title}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-500 text-white shadow-glow hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Play size={17} aria-hidden /></Link>
      <Tv className="hidden" aria-hidden />
    </div>
  );
});
