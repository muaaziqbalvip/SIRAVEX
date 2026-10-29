import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, Card, EmptyState, Skeleton, useDebounced } from '@/components/ui/ui';

export function SeriesPage() {
  const { ready, items, playlists, progress } = useStore();
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const episodes = useMemo(() => items.filter((i) => i.kind === 'series' && enabled.has(i.playlistId)), [items, enabled]);
  const grouped = useMemo(() => {
    const map = new Map<string, typeof episodes>();
    for (const ep of episodes) { const key = ep.seriesTitle || ep.title; const arr = map.get(key) ?? []; arr.push(ep); map.set(key, arr); }
    return [...map.entries()].map(([title, eps]) => ({ title, eps: eps.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)) })).filter((g) => g.title.toLowerCase().includes(dq.toLowerCase())).sort((a, b) => a.title.localeCompare(b.title));
  }, [episodes, dq]);
  if (!ready) return <Skeleton className="h-64" />;
  if (playlists.length === 0) return <EmptyState title="No series yet" body="Import a playlist with series episodes (for example S01E02 titles or /series/ URLs). Episodes are grouped only when that metadata exists." action={<Link to="/playlists"><Button>Add Playlist</Button></Link>} />;
  return (
    <div><h1 className="mb-4 text-2xl font-extrabold">Series</h1>
      <label className="sr-only" htmlFor="series-q">Search series</label><input id="series-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search series…" className="mb-4 min-h-[44px] w-full rounded-xl border border-border bg-panel px-3 text-sm focus:border-sky-400 focus:outline-none" />
      {grouped.length === 0 ? <EmptyState title="No series found" body="No episodes could be grouped into series from your current sources." /> : <div className="grid gap-4">{grouped.map((g) => (
        <Card key={g.title}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">{g.title}</h2><span className="text-xs text-muted">{g.eps.length} episode(s){g.eps.some((e) => e.season !== undefined) ? ` · Seasons ${[...new Set(g.eps.map((e) => e.season).filter(Boolean))].join(', ')}` : ''}</span></div>
          <div className="grid gap-2">{g.eps.map((ep, idx) => { const p = progress.find((x) => x.itemId === ep.id); const next = g.eps[idx + 1]; return <div key={ep.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-panel px-3 py-2"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{ep.season !== undefined ? `S${ep.season} E${ep.episode} — ` : ''}{ep.title}</span>{p && p.duration ? <span className="text-xs text-muted">{Math.round((p.position / p.duration) * 100)}% watched</span> : null}</span><Link to={`/player/${encodeURIComponent(ep.id)}`}><Button className="min-h-[40px] px-3"><Play size={15} aria-hidden />{p && p.position > 5 && !p.completed ? 'Resume' : 'Play'}</Button></Link>{next && p?.completed ? <Link to={`/player/${encodeURIComponent(next.id)}`} className="text-xs text-cyanx hover:underline">Next: {next.title}</Link> : null}</div>; })}</div></Card>
      ))}</div>}
    </div>
  );
}
