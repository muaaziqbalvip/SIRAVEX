import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '@/app/store';
import { Button, EmptyState, Select, Skeleton, useDebounced } from '@/components/ui/ui';
import { MediaCard } from '@/components/media/MediaCard';

export function MoviesPage() {
  const { ready, items, playlists, progress } = useStore();
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [group, setGroup] = useState('All');
  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const movies = useMemo(() => items.filter((i) => i.kind === 'movie' && enabled.has(i.playlistId)), [items, enabled]);
  const groups = useMemo(() => ['All', ...Array.from(new Set(movies.map((i) => i.group))).sort()], [movies]);
  const filtered = movies.filter((i) => (group === 'All' || i.group === group) && i.title.toLowerCase().includes(dq.toLowerCase())).sort((a, b) => a.title.localeCompare(b.title));
  if (!ready) return <Skeleton className="h-64" />;
  if (playlists.length === 0) return <EmptyState title="No movies yet" body="Import a playlist containing movie/VOD entries. Cards show only metadata that actually exists in your source — no invented posters, years or ratings." action={<Link to="/playlists"><Button>Add Playlist</Button></Link>} />;
  return (
    <div><h1 className="mb-4 text-2xl font-extrabold">Movies</h1>
      <div className="mb-4 flex flex-wrap gap-2"><label className="sr-only" htmlFor="movie-q">Search movies</label><input id="movie-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search movies…" className="min-h-[44px] min-w-[200px] flex-1 rounded-xl border border-border bg-panel px-3 text-sm focus:border-sky-400 focus:outline-none" /><Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filter by group">{groups.map((g) => <option key={g}>{g}</option>)}</Select></div>
      {filtered.length === 0 ? <EmptyState title="No movies found" body="No movie entries match. Movie classification uses your playlist group names and /movie/ URL patterns where present." /> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{filtered.map((i) => { const p = progress.find((x) => x.itemId === i.id); return <MediaCard key={i.id} item={i} progressPct={p && p.duration ? (p.position / p.duration) * 100 : undefined} />; })}</div>}
    </div>
  );
}
