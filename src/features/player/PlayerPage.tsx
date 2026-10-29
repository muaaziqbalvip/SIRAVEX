import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Heart, ListVideo, Play, Star } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/ui';
import { PlayerShell } from '@/playback/components/PlayerShell';
import { SafeImage } from '@/components/media/MediaCard';

export function PlayerPage() {
  const { id } = useParams();
  const { ready, items, playlists, toggleFavourite, isFavourite, progress, settings, loadSeriesEpisodes, toast } = useStore();
  const [epPass, setEpPass] = useState('');
  const [epBusy, setEpBusy] = useState(false);
  const item = items.find((i) => i.id === decodeURIComponent(id ?? ''));
  if (!ready) return <Skeleton className="aspect-video w-full" />;
  if (!item) return <EmptyState title="Item not found" body="This item may have been removed with its playlist. Your library is unchanged otherwise." action={<Link to="/"><Button>Back to Home</Button></Link>} />;
  const saved = progress.find((p) => p.itemId === item.id);
  const fav = isFavourite(item.id);
  const episodes = item.kind === 'series' ? items.filter((i) => i.kind === 'series' && (i.seriesTitle ?? i.title) === (item.seriesTitle ?? item.title)).sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)) : [];
  const idx = episodes.findIndex((e) => e.id === item.id);
  const nextEp = idx >= 0 ? episodes[idx + 1] : undefined;
  const sourcePlaylist = playlists.find((p) => p.id === item.playlistId);
  const isPlaceholder = item.kind === 'series' && !item.url;
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-3 truncate text-sm text-muted"><Link to="/" className="hover:text-cyanx">Home</Link> {' › '} <Link to={item.kind === 'live' ? '/live' : item.kind === 'movie' ? '/movies' : '/series'} className="hover:text-cyanx">{item.kind === 'live' ? 'Live TV' : item.kind === 'movie' ? 'Movies' : 'Series'}</Link> {' › '} <span className="text-silver">{item.title}</span></nav>
      {isPlaceholder ? (
        <Card className="grid gap-4 sm:grid-cols-[150px_1fr]">
          <span className="relative aspect-[2/3] w-[130px] overflow-hidden rounded-xl bg-panel sm:w-[150px]"><SafeImage src={item.poster || item.logo} title={item.title} className="h-full w-full" /></span>
          <div>
            <h1 className="text-xl font-extrabold sm:text-2xl">{item.seriesTitle ?? item.title}</h1>
            <p className="mt-1 text-sm text-muted">{[item.group, item.year, item.genre].filter(Boolean).join(' · ')}</p>
            {item.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{item.description}</p>}
            <p className="mt-3 text-sm leading-6">Is show ke episodes abhi load nahi hue (import fast rakhne ke liye). Provider se abhi load karein — phir har episode yahan Play ho jayega.</p>
            {sourcePlaylist?.type === 'xtream' && !sourcePlaylist.password && <label className="mt-3 block max-w-sm text-xs text-muted">Account password (not saved)<input type="password" value={epPass} onChange={(e) => setEpPass(e.target.value)} autoComplete="current-password" className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-ink px-3 text-sm text-silver focus:border-sky-400 focus:outline-none" /></label>}
            <Button className="mt-3" disabled={epBusy} onClick={async () => { setEpBusy(true); try { const n = await loadSeriesEpisodes(item, epPass || undefined); toast({ tone: 'success', title: `${n} episodes loaded`, body: 'Ab koi episode select kar ke Play karein.' }); } catch (e) { toast({ tone: 'error', title: 'Episodes load nahi hue', body: e instanceof Error ? e.message : 'Failed' }); } finally { setEpBusy(false); } }}><ListVideo size={17} aria-hidden />{epBusy ? 'Loading episodes…' : 'Load episodes'}</Button>
          </div>
        </Card>
      ) : <PlayerShell item={item} />}
      <div className="mt-5 flex flex-wrap items-start gap-3">
        <div className="min-w-[220px] flex-1"><h1 className="text-xl font-extrabold sm:text-2xl">{item.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted"><span>{[item.group, item.year, item.durationLabel, item.genre].filter(Boolean).join(' · ') || item.kind}</span>{item.rating ? <span className="inline-flex items-center gap-1 font-bold text-amber-300"><Star size={13} aria-hidden />{item.rating.toFixed(1)}</span> : null}</p>
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
