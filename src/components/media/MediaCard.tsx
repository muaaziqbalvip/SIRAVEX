import { Link } from 'react-router-dom';
import { Heart, Play, Tv } from 'lucide-react';
import type { MediaItem } from '@/types/models';
import { useStore } from '@/app/store';

export function MediaCard({ item, progressPct }: { item: MediaItem; progressPct?: number }) {
  const { toggleFavourite, isFavourite } = useStore();
  const fav = isFavourite(item.id);
  const img = item.poster || item.logo;
  return (
    <article className="group overflow-hidden rounded-2xl border border-border bg-card shadow-card focus-within:ring-2 focus-within:ring-cyanx">
      <Link to={`/player/${encodeURIComponent(item.id)}`} className="block focus:outline-none" aria-label={`Play ${item.title}`}>
        <div className="relative aspect-[2/3] bg-panel">
          {img ? <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <div className="grid h-full place-items-center p-3 text-center"><span><Tv className="mx-auto mb-2 text-sky-400" aria-hidden /><span className="line-clamp-3 text-sm font-semibold text-silver">{item.title}</span></span></div>}
          <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/45 group-hover:opacity-100"><Play className="text-white" size={36} aria-hidden /></span>
          {progressPct !== undefined && progressPct > 0 && <span className="absolute inset-x-0 bottom-0 h-1.5 bg-black/60"><span className="block h-full bg-sky-400" style={{ width: `${Math.min(100, progressPct)}%` }} /></span>}
        </div>
      </Link>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1"><Link to={`/player/${encodeURIComponent(item.id)}`} className="line-clamp-1 text-sm font-semibold text-silver hover:text-cyanx">{item.title}</Link><p className="mt-0.5 line-clamp-1 text-xs text-muted">{[item.year, item.genre, item.group].filter(Boolean).join(' · ') || item.kind}</p></div>
        <button type="button" onClick={() => void toggleFavourite(item.id)} aria-label={fav ? `Remove ${item.title} from favourites` : `Add ${item.title} to favourites`} aria-pressed={fav} className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Heart size={18} className={fav ? 'fill-red-400 text-red-400' : 'text-muted'} /></button>
      </div>
    </article>
  );
}
export function ChannelRow({ item }: { item: MediaItem }) {
  const { toggleFavourite, isFavourite } = useStore();
  const fav = isFavourite(item.id);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 hover:border-sky-500/50">
      {item.logo ? <img src={item.logo} alt="" loading="lazy" className="h-10 w-14 shrink-0 rounded-md bg-white/5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <span className="grid h-10 w-14 shrink-0 place-items-center rounded-md bg-panel text-sky-400"><Tv size={18} aria-hidden /></span>}
      <Link to={`/player/${encodeURIComponent(item.id)}`} className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx rounded"><span className="block truncate text-sm font-semibold text-silver">{item.title}</span><span className="block truncate text-xs text-muted">{item.group}</span></Link>
      <button type="button" onClick={() => void toggleFavourite(item.id)} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={fav} className="grid h-11 w-11 place-items-center rounded-full hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Heart size={18} className={fav ? 'fill-red-400 text-red-400' : 'text-muted'} /></button>
      <Link to={`/player/${encodeURIComponent(item.id)}`} className="inline-flex min-h-[44px] items-center gap-1 rounded-lg bg-sky-500 px-3 text-sm font-semibold text-white hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Play size={16} aria-hidden />Play</Link>
    </div>
  );
}
