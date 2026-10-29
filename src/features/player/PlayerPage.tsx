import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarClock, Heart, ListVideo, Play, Star } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/ui';
import { PlayerShell } from '@/playback/components/PlayerShell';
import { MzAdSlot, MzPreroll, usePrerollGate } from '@/components/ads/MzAdSlot';
import { MediaCard, SafeImage } from '@/components/media/MediaCard';
import { cleanTitle } from '@/lib/display';

export function PlayerPage() {
  const { id } = useParams();
  const { ready, items, playlists, programmes, toggleFavourite, isFavourite, progress, settings, loadSeriesEpisodes, loadShortEpg, toast } = useStore();
  const preroll = usePrerollGate();
  const [epPass, setEpPass] = useState('');
  const [epBusy, setEpBusy] = useState(false);
  const [sgPass, setSgPass] = useState('');
  const [sgBusy, setSgBusy] = useState(false);
  const item = items.find((i) => i.id === decodeURIComponent(id ?? ''));
  const todayShows = useMemo(() => {
    if (!item || item.kind !== 'live' || !item.tvgId) return [] as typeof programmes;
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    return programmes.filter((pr) => (pr.channelId === item.tvgId || pr.channelId === item.id) && pr.end > dayStart.getTime() && pr.start < dayStart.getTime() + 86400000).sort((a, b) => a.start - b.start).slice(0, 20);
  }, [programmes, item]);
  if (!ready) return <Skeleton className="aspect-video w-full" />;
  if (!item) return <EmptyState title="Item not found" body="This item may have been removed with its playlist. Your library is unchanged otherwise." action={<Link to="/"><Button>Back to Home</Button></Link>} />;
  const saved = progress.find((p) => p.itemId === item.id);
  const sameGroupLive = item.kind === 'live' ? items.filter((i) => i.kind === 'live' && i.playlistId === item.playlistId && i.group === item.group && i.id !== item.id).slice(0, 24) : [];
  const moreLike = item.kind === 'movie' ? items.filter((i) => i.kind === 'movie' && i.group === item.group && i.id !== item.id).slice(0, 12) : [];
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
      ) : preroll.show ? <MzPreroll onDone={preroll.dismiss} /> : <PlayerShell item={item} />}
      {!isPlaceholder && <MzAdSlot slot="banner" placement="player" className="mt-4" />}
      <div className="mt-5 flex flex-wrap items-start gap-3">
        <div className="min-w-[220px] flex-1"><h1 className="text-xl font-extrabold sm:text-2xl">{item.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted"><span>{[item.group, item.year, item.durationLabel, item.genre].filter(Boolean).join(' · ') || item.kind}</span>{item.rating ? <span className="inline-flex items-center gap-1 font-bold text-amber-300"><Star size={13} aria-hidden />{item.rating.toFixed(1)}</span> : null}</p>
          {item.description ? <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{item.description}</p> : <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">No description was provided by the source, so none is shown. SIRAVEX displays only metadata that actually exists.</p>}
          {saved && settings.resumePlayback && <p className="mt-2 text-sm text-cyanx">Resume point saved locally at {Math.floor(saved.position)}s. Seekable playback resumes from your saved progress when you press Play and seek.</p>}
        </div>
        <Button variant="outline" onClick={() => void toggleFavourite(item.id)} aria-pressed={fav}><Heart size={18} className={fav ? 'fill-red-400 text-red-400' : ''} aria-hidden />{fav ? 'Favourited' : 'Add to Favourites'}</Button>
      </div>
      {nextEp && <div className="mt-5 rounded-2xl border border-border bg-card p-4"><p className="text-sm"><strong>Next episode:</strong> {nextEp.title}</p><Link to={`/player/${encodeURIComponent(nextEp.id)}`}><Button className="mt-2">Play next episode</Button></Link></div>}
{item.kind === 'live' && sourcePlaylist?.type === 'xtream' && item.streamId && todayShows.length === 0 && (
        <section aria-label="Provider guide" className="mt-6 rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-base font-extrabold"><CalendarClock size={18} className="text-cyanx" aria-hidden />Channel Guide (EPG)</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Is channel ke liye loaded guide mein abhi koi programme nahi mila. Provider se is channel ki <strong className="text-silver">short EPG (now/next + upcoming)</strong> abhi load karein — ya Playlists → Fetch EPG se poora XMLTV guide layein.</p>
          {!sourcePlaylist.password && <label className="mt-3 block max-w-sm text-xs text-muted">Account password (not saved)<input type="password" value={sgPass} onChange={(e) => setSgPass(e.target.value)} autoComplete="current-password" className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-ink px-3 text-sm text-silver focus:border-sky-400 focus:outline-none" /></label>}
          <Button className="mt-3" disabled={sgBusy} onClick={async () => { setSgBusy(true); try { const n = await loadShortEpg(item, sgPass || undefined); toast({ tone: 'success', title: `${n} programmes loaded`, body: 'Now/Next aur schedule neeche nazar ayegi.' }); } catch (e) { toast({ tone: 'error', title: 'EPG load nahi hua', body: e instanceof Error ? e.message : 'Failed' }); } finally { setSgBusy(false); } }}><CalendarClock size={17} aria-hidden />{sgBusy ? 'Loading guide…' : 'Load channel guide'}</Button>
        </section>
      )}
{sameGroupLive.length > 0 && (
        <section aria-label="More channels in this group" className="mt-6">
          <h2 className="mb-2 text-base font-extrabold">Same group — {cleanTitle(item.group) || 'Channels'}</h2>
          <div className="scroll-row -mx-3 px-3 sm:mx-0 sm:px-0">{sameGroupLive.map((c) => <MediaCard key={c.id} item={c} />)}</div>
        </section>
      )}
      {todayShows.length > 0 && (
        <section aria-label="Today's schedule" className="mt-6">
          <h2 className="mb-2 text-base font-extrabold">Today&rsquo;s schedule — {cleanTitle(item.title)}</h2>
          <div className="grid gap-1.5">
            {todayShows.map((pr) => { const now = Date.now(); const live = now >= pr.start && now < pr.end; return (
              <div key={pr.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${live ? 'border-sky-500/50 bg-sky-950/40' : 'border-border bg-card'}`}>
                <span className="w-[104px] shrink-0 text-xs tabular-nums text-muted">{new Date(pr.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(pr.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="min-w-0 flex-1 truncate font-semibold" title={pr.title}>{cleanTitle(pr.title)}</span>
                {live && <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">ON NOW</span>}
              </div> ); })}
          </div>
        </section>
      )}
      {moreLike.length > 0 && (
        <section aria-label="More like this" className="mt-6">
          <h2 className="mb-2 text-base font-extrabold">More in {cleanTitle(item.group) || 'this group'}</h2>
          <div className="scroll-row -mx-3 px-3 sm:mx-0 sm:px-0">{moreLike.map((m) => <MediaCard key={m.id} item={m} />)}</div>
        </section>
      )}
      <div className="mt-5 grid gap-2 text-sm text-muted"><p><strong className="text-silver">Format help:</strong> HLS (.m3u8), DASH (.mpd) and browser-supported MP4/WebM play here. MPEG-TS/FLV streams play inline via mpegts.js; RTSP/RTMP cannot play in any browser and need an authorized HLS/DASH gateway from your provider. DASH streams fail fast with the real Shaka error code (network, token/geo, manifest or DRM) — encrypted streams only play when you supply your provider-issued ClearKey/Widevine licence under Play Stream. Protected/DRM content is never circumvented.</p></div>
    </div>
  );
}
