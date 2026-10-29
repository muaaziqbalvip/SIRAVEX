import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Film, ListVideo, Play, Tv } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/ui';
import { ChannelCard, MediaCard, SafeImage } from '@/components/media/MediaCard';

function RowHeader({ title, to }: { title: string; to: string }) {
  return <div className="mb-2.5 flex items-center justify-between px-0.5"><h2 className="text-base font-extrabold tracking-tight sm:text-lg">{title}</h2><Link to={to} className="inline-flex min-h-[36px] items-center gap-0.5 rounded-full px-2 text-[13px] font-semibold text-cyanx hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">View All<ChevronRight size={15} aria-hidden /></Link></div>;
}

export function HomePage() {
  const { ready, items, playlists, favourites, progress, programmes, importDemo, toast } = useStore();
  const [heroIdx, setHeroIdx] = useState(0);
  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const visible = useMemo(() => items.filter((i) => enabled.has(i.playlistId)), [items, enabled]);
  const live = useMemo(() => visible.filter((i) => i.kind === 'live'), [visible]);
  const movies = useMemo(() => visible.filter((i) => i.kind === 'movie'), [visible]);
  const seriesItems = useMemo(() => visible.filter((i) => i.kind === 'series' && i.url), [visible]);
  const continueWatching = useMemo(() => progress.filter((p) => !p.completed && p.position > 5).map((p) => ({ p, item: visible.find((i) => i.id === p.itemId) })).filter((x) => x.item).sort((a, b) => b.p.updatedAt - a.p.updatedAt).slice(0, 10), [progress, visible]);
  const favItems = useMemo(() => favourites.map((f) => visible.find((i) => i.id === f.itemId)).filter(Boolean).slice(0, 10), [favourites, visible]);
  const nowByChannel = useMemo(() => {
    const map = new Map<string, string>();
    const now = Date.now();
    for (const p of programmes) if (now >= p.start && now < p.end) map.set(p.channelId, p.title);
    return map;
  }, [programmes]);

  const heroes = useMemo(() => {
    const picks: typeof visible = [];
    for (const c of continueWatching) if (c.item && picks.length < 2) picks.push(c.item);
    for (const m of movies) { if (picks.length >= 5) break; if (m.poster && !picks.some((x) => x.id === m.id)) picks.push(m); }
    for (const m of movies) { if (picks.length >= 5) break; if (!picks.some((x) => x.id === m.id)) picks.push(m); }
    if (picks.length === 0 && live[0]) picks.push(live[0]);
    return picks;
  }, [continueWatching, movies, live]);

  useEffect(() => {
    if (heroes.length <= 1) return;
    const t = setInterval(() => setHeroIdx((i) => (i + 1) % heroes.length), 7000);
    return () => clearInterval(t);
  }, [heroes.length]);

  if (!ready) return <div className="grid gap-3" aria-busy="true"><Skeleton className="h-52 sm:h-72" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>;

  if (playlists.length === 0) {
    return (
      <div className="grid gap-5">
        <section className="relative overflow-hidden rounded-3xl border border-border" aria-label="Welcome">
          <img src="/icons/icon-512.png" alt="" aria-hidden className="pointer-events-none absolute -right-10 -top-14 h-64 w-64 rotate-6 rounded-[3rem] opacity-25 blur-[1px] sm:h-80 sm:w-80" />
          <div className="relative bg-gradient-to-br from-sky-950 via-panel to-ink p-6 sm:p-10">
            <img src="/icons/logo-256.png" alt="SIRAVEX logo" width={76} height={76} className="h-[76px] w-[76px] rounded-[20px] shadow-glow" />
            <p className="mt-5 text-[11px] font-extrabold tracking-[0.32em] text-cyanx">PREMIUM IPTV & UNIVERSAL PLAYER</p>
            <h1 className="mt-2.5 max-w-2xl text-3xl font-extrabold leading-[1.12] sm:text-[2.6rem]">Your entertainment lounge, built around <span className="text-sky-400">your own sources</span>.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">Connect an M3U playlist, or an Xtream Codes account — SIRAVEX fetches your live channels, movies, series <strong className="text-silver">and EPG guide</strong> automatically. Nothing is bundled or fabricated.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link to="/playlists"><Button><ListVideo size={18} aria-hidden />Add Playlist / Xtream</Button></Link>
              <Button variant="outline" onClick={async () => { try { await importDemo(); toast({ tone: 'success', title: 'Demo samples added', body: 'Clearly labelled legal sample streams (HLS, DASH, MP4).' }); } catch (e) { toast({ tone: 'error', title: 'Demo failed', body: e instanceof Error ? e.message : 'Unknown error' }); } }}>Try demo samples</Button>
            </div>
          </div>
        </section>
        <EmptyState title="Connect a source to begin" body="No playlist is configured yet — is liye koi fake hero, fake channels ya invented schedule nahi dikhaya jata. Apna authorized source add karein aur ye feed aap ke asal content se bhar jayegi." action={<Link to="/playlists"><Button>Add your first playlist</Button></Link>} />
      </div>
    );
  }

  const hero = heroes[Math.min(heroIdx, heroes.length - 1)];
  const heroProgress = hero ? progress.find((p) => p.itemId === hero.id) : undefined;
  return (
    <div className="grid gap-7">
      {hero && (
        <section className="relative overflow-hidden rounded-3xl border border-border bg-panel" aria-label="Featured" key={hero.id}>
          <div className="absolute inset-0"><SafeImage src={hero.backdrop || hero.poster || hero.logo} title={hero.title} className="h-full w-full opacity-40" /></div>
          <div className="relative flex min-h-[240px] flex-col justify-end bg-gradient-to-t from-ink via-ink/75 to-transparent p-5 sm:min-h-[320px] sm:p-8">
            <p className="text-[11px] font-extrabold tracking-[0.3em] text-cyanx">{heroProgress && !heroProgress.completed ? 'CONTINUE WATCHING' : hero.kind === 'live' ? 'LIVE TV' : hero.kind.toUpperCase()}</p>
            <h1 className="mt-2 max-w-2xl text-2xl font-extrabold leading-tight sm:text-4xl">{hero.title}</h1>
            <p className="mt-1.5 line-clamp-2 max-w-xl text-[13px] leading-5 text-silver/75">{hero.description || `${hero.group}${hero.year ? ` · ${hero.year}` : ''} — playback uses only the format your source actually provides.`}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Link to={`/player/${encodeURIComponent(hero.id)}`}><Button><Play size={18} aria-hidden />{heroProgress && !heroProgress.completed ? 'Resume' : 'Watch Now'}</Button></Link>
              {heroes.length > 1 && <span className="ml-1 flex gap-1.5" role="tablist" aria-label="Featured items">{heroes.map((h, i) => <button key={h.id} role="tab" aria-selected={i === heroIdx} aria-label={`Featured: ${h.title}`} onClick={() => setHeroIdx(i)} className={`h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${i === heroIdx ? 'w-7 bg-sky-400' : 'w-2 bg-white/35 hover:bg-white/60'}`} />)}</span>}
            </div>
          </div>
        </section>
      )}

      <section aria-label="Shortcuts"><div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {([['/live', Tv, 'Live TV', `${live.length.toLocaleString()} channels`], ['/movies', Film, 'Movies', `${movies.length.toLocaleString()} titles`], ['/series', Play, 'Series', `${new Set(seriesItems.map((i) => i.seriesTitle ?? i.title)).size.toLocaleString()} shows`], ['/playlists', ListVideo, 'Playlists', `${playlists.length} source(s)`]] as const).map(([to, Icon, label, sub]) => (
          <Link key={label} to={to} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 transition hover:border-sky-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-400"><Icon size={19} aria-hidden /></span><span className="min-w-0"><span className="block truncate text-sm font-bold">{label}</span><span className="block truncate text-xs text-muted">{sub}</span></span></Link>
        ))}
      </div></section>

      {continueWatching.length > 0 && <section><RowHeader title="Continue Watching" to="/history" /><div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">{continueWatching.map(({ p, item }) => <MediaCard key={item!.id} item={item!} progressPct={p.duration ? (p.position / p.duration) * 100 : 0} />)}</div></section>}

      {live.length > 0 && <section><RowHeader title="Live TV" to="/live" /><div className="scroll-row -mx-3 flex snap-x gap-2.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">{live.slice(0, 20).map((i) => <ChannelCard key={i.id} item={i} nowTitle={i.tvgId ? nowByChannel.get(i.tvgId) : undefined} />)}</div></section>}

      {movies.length > 0 && <section><RowHeader title="Movies" to="/movies" /><div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">{movies.slice(0, 12).map((i) => <MediaCard key={i.id} item={i} />)}</div></section>}

      {seriesItems.length > 0 && <section><RowHeader title="Series" to="/series" /><div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">{[...new Map(seriesItems.map((i) => [i.seriesTitle ?? i.title, i])).values()].slice(0, 12).map((i) => <MediaCard key={i.id} item={{ ...i, title: i.seriesTitle ?? i.title }} />)}</div></section>}

      {favItems.length > 0 && <section><RowHeader title="My Favourites" to="/favourites" /><div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">{favItems.map((i) => <MediaCard key={i!.id} item={i!} />)}</div></section>}

      {visible.length === 0 && <EmptyState title="Your sources have no playable items" body="The imported playlist parsed to zero playable entries, or all sources are disabled. Xtream users: reconnect so live/movies/series lists refresh." action={<Link to="/playlists"><Button>Open Playlist Manager</Button></Link>} />}

      <Card className="flex flex-wrap items-center gap-3"><img src="/icons/logo-256.png" alt="" width={42} height={42} className="h-[42px] w-[42px] rounded-xl" loading="lazy" /><div className="min-w-0 flex-1"><p className="text-sm font-bold">Sources</p><p className="truncate text-xs text-muted">{playlists.map((p) => `${p.name} (${p.itemCount.toLocaleString()})`).join(' · ') || 'None'}</p></div><Link to="/playlists"><Button variant="outline">Manage</Button></Link></Card>
    </div>
  );
}
