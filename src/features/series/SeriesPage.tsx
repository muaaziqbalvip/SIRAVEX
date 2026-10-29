import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Play } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, EmptyState, Skeleton, useDebounced } from '@/components/ui/ui';
import { SafeImage } from '@/components/media/MediaCard';

export function SeriesPage() {
  const { ready, items, playlists, progress, loadSeriesEpisodes, toast } = useStore();
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [open, setOpen] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [passFor, setPassFor] = useState<Record<string, string>>({});
  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const visibleSeries = useMemo(() => items.filter((i) => i.kind === 'series' && enabled.has(i.playlistId)), [items, enabled]);
  const grouped = useMemo(() => {
    const map = new Map<string, { title: string; poster?: string; group: string; description?: string; eps: typeof visibleSeries; placeholder?: (typeof visibleSeries)[number] }>();
    for (const ep of visibleSeries) {
      const key = ep.seriesTitle || ep.title;
      const entry = map.get(key) ?? { title: key, poster: ep.poster ?? ep.logo, group: ep.group, description: ep.description, eps: [] };
      if (ep.url) entry.eps.push(ep); else entry.placeholder = ep;
      map.set(key, entry);
    }
    return [...map.values()]
      .map((g) => ({ ...g, eps: g.eps.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)) }))
      .filter((g) => g.title.toLowerCase().includes(dq.toLowerCase()))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [visibleSeries, dq]);
  if (!ready) return <Skeleton className="h-64" />;
  if (playlists.length === 0) return <EmptyState title="No series yet" body="Import a playlist with series episodes, or connect Xtream — series arrive grouped by show and season automatically." action={<Link to="/playlists"><Button>Add Playlist</Button></Link>} />;
  const shown = grouped.slice(0, 60);
  return (
    <div>
      <h1 className="mb-3 text-xl font-extrabold sm:text-2xl">Series</h1>
      <label className="sr-only" htmlFor="series-q">Search series</label>
      <input id="series-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search series…" className="mb-4 min-h-[46px] w-full rounded-xl border border-border bg-panel px-3.5 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30" />
      {grouped.length === 0 ? <EmptyState title="No series found" body="No episodes could be grouped into series from your current sources. Xtream users: reconnect to fetch the series catalogue." /> : (
        <div className="grid gap-3">
          {shown.map((g) => {
            const isOpen = open === g.title;
            const seasons = [...new Set(g.eps.map((e) => e.season).filter((s): s is number => s !== undefined))].sort((a, b) => a - b);
            return (
              <article key={g.title} className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
                <button type="button" onClick={() => setOpen(isOpen ? null : g.title)} aria-expanded={isOpen} className="flex w-full items-center gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyanx">
                  <span className="relative h-[68px] w-[50px] shrink-0 overflow-hidden rounded-lg bg-panel"><SafeImage src={g.poster} title={g.title} className="h-full w-full" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 font-bold">{g.title}</span>
                    <span className="mt-0.5 line-clamp-1 text-xs text-muted">{g.eps.length > 0 ? `${g.eps.length} episode(s)${seasons.length ? ` · Season${seasons.length > 1 ? 's' : ''} ${seasons.join(', ')}` : ''}` : 'Episodes load on demand'} · {g.group}</span>
                    {g.description && <span className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted/80">{g.description}</span>}
                  </span>
                  <ChevronDown size={20} className={`shrink-0 text-muted transition ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                </button>
                {isOpen && (
                  <div className="border-t border-border p-3">
                    {g.eps.length === 0 && g.placeholder ? (
                      <div className="grid gap-2">
                        <p className="text-sm text-muted">Is show ke episodes import ke waqt limit ki wajah se load nahi hue thay. Abhi provider se load karein:</p>
                        {!playlists.find((p) => p.id === g.placeholder!.playlistId)?.password && <label className="block text-xs text-muted">Account password (not saved on this device)<input type="password" value={passFor[g.title] ?? ''} onChange={(e) => setPassFor((s) => ({ ...s, [g.title]: e.target.value }))} className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-ink px-3 text-sm text-silver focus:border-sky-400 focus:outline-none" autoComplete="current-password" /></label>}
                        <Button disabled={loadingId === g.title} onClick={async () => { setLoadingId(g.title); try { const n = await loadSeriesEpisodes(g.placeholder!, passFor[g.title] || undefined); toast({ tone: 'success', title: `${n} episodes loaded`, body: g.title }); } catch (e) { toast({ tone: 'error', title: 'Episodes load nahi hue', body: e instanceof Error ? e.message : 'Failed' }); } finally { setLoadingId(null); } }}>{loadingId === g.title ? 'Loading…' : 'Load episodes'}</Button>
                      </div>
                    ) : (
                      <div className="grid gap-1.5">
                        {g.eps.map((ep, idx) => {
                          const p = progress.find((x) => x.itemId === ep.id);
                          const next = g.eps[idx + 1];
                          return (
                            <div key={ep.id} className="flex items-center gap-2 rounded-xl border border-border bg-panel px-2.5 py-2">
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-semibold">{ep.season !== undefined ? `S${String(ep.season).padStart(2, '0')} E${String(ep.episode ?? idx + 1).padStart(2, '0')} · ` : ''}{ep.title}</span>
                                {p && p.duration ? <span className="mt-1 block h-1 max-w-[220px] overflow-hidden rounded bg-slate-700"><span className="block h-full bg-sky-400" style={{ width: `${Math.min(100, (p.position / p.duration) * 100)}%` }} /></span> : null}
                              </span>
                              {next && p?.completed && <Link to={`/player/${encodeURIComponent(next.id)}`} className="hidden shrink-0 text-xs font-semibold text-cyanx hover:underline sm:inline">Next →</Link>}
                              <Link to={`/player/${encodeURIComponent(ep.id)}`} aria-label={`Play ${ep.title}`} className="inline-flex min-h-[38px] shrink-0 items-center gap-1 rounded-lg bg-sky-500 px-3 text-[13px] font-bold text-white hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Play size={14} aria-hidden />{p && p.position > 5 && !p.completed ? 'Resume' : 'Play'}</Link>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
          {grouped.length > shown.length && <p className="text-center text-xs text-muted">Showing {shown.length} shows — search se narrow karein.</p>}
        </div>
      )}
    </div>
  );
}
