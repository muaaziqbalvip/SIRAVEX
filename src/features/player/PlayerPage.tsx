import { Link, useParams } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, EmptyState, Skeleton } from '@/components/ui/ui';
import { PlayerShell } from '@/playback/components/PlayerShell';

export function PlayerPage() {
  const { id } = useParams();
  const { ready, items, toggleFavourite, isFavourite, progress, settings } = useStore();
  const item = items.find((i) => i.id === decodeURIComponent(id ?? ''));
  if (!ready) return <Skeleton className="aspect-video w-full" />;
  if (!item) return <EmptyState title="Item not found" body="This item may have been removed with its playlist. Your library is unchanged otherwise." action={<Link to="/"><Button>Back to Home</Button></Link>} />;
  const saved = progress.find((p) => p.itemId === item.id);
  const fav = isFavourite(item.id);
  const episodes = item.kind === 'series' ? items.filter((i) => i.kind === 'series' && (i.seriesTitle ?? i.title) === (item.seriesTitle ?? item.title)).sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)) : [];
  const idx = episodes.findIndex((e) => e.id === item.id);
  const nextEp = idx >= 0 ? episodes[idx + 1] : undefined;
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-muted"><Link to="/" className="hover:text-cyanx">Home</Link> {' > '} <Link to={item.kind === 'live' ? '/live' : item.kind === 'movie' ? '/movies' : '/series'} className="hover:text-cyanx">{item.kind === 'live' ? 'Live TV' : item.kind}</Link> {' > '} <span className="text-silver">{item.title}</span></nav>
      <PlayerShell item={item} />
      <div className="mt-5 flex flex-wrap items-start gap-3">
        <div className="min-w-[240px] flex-1"><h1 className="text-2xl font-extrabold">{item.title}</h1>
          <p className="mt-1 text-sm text-muted">{[item.group, item.year, item.genre].filter(Boolean).join(' · ') || item.kind}</p>
          {item.description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{item.description}</p> : <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">No description was provided by the source, so none is shown. SIRAVEX displays only metadata that actually exists.</p>}
          {saved && settings.resumePlayback && <p className="mt-2 text-sm text-cyanx">Resume point saved locally at {Math.floor(saved.position)}s. Seekable playback resumes from your saved progress when you press Play and seek.</p>}
        </div>
        <Button variant="outline" onClick={() => void toggleFavourite(item.id)} aria-pressed={fav}><Heart size={18} className={fav ? 'fill-red-400 text-red-400' : ''} aria-hidden />{fav ? 'Favourited' : 'Add to Favourites'}</Button>
      </div>
      {nextEp && <div className="mt-5 rounded-2xl border border-border bg-card p-4"><p className="text-sm"><strong>Next episode:</strong> {nextEp.title}</p><Link to={`/player/${encodeURIComponent(nextEp.id)}`}><Button className="mt-2">Play next episode</Button></Link></div>}
      <div className="mt-5 grid gap-2 text-sm text-muted"><p><strong className="text-silver">Format help:</strong> HLS (.m3u8), DASH (.mpd) and browser-supported MP4/WebM play here. RTSP, RTMP and raw .ts cannot play directly in any browser and need an authorized HLS/DASH gateway from your provider. Protected/DRM content is never circumvented.</p></div>
    </div>
  );
}
