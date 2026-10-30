import { memo, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Film, Heart, Play, Star, Tv } from 'lucide-react';
import { sanitizeUrl } from '@/lib/security';
import { cleanGroup, cleanTitle } from '@/lib/display';
import { useStore } from '@/app/store';
import type { MediaItem } from '@/types/models';

export function SafeImage({ src, title, className = '', contain }: { src?: string; title: string; className?: string; contain?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const safe = src ? sanitizeUrl(src) : null;
  const initials = cleanTitle(title).replace(/[^a-zA-Z0-9 ]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'TV';
  if (!safe || failed) {
    return (
      <div className={`grid place-items-center bg-gradient-to-br from-slate-800 via-slate-900 to-sky-950 font-bold text-cyan-200 ${className}`} aria-hidden>
        <span className="text-lg tracking-wider">{initials}</span>
      </div>
    );
  }
  return <img src={safe} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${contain ? 'object-contain p-2' : 'object-cover'} ${className}`} />;
}

/**
 * Poster card (Movies / Series / Favourites).
 * Heart button lives cleanly in the top-right corner of the poster so the card footer
 * has 100% width for title, category, and year — zero text/button collisions on mobile!
 */
export const MediaCard = memo(function MediaCard({ item, progressPct }: { item: MediaItem; progressPct?: number }) {
  const { isFavourite, toggleFavourite } = useStore();
  const fav = isFavourite(item.id);
  const label = cleanTitle(item.title);
  const grp = cleanGroup(item.group);

  return (
    <article className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-sky-500/70">
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-panel">
        <Link
          to={`/player/${encodeURIComponent(item.id)}`}
          className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyanx"
          aria-label={`Play ${label}`}
        >
          <SafeImage src={item.poster || item.logo} title={label} className="h-full w-full transition duration-300 group-hover:scale-105" />
          <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/50 opacity-0 transition group-hover:opacity-100">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-sky-500 text-white shadow-glow">
              <Play size={20} className="ml-0.5" aria-hidden />
            </span>
          </span>
        </Link>

        {/* Badges top-left */}
        <div className="pointer-events-none absolute left-1.5 top-1.5 z-10 flex flex-wrap gap-1">
          {item.kind === 'live' && <span className="rounded bg-red-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white">LIVE</span>}
          {item.rating ? (
            <span className="inline-flex items-center gap-0.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur">
              <Star size={10} aria-hidden />{item.rating.toFixed(1)}
            </span>
          ) : null}
        </div>

        {/* Non-colliding Heart button top-right on poster */}
        <button
          type="button"
          onClick={() => void toggleFavourite(item.id)}
          aria-label={fav ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
          aria-pressed={fav}
          className="absolute right-1.5 top-1.5 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white/90 backdrop-blur hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"
        >
          <Heart size={15} className={fav ? 'fill-red-400 text-red-400' : ''} />
        </button>

        {typeof progressPct === 'number' && progressPct > 0 && (
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/60" aria-label={`${Math.round(progressPct)}% watched`}>
            <span className="block h-full bg-sky-400" style={{ width: `${Math.min(100, progressPct)}%` }} />
          </span>
        )}
      </div>

      <Link
        to={`/player/${encodeURIComponent(item.id)}`}
        className="flex min-w-0 flex-1 flex-col justify-between p-2.5 focus-visible:outline-none"
        tabIndex={-1}
      >
        <p className="break-anywhere line-clamp-2 text-[13px] font-semibold leading-[1.3] text-silver sm:text-sm" title={label}>
          {label}
        </p>
        <p className="mt-1 truncate text-[11px] text-muted">{[grp, item.year].filter(Boolean).join(' · ')}</p>
      </Link>
    </article>
  );
});

/**
 * Live TV channel tile:
 * - Default (`gridMode = false`): fixed horizontal carousel width (`w-[148px] sm:w-[172px] shrink-0`).
 * - `gridMode = true`: fluid `w-full min-w-0` so 2/3/4/6 CSS grid columns fill 100% of mobile/desktop width cleanly!
 * - Heart button sits inside the top-right of the logo box so channel titles & EPG NEVER collide!
 */
export const ChannelCard = memo(function ChannelCard({
  item,
  nowTitle,
  gridMode = false,
}: {
  item: MediaItem;
  nowTitle?: string;
  gridMode?: boolean;
}) {
  const { isFavourite, toggleFavourite } = useStore();
  const fav = isFavourite(item.id);
  const label = cleanTitle(item.title);
  const grp = cleanGroup(item.group);

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-sky-500/70 ${
        gridMode ? 'w-full min-w-0' : 'w-[148px] shrink-0 snap-start sm:w-[172px]'
      }`}
    >
      <div className="relative h-20 w-full overflow-hidden bg-slate-900/90 sm:h-24">
        <Link
          to={`/player/${encodeURIComponent(item.id)}`}
          aria-label={`Play ${label}`}
          className="block h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyanx"
        >
          <SafeImage src={item.logo} title={label} contain className="h-full w-full" />
        </Link>
        <span className="pointer-events-none absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-red-600/95 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />LIVE
        </span>
        <button
          type="button"
          onClick={() => void toggleFavourite(item.id)}
          aria-label={fav ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
          aria-pressed={fav}
          className="absolute right-1.5 top-1.5 z-10 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white/90 backdrop-blur hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"
        >
          <Heart size={14} className={fav ? 'fill-red-400 text-red-400' : ''} />
        </button>
      </div>

      <Link
        to={`/player/${encodeURIComponent(item.id)}`}
        tabIndex={-1}
        className="flex min-w-0 flex-1 flex-col justify-between p-2.5"
      >
        <div>
          <p className="break-anywhere line-clamp-2 text-[12.5px] font-bold leading-[1.3] text-silver sm:text-[13px]" title={label}>
            {label}
          </p>
          <p className="mt-1 truncate text-[11px] text-muted" title={nowTitle || grp}>
            {nowTitle ? <span className="text-cyanx">{cleanTitle(nowTitle)}</span> : grp}
          </p>
        </div>
      </Link>
    </article>
  );
});

