import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, EmptyState, Select, Skeleton, useDebounced } from '@/components/ui/ui';
import { MediaCard } from '@/components/media/MediaCard';
import { PinModal } from '@/components/ui/PinModal';
import { isMediaLocked } from '@/lib/parental';

type Sort = 'title' | 'year' | 'rating';
export function MoviesPage() {
  const { ready, items, playlists, progress, settings, parentalUnlocked } = useStore();
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [group, setGroup] = useState('All');
  const [sort, setSort] = useState<Sort>('title');
  const [pinOpen, setPinOpen] = useState(false);

  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const allMovies = useMemo(() => items.filter((i) => i.kind === 'movie' && enabled.has(i.playlistId)), [items, enabled]);
  const lockedCount = useMemo(() => allMovies.filter((i) => isMediaLocked(i, settings, parentalUnlocked)).length, [allMovies, settings, parentalUnlocked]);
  const movies = useMemo(() => allMovies.filter((i) => !isMediaLocked(i, settings, parentalUnlocked)), [allMovies, settings, parentalUnlocked]);
  const groups = useMemo(() => ['All', ...Array.from(new Set(movies.map((i) => i.group))).sort()], [movies]);
  const filtered = useMemo(() => movies
    .filter((i) => (group === 'All' || i.group === group) && i.title.toLowerCase().includes(dq.toLowerCase()))
    .sort((a, b) => sort === 'year' ? (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title) : sort === 'rating' ? (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title) : a.title.localeCompare(b.title))
    .slice(0, 240), [movies, group, dq, sort]);

  if (!ready) return <Skeleton className="h-64" />;
  if (playlists.length === 0) return <EmptyState title="No movies yet" body="Import a playlist containing movie/VOD entries, or connect Xtream — movies arrive with posters, year and rating from the provider API. Nothing here is invented." action={<Link to="/playlists"><Button>Add Playlist</Button></Link>} />;

  return (
    <div className="w-full min-w-0 max-w-full">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold sm:text-2xl">Movies</h1>
        {lockedCount > 0 && (
          <button type="button" onClick={() => setPinOpen(true)} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-950/40 px-3 text-xs font-bold text-amber-300">
            <Lock size={13} aria-hidden />{lockedCount} Locked
          </button>
        )}
        <span className="text-sm text-muted" role="status">{filtered.length.toLocaleString()} shown</span>
      </div>
      <label className="sr-only" htmlFor="movie-q">Search movies</label>
      <input id="movie-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search movies…" className="mb-3 min-h-[46px] w-full rounded-xl border border-border bg-panel px-3.5 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30" />
      <div className="chips-row -mx-3 mb-4 flex flex-nowrap gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0" role="group" aria-label="Movie categories">
        {groups.map((g) => <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g} className={`min-h-[38px] shrink-0 rounded-full px-3.5 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${group === g ? 'bg-sky-500 text-white shadow-glow' : 'border border-border bg-card text-silver/85'}`}>{g}</button>)}
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort movies" className="min-h-[38px] shrink-0 rounded-full text-[13px]"><option value="title">A–Z</option><option value="year">Newest year</option><option value="rating">Top rated</option></Select>
      </div>
      {movies.length === 0 ? <EmptyState title="No movie entries in your sources" body="Your playlist has no VOD/movie entries (or they are PIN locked)." /> :
       filtered.length === 0 ? <EmptyState title="No movies match" body="Try a different search or category." /> :
       <div className="grid w-full min-w-0 grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">{filtered.map((i) => { const p = progress.find((x) => x.itemId === i.id); return <MediaCard key={i.id} item={i} progressPct={p && p.duration ? (p.position / p.duration) * 100 : undefined} />; })}</div>}
      <PinModal open={pinOpen} onClose={() => setPinOpen(false)} />
    </div>
  );
}
