import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarClock, Play, Trash2 } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, EmptyState, Skeleton, useDebounced } from '@/components/ui/ui';
import { ChannelRow, MediaCard } from '@/components/media/MediaCard';
import { cleanTitle } from '@/lib/display';
import { searchLibrary } from '@/lib/search';
import { nowAndNextForItem } from '@/services/epg/xmltv';

const RECENT_KEY = 'siravex-recent-searches';

const FILTER_LABELS: Record<'all' | 'live' | 'movie' | 'series', string> = {
  all: 'All',
  live: 'Live TV',
  movie: 'Movies',
  series: 'Series',
};

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get('q') ?? '';
  const { ready, items, playlists, programmes, settings } = useStore();
  const [q, setQ] = useState(urlQuery);

  // Sync local input whenever URL ?q= changes (e.g. from AppShell header search bar)
  useEffect(() => {
    setQ(urlQuery);
  }, [urlQuery]);

  const dq = useDebounced(q, 200);
  const [kind, setKind] = useState<'all' | 'live' | 'movie' | 'series'>('all');
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[]; } catch { return []; }
  });

  const enabled = useMemo(
    () => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)),
    [playlists],
  );

  const out = useMemo(
    () => searchLibrary(items, dq, { kind, enabledPlaylistIds: enabled, programmes }),
    [items, enabled, dq, kind, programmes],
  );

  if (!ready) return <Skeleton className="h-64" />;

  const remember = (term = q) => {
    const clean = term.trim();
    if (clean) setParams({ q: clean }, { replace: true });
    else setParams({}, { replace: true });
    if (!settings.saveRecentSearches || !clean) return;
    const next = [clean, ...recent.filter((r) => r.toLowerCase() !== clean.toLowerCase())].slice(0, 8);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const clearRecent = () => {
    setRecent([]);
    try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
  };

  const totalHits = out.total + out.programmes.length;

  return (
    <div>
      <h1 className="mb-4 text-2xl font-extrabold">Search</h1>

      <form
        role="search"
        className="mb-3 flex flex-wrap gap-2"
        onSubmit={(e) => { e.preventDefault(); remember(); }}
      >
        <label className="sr-only" htmlFor="search-q">Search your library</label>
        <input
          id="search-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search channels, movies, series, episodes, EPG shows…"
          className="min-h-[48px] min-w-[220px] flex-1 rounded-xl border border-border bg-panel px-4 text-sm focus:border-sky-400 focus:outline-none"
          autoFocus
        />
        {q && (
          <Button
            variant="outline"
            type="button"
            onClick={() => { setQ(''); setParams({}, { replace: true }); }}
          >
            Clear
          </Button>
        )}
        <Button type="submit">Search</Button>
      </form>

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter results">
        {(['all', 'live', 'movie', 'series'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`min-h-[42px] rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${kind === k ? 'bg-sky-500 text-white shadow-glow' : 'border border-border bg-card text-silver'}`}
          >
            {FILTER_LABELS[k]}
          </button>
        ))}
      </div>

      {recent.length > 0 && !dq && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span>Recent:</span>
          {recent.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => { setQ(r); remember(r); }}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-cyanx hover:border-sky-400/50"
            >
              {r}
            </button>
          ))}
          <button
            type="button"
            onClick={clearRecent}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-silver"
          >
            <Trash2 size={12} aria-hidden />Clear
          </button>
        </div>
      )}

      {playlists.length === 0 ? (
        <EmptyState
          title="Nothing to search yet"
          body="Search works across your locally imported playlists only. Add a source first — SIRAVEX does not query external providers on every keystroke."
          action={<Link to="/playlists"><Button>Add Playlist</Button></Link>}
        />
      ) : !dq ? (
        <EmptyState
          title="Search your library"
          body="Type multi-word queries like channel names, categories, release years, series titles, or EPG shows. Results are ranked locally in milliseconds."
        />
      ) : totalHits === 0 ? (
        <EmptyState
          title={`No results for “${dq}”`}
          body="Try fewer words, check spelling, or switch the category filter back to All."
        />
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-muted" role="status">
            {out.total.toLocaleString()} library match{out.total === 1 ? '' : 'es'}
            {out.programmes.length > 0 ? ` · ${out.programmes.length} EPG guide show${out.programmes.length === 1 ? '' : 's'}` : ''}
          </p>

          {out.live.length > 0 && (
            <section aria-label="Live TV results">
              <h2 className="mb-2.5 text-base font-extrabold">Live TV Channels ({out.live.length})</h2>
              <div className="grid gap-2">
                {out.live.slice(0, 40).map((ch) => {
                  const nn = programmes.length > 0 ? nowAndNextForItem(programmes, ch) : {};
                  return (
                    <ChannelRow
                      key={ch.id}
                      item={ch}
                      nowTitle={nn.current?.title}
                      nextTitle={nn.next?.title}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {out.programmes.length > 0 && (
            <section aria-label="EPG guide results">
              <h2 className="mb-2.5 flex items-center gap-2 text-base font-extrabold">
                <CalendarClock size={18} className="text-cyanx" aria-hidden />
                TV Guide Programmes ({out.programmes.length})
              </h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {out.programmes.map(({ programme: pr, channel, isLiveNow }) => (
                  <div
                    key={pr.id}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${isLiveNow ? 'border-sky-500/45 bg-sky-950/35' : 'border-border bg-card'}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {isLiveNow && (
                          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">ON NOW</span>
                        )}
                        <span className="truncate text-xs text-muted">
                          {channel ? cleanTitle(channel.title) : pr.channelId} ·{' '}
                          {new Date(pr.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm font-bold text-silver">{cleanTitle(pr.title)}</p>
                    </div>
                    {channel && (
                      <Link
                        to={`/player/${encodeURIComponent(channel.id)}`}
                        aria-label={`Watch ${channel.title}`}
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-500 text-white shadow-glow hover:bg-sky-400"
                      >
                        <Play size={16} aria-hidden />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {out.movies.length > 0 && (
            <section aria-label="Movie results">
              <h2 className="mb-2.5 text-base font-extrabold">Movies ({out.movies.length})</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {out.movies.map((m) => <MediaCard key={m.id} item={m} />)}
              </div>
            </section>
          )}

          {out.series.length > 0 && (
            <section aria-label="Series results">
              <h2 className="mb-2.5 text-base font-extrabold">Series &amp; Episodes ({out.series.length})</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {out.series.map((s) => <MediaCard key={s.id} item={s} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
