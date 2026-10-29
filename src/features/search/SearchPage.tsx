import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useStore } from '@/app/store';
import { Button, EmptyState, Skeleton, useDebounced } from '@/components/ui/ui';
import { ChannelRow, MediaCard } from '@/components/media/MediaCard';

const RECENT_KEY = 'siravex-recent-searches';
export function SearchPage() {
  const [params] = useSearchParams();
  const { ready, items, playlists, settings } = useStore();
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(q, 250);
  const [kind, setKind] = useState<'all' | 'live' | 'movie' | 'series'>('all');
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[]; } catch { return []; } });
  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const results = useMemo(() => {
    if (!dq.trim()) return [];
    const needle = dq.toLowerCase();
    return items.filter((i) => enabled.has(i.playlistId) && (kind === 'all' || i.kind === kind) && (i.title.toLowerCase().includes(needle) || i.group.toLowerCase().includes(needle) || (i.seriesTitle ?? '').toLowerCase().includes(needle))).slice(0, 120);
  }, [items, enabled, dq, kind]);
  if (!ready) return <Skeleton className="h-64" />;
  const remember = () => { if (!settings.saveRecentSearches || !q.trim()) return; const next = [q.trim(), ...recent.filter((r) => r !== q.trim())].slice(0, 6); setRecent(next); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ } };
  return (
    <div><h1 className="mb-4 text-2xl font-extrabold">Search</h1>
      <form role="search" className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); remember(); }}>
        <label className="sr-only" htmlFor="search-q">Search your library</label>
        <input id="search-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels, movies, series, episodes…" className="min-h-[48px] min-w-[220px] flex-1 rounded-xl border border-border bg-panel px-4 text-sm focus:border-sky-400 focus:outline-none" autoFocus />
        {q && <Button variant="outline" type="button" onClick={() => setQ('')}>Clear</Button>}
        <Button type="submit">Search</Button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter results">{(['all', 'live', 'movie', 'series'] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`min-h-[44px] rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${kind === k ? 'bg-sky-500 text-white' : 'border border-border bg-card'}`}>{k === 'all' ? 'All' : k}</button>)}</div>
      {recent.length > 0 && !dq && <p className="mb-4 text-sm text-muted">Recent: {recent.map((r) => <button key={r} type="button" onClick={() => setQ(r)} className="mx-1 text-cyanx hover:underline">{r}</button>)}</p>}
      {playlists.length === 0 ? <EmptyState title="Nothing to search yet" body="Search works across your locally imported playlists only. Add a source first — SIRAVEX does not query external providers on every keystroke." action={<Link to="/playlists"><Button>Add Playlist</Button></Link>} />
        : !dq ? <EmptyState title="Search your library" body="Type to search imported channels, movies, series and episodes. Results are debounced and capped for large playlists." />
        : results.length === 0 ? <EmptyState title={`No results for “${dq}”`} body="Try a shorter title, check spelling, or clear the type filter." />
        : <><p className="mb-3 text-sm text-muted" role="status">{results.length} result(s)</p><div className="grid gap-2">{results.slice(0, 20).map((i) => i.kind === 'live' ? <ChannelRow key={i.id} item={i} /> : null)}</div><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{results.filter((i) => i.kind !== 'live').map((i) => <MediaCard key={i.id} item={i} />)}</div></>}
    </div>
  );
}
