import { Link } from 'react-router-dom';
import { Film, History, ListVideo, Play, Tv } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/ui';
import { ChannelRow, MediaCard } from '@/components/media/MediaCard';

export function HomePage() {
  const { ready, items, playlists, favourites, progress, importDemo, toast } = useStore();
  const enabled = new Set(playlists.filter((p) => p.enabled).map((p) => p.id));
  const visible = items.filter((i) => enabled.has(i.playlistId));
  const live = visible.filter((i) => i.kind === 'live');
  const movies = visible.filter((i) => i.kind === 'movie');
  const continueWatching = progress.filter((p) => !p.completed && p.position > 5).map((p) => ({ p, item: visible.find((i) => i.id === p.itemId) })).filter((x) => x.item).sort((a, b) => b.p.updatedAt - a.p.updatedAt).slice(0, 8);
  const recent = [...progress].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => visible.find((i) => i.id === p.itemId)).filter(Boolean).slice(0, 6);
  const favChannels = favourites.map((f) => visible.find((i) => i.id === f.itemId)).filter(Boolean).filter((i) => i!.kind === 'live').slice(0, 5);
  if (!ready) return <div className="grid gap-3" aria-busy="true"><Skeleton className="h-44" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  if (playlists.length === 0) {
    return <div className="grid gap-5">
      <section className="overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-sky-950 via-panel to-ink p-6 sm:p-10" aria-label="Welcome">
        <p className="text-xs font-bold tracking-[0.3em] text-cyanx">PREMIUM IPTV & UNIVERSAL PLAYER</p>
        <h1 className="mt-3 max-w-2xl text-3xl font-extrabold leading-tight sm:text-4xl">Your entertainment lounge, built around <span className="text-sky-400">your own sources</span>.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">Connect an M3U playlist file, a playlist URL, or an Xtream-compatible account you are authorized to use. SIRAVEX never bundles channels, movies or credentials — nothing is fabricated, schedules only appear when you import real EPG data.</p>
        <div className="mt-6 flex flex-wrap gap-2"><Link to="/playlists"><Button><ListVideo size={18} aria-hidden />Add Playlist</Button></Link><Button variant="outline" onClick={async () => { try { await importDemo(); toast({ tone: 'success', title: 'Demo samples added', body: 'Clearly labelled legal sample streams (HLS, DASH, MP4).' }); } catch (e) { toast({ tone: 'error', title: 'Demo failed', body: e instanceof Error ? e.message : 'Unknown error' }); } }}>Try labelled demo samples</Button></div>
      </section>
      <EmptyState title="Connect a source to begin" body="No playlist is configured yet, so there is no hero, no fake Live row and no invented schedule. Import your own authorized playlist to fill this dashboard with real content." action={<Link to="/playlists"><Button>Add your first playlist</Button></Link>} />
    </div>;
  }
  const hero = continueWatching[0]?.item ?? movies[0] ?? live[0];
  return (
    <div className="grid gap-8">
      {hero && <section className="relative overflow-hidden rounded-3xl border border-border bg-panel" aria-label="Featured">
        {hero.poster || hero.logo ? <img src={hero.poster || hero.logo} alt="" className="absolute inset-0 h-full w-full object-cover opacity-35" /> : null}
        <div className="relative bg-gradient-to-r from-ink via-ink/85 to-transparent p-6 sm:p-10">
          <p className="text-xs font-bold tracking-[0.3em] text-cyanx">{continueWatching[0] ? 'CONTINUE WATCHING' : hero.kind.toUpperCase()}</p>
          <h1 className="mt-3 max-w-xl text-3xl font-extrabold leading-tight sm:text-4xl">{hero.title}</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">{hero.description || `From ${hero.group}. Playback uses only the format your source actually provides.`}</p>
          <Link to={`/player/${encodeURIComponent(hero.id)}`} className="mt-5 inline-flex"><Button><Play size={18} aria-hidden />{continueWatching[0] ? 'Resume' : 'Watch Now'}</Button></Link>
        </div>
      </section>}
      <section aria-label="Shortcuts"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[['/live', Tv, 'Live TV', `${live.length} channels`], ['/movies', Film, 'Movies', `${movies.length} titles`], ['/series', Play, 'Series', `${visible.filter((i) => i.kind === 'series').length} episodes`], ['/playlists', ListVideo, 'Playlists', `${playlists.length} sources`]].map(([to, Icon, label, sub]) => { const I = Icon as typeof Tv; return <Link key={label as string} to={to as string} className="rounded-2xl border border-border bg-card p-4 hover:border-sky-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><I className="mb-3 text-sky-400" aria-hidden /><p className="font-bold">{label as string}</p><p className="text-xs text-muted">{sub as string}</p></Link>; })}
      </div></section>
      {continueWatching.length > 0 && <section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Continue Watching</h2><Link to="/history" className="text-sm text-cyanx hover:underline">View All →</Link></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{continueWatching.map(({ p, item }) => <MediaCard key={item!.id} item={item!} progressPct={p.duration ? (p.position / p.duration) * 100 : 0} />)}</div></section>}
      {favChannels.length > 0 && <section><h2 className="mb-3 text-lg font-bold">Favourite Channels</h2><div className="grid gap-2">{favChannels.map((i) => <ChannelRow key={i!.id} item={i!} />)}</div></section>}
      {live.length > 0 && <section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Live TV</h2><Link to="/live" className="text-sm text-cyanx hover:underline">View All →</Link></div><div className="grid gap-2">{live.slice(0, 5).map((i) => <ChannelRow key={i.id} item={i} />)}</div></section>}
      {movies.length > 0 && <section><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Movies</h2><Link to="/movies" className="text-sm text-cyanx hover:underline">View All →</Link></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{movies.slice(0, 6).map((i) => <MediaCard key={i.id} item={i} />)}</div></section>}
      {recent.length > 0 && <section><h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><History size={19} aria-hidden /> Recently Watched</h2><div className="grid gap-2">{recent.map((i) => <ChannelRow key={i!.id} item={i!} />)}</div></section>}
      {visible.length === 0 && <EmptyState title="Your sources have no playable items" body="The imported playlist parsed to zero playable entries, or all sources are disabled. Check the import report in Playlists." action={<Link to="/playlists"><Button>Open Playlist Manager</Button></Link>} />}
      <Card><h2 className="font-bold">Sources</h2><p className="mt-1 text-sm text-muted">{playlists.map((p) => `${p.name} (${p.itemCount})`).join(' · ') || 'None'}</p></Card>
    </div>
  );
}
