import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Cloud, Film, Grid2x2, ListVideo, Play, Tv } from 'lucide-react';
import { useStore } from '@/app/store';
import { useAuth } from '@/services/firebase/AuthContext';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/ui';
import { ChannelCard, MediaCard, SafeImage } from '@/components/media/MediaCard';
import { MzAdSlot } from '@/components/ads/MzAdSlot';
import { cleanGroup, cleanTitle } from '@/lib/display';
import { isMediaLocked } from '@/lib/parental';

function RowHeader({ title, count, to }: { title: string; count?: number; to: string }) {
  return (
    <div className="mb-2.5 flex min-w-0 items-center justify-between gap-2">
      <h2 className="min-w-0 truncate text-base font-extrabold tracking-tight text-silver sm:text-lg">
        {title}
        {typeof count === 'number' && count > 0 ? (
          <span className="ml-1.5 text-xs font-semibold text-muted">({count.toLocaleString()})</span>
        ) : null}
      </h2>
      <Link
        to={to}
        className="inline-flex min-h-[34px] shrink-0 items-center gap-0.5 rounded-full bg-card px-2.5 text-xs font-semibold text-cyanx hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx sm:text-[13px]"
      >
        View All<ChevronRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

export function HomePage() {
  const { ready, items, playlists, favourites, progress, programmes, settings, parentalUnlocked, importDemo, toast } = useStore();
  const { user } = useAuth();
  const [heroIdx, setHeroIdx] = useState(0);

  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const visible = useMemo(
    () => items.filter((i) => enabled.has(i.playlistId) && !isMediaLocked(i, settings, parentalUnlocked)),
    [items, enabled, settings, parentalUnlocked],
  );
  const live = useMemo(() => visible.filter((i) => i.kind === 'live'), [visible]);
  const movies = useMemo(() => visible.filter((i) => i.kind === 'movie'), [visible]);
  const seriesItems = useMemo(() => visible.filter((i) => i.kind === 'series' && i.url), [visible]);
  const uniqueSeriesCount = useMemo(
    () => new Set(seriesItems.map((i) => i.seriesTitle ?? i.title)).size,
    [seriesItems],
  );

  const recentLive = useMemo(
    () =>
      progress
        .map((p) => ({ p, item: visible.find((i) => i.id === p.itemId && i.kind === 'live') }))
        .filter((x) => x.item)
        .sort((a, b) => b.p.updatedAt - a.p.updatedAt)
        .slice(0, 12),
    [progress, visible],
  );

  const continueWatching = useMemo(
    () =>
      progress
        .filter((p) => !p.completed && p.position > 5 && p.duration > 0)
        .map((p) => ({ p, item: visible.find((i) => i.id === p.itemId && i.kind !== 'live') }))
        .filter((x) => x.item)
        .sort((a, b) => b.p.updatedAt - a.p.updatedAt)
        .slice(0, 10),
    [progress, visible],
  );

  const favItems = useMemo(
    () => favourites.map((f) => visible.find((i) => i.id === f.itemId)).filter(Boolean).slice(0, 12),
    [favourites, visible],
  );

  const nowByChannel = useMemo(() => {
    const map = new Map<string, string>();
    const now = Date.now();
    for (const p of programmes) {
      if (now >= p.start && now < p.end && p.channelId) map.set(p.channelId.trim().toLowerCase(), p.title);
    }
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

  if (!ready) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-4" aria-busy="true">
        <Skeleton className="h-52 sm:h-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (playlists.length === 0) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-5">
        <section className="relative overflow-hidden rounded-3xl border border-border" aria-label="Welcome">
          <img src="/icons/icon-512.png" alt="" aria-hidden className="pointer-events-none absolute -right-10 -top-14 h-56 w-56 rotate-6 rounded-[3rem] opacity-20 blur-[1px] sm:h-80 sm:w-80" />
          <div className="relative bg-gradient-to-br from-sky-950 via-panel to-ink p-5 sm:p-10">
            <img src="/icons/logo-256.png" alt="SIRAVEX logo" width={68} height={68} className="h-16 w-16 rounded-2xl shadow-glow sm:h-[76px] sm:w-[76px]" />
            <p className="mt-4 text-[10px] font-extrabold tracking-[0.28em] text-cyanx sm:text-[11px]">TURBO MOBILE &amp; CLOUD IPTV STUDIO</p>
            <h1 className="mt-2 max-w-2xl text-2xl font-extrabold leading-[1.15] sm:text-[2.6rem]">
              Your entertainment lounge, synced across <span className="text-sky-400">every screen</span>.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
              Connect an Xtream Codes account or M3U playlist — SIRAVEX fetches your Live TV, Movies, Series &amp; EPG automatically, backs up your sources with <strong className="text-silver">AES-256 Firebase Cloud Sync</strong>, and lets you watch up to <strong className="text-silver">4 channels at once in Multi-View</strong>.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/playlists"><Button><ListVideo size={18} aria-hidden />Add Playlist / Xtream</Button></Link>
              {!user && <Link to="/login"><Button variant="outline"><Cloud size={17} aria-hidden />Restore Cloud Vault</Button></Link>}
              <Button variant="outline" onClick={async () => { try { await importDemo(); toast({ tone: 'success', title: 'Demo samples added', body: 'Clearly labelled legal sample streams (HLS, DASH, MP4).' }); } catch (e) { toast({ tone: 'error', title: 'Demo failed', body: e instanceof Error ? e.message : 'Unknown error' }); } }}>Try demo samples</Button>
            </div>
          </div>
        </section>
        <EmptyState title="Connect a source to begin" body="No playlist is configured yet — apna Xtream ya M3U source add karein (ya Cloud Vault mein sign in karein) aur ye feed aap ke asal content se bhar jayegi." action={<Link to="/playlists"><Button>Add your first playlist</Button></Link>} />
      </div>
    );
  }

  const hero = heroes[Math.min(heroIdx, heroes.length - 1)];
  const heroProgress = hero ? progress.find((p) => p.itemId === hero.id) : undefined;

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-5 sm:gap-6">
      <MzAdSlot slot="auto" placement="home" />

      {/* Featured Hero — clean contrast & zero text/button collision on mobile */}
      {hero && (
        <section className="relative w-full min-w-0 overflow-hidden rounded-3xl border border-border bg-panel" aria-label="Featured" key={hero.id}>
          <div className="pointer-events-none absolute inset-0">
            <SafeImage src={hero.backdrop || hero.poster || hero.logo} title={hero.title} className="h-full w-full opacity-35" />
          </div>
          <div className="relative flex min-h-[210px] w-full min-w-0 flex-col justify-end bg-gradient-to-t from-ink via-ink/85 to-ink/25 p-4 sm:min-h-[300px] sm:p-8">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-sky-500/20 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.22em] text-cyanx">
                {heroProgress && !heroProgress.completed && hero.kind !== 'live' ? 'Continue Watching' : hero.kind === 'live' ? 'Live TV' : hero.kind}
              </span>
              {hero.rating ? (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                  ★ {hero.rating.toFixed(1)}
                </span>
              ) : null}
            </div>

            <h1 className="break-anywhere mt-2 line-clamp-2 w-full min-w-0 max-w-2xl text-xl font-extrabold leading-tight text-white sm:text-4xl" title={hero.title}>
              {cleanTitle(hero.title)}
            </h1>

            <p className="break-anywhere mt-1 line-clamp-2 w-full min-w-0 max-w-xl text-xs leading-5 text-silver/80 sm:text-sm">
              {cleanTitle(hero.description || `${cleanGroup(hero.group)}${hero.year ? ` · ${hero.year}` : ''}`)}
            </p>

            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/player/${encodeURIComponent(hero.id)}`}>
                  <Button className="min-h-[40px] px-4 text-xs sm:min-h-[44px] sm:text-sm">
                    <Play size={16} aria-hidden />
                    {heroProgress && !heroProgress.completed && hero.kind !== 'live' ? 'Resume' : 'Watch Now'}
                  </Button>
                </Link>
                <Link to="/multiview">
                  <Button variant="outline" className="min-h-[40px] px-3.5 text-xs sm:min-h-[44px] sm:text-sm">
                    <Grid2x2 size={15} aria-hidden />Multi-View
                  </Button>
                </Link>
              </div>

              {heroes.length > 1 && (
                <span className="flex items-center gap-1.5" role="tablist" aria-label="Featured items">
                  {heroes.map((h, i) => (
                    <button
                      key={h.id}
                      role="tab"
                      aria-selected={i === heroIdx}
                      aria-label={`Featured: ${h.title}`}
                      onClick={() => setHeroIdx(i)}
                      className={`h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${i === heroIdx ? 'w-6 bg-sky-400' : 'w-2 bg-white/35 hover:bg-white/60'}`}
                    />
                  ))}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Quick Category Tiles */}
      <section aria-label="Shortcuts" className="w-full min-w-0">
        <div className="grid w-full min-w-0 grid-cols-2 gap-2.5 lg:grid-cols-4">
          {([
            ['/live', Tv, 'Live TV', `${live.length.toLocaleString()} channels`],
            ['/multiview', Grid2x2, 'Multi-View', '4 Live feeds at once'],
            ['/movies', Film, 'Movies', `${movies.length.toLocaleString()} titles`],
            ['/series', Play, 'Series', `${uniqueSeriesCount.toLocaleString()} shows`],
          ] as const).map(([to, Icon, label, sub]) => (
            <Link
              key={label}
              to={to}
              className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-border bg-card p-3 transition hover:border-sky-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx sm:gap-3 sm:p-3.5"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-400 sm:h-10 sm:w-10">
                <Icon size={18} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-silver sm:text-sm">{label}</span>
                <span className="block truncate text-[11px] text-muted sm:text-xs">{sub}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Recently Watched Live Channels */}
      {recentLive.length > 0 && (
        <section className="w-full min-w-0">
          <RowHeader title="Recent Live Channels" to="/history" />
          <div className="scroll-row pb-1">
            {recentLive.map(({ item }) => (
              <ChannelCard
                key={item!.id}
                item={item!}
                nowTitle={(item!.tvgId ? nowByChannel.get(item!.tvgId.trim().toLowerCase()) : undefined) ?? nowByChannel.get(item!.id.trim().toLowerCase())}
              />
            ))}
          </div>
        </section>
      )}

      {/* Continue Watching */}
      {continueWatching.length > 0 && (
        <section className="w-full min-w-0">
          <RowHeader title="Continue Watching" to="/history" />
          <div className="grid w-full min-w-0 grid-cols-2 gap-3 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {continueWatching.map(({ p, item }) => (
              <MediaCard key={item!.id} item={item!} progressPct={p.duration ? (p.position / p.duration) * 100 : 0} />
            ))}
          </div>
        </section>
      )}

      {/* Live TV Row */}
      {live.length > 0 && (
        <section className="w-full min-w-0">
          <RowHeader title="Live TV" count={live.length} to="/live" />
          <div className="scroll-row pb-1">
            {live.slice(0, 24).map((i) => (
              <ChannelCard
                key={i.id}
                item={i}
                nowTitle={(i.tvgId ? nowByChannel.get(i.tvgId.trim().toLowerCase()) : undefined) ?? nowByChannel.get(i.id.trim().toLowerCase())}
              />
            ))}
          </div>
        </section>
      )}

      {/* Movies Grid */}
      {movies.length > 0 && (
        <section className="w-full min-w-0">
          <RowHeader title="Movies" count={movies.length} to="/movies" />
          <div className="grid w-full min-w-0 grid-cols-2 gap-3 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {movies.slice(0, 12).map((i) => <MediaCard key={i.id} item={i} />)}
          </div>
        </section>
      )}

      {/* Series Grid */}
      {seriesItems.length > 0 && (
        <section className="w-full min-w-0">
          <RowHeader title="Series" count={uniqueSeriesCount} to="/series" />
          <div className="grid w-full min-w-0 grid-cols-2 gap-3 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {[...new Map(seriesItems.map((i) => [i.seriesTitle ?? i.title, i])).values()].slice(0, 12).map((i) => (
              <MediaCard key={i.id} item={{ ...i, title: i.seriesTitle ?? i.title }} />
            ))}
          </div>
        </section>
      )}

      {/* Favourites Grid */}
      {favItems.length > 0 && (
        <section className="w-full min-w-0">
          <RowHeader title="My Favourites" count={favourites.length} to="/favourites" />
          <div className="grid w-full min-w-0 grid-cols-2 gap-3 min-[480px]:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {favItems.map((i) => <MediaCard key={i!.id} item={i!} />)}
          </div>
        </section>
      )}

      {visible.length === 0 && (
        <EmptyState
          title="Your sources have no playable items"
          body="Cloud playlist abhi load ho rahi hai ya source disabled hai. Playlists & Cloud khol kar Load Channels / Refresh dabayein."
          action={<Link to="/playlists"><Button>Open Playlist &amp; Cloud Vault</Button></Link>}
        />
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <img src="/icons/logo-256.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl" loading="lazy" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">Sources {user ? '· Cloud Vault Connected' : '· Local Mode'}</p>
            <p className="truncate text-xs text-muted">{playlists.map((p) => `${p.name} (${p.itemCount.toLocaleString()})`).join(' · ') || 'None'}</p>
          </div>
        </div>
        <Link to="/playlists"><Button variant="outline" className="min-h-[38px] px-3.5 text-xs">Manage</Button></Link>
      </Card>
    </div>
  );
}