export const ChannelRow = memo(function ChannelRow({ item, nowTitle, nextTitle }: { item: MediaItem; nowTitle?: string; nextTitle?: string }) {
  const { isFavourite, toggleFavourite } = useStore();
  const fav = isFavourite(item.id);
  const Icon = item.kind === 'live' ? Tv : Film;
  const label = cleanTitle(item.title);
  const grp = cleanGroup(item.group);

  return (
    <div className="flex w-full min-w-0 items-center gap-2.5 rounded-2xl border border-border bg-card p-2.5 transition hover:border-sky-500/60 sm:gap-3">
      <Link to={`/player/${encodeURIComponent(item.id)}`} className="flex min-w-0 flex-1 items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx rounded-xl sm:gap-3">
        <div className="relative h-12 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-900 sm:h-12 sm:w-16">
          <SafeImage src={item.logo || item.poster} title={label} contain={item.kind === 'live'} className="h-full w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-anywhere line-clamp-1 text-sm font-bold text-silver" title={label}>{label}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
            <Icon size={12} className="shrink-0" aria-hidden />
            <span className="truncate">{grp}</span>
          </p>
          {(nowTitle || nextTitle) && (
            <p className="mt-0.5 truncate text-xs text-cyanx">
              {nowTitle ? `Now: ${cleanTitle(nowTitle)}` : ''}{nowTitle && nextTitle ? ' · ' : ''}{nextTitle ? `Next: ${cleanTitle(nextTitle)}` : ''}
            </p>
          )}
        </div>
      </Link>
      <button
        type="button"
        onClick={() => void toggleFavourite(item.id)}
        aria-label={fav ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
        aria-pressed={fav}
        className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted hover:bg-panel hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"
      >
        <Heart size={18} className={fav ? 'fill-red-400 text-red-400' : ''} />
      </button>
    </div>
  );
});
