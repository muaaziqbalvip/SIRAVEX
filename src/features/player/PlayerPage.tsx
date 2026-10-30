import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bell, BellRing, CalendarClock, Grid2x2, Heart, ListVideo, Lock, LockOpen, Star } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/ui';
import { PinModal } from '@/components/ui/PinModal';
import { PlayerShell } from '@/playback/components/PlayerShell';
import { MzAdSlot, MzPreroll, usePrerollGate } from '@/components/ads/MzAdSlot';
import { ChannelCard, MediaCard, SafeImage } from '@/components/media/MediaCard';
import { cleanTitle } from '@/lib/display';
import { isMediaLocked, isParentalActive } from '@/lib/parental';
import { matchesChannelEpg } from '@/services/epg/xmltv';

export function PlayerPage() {
  const { id } = useParams();
  const {
    ready, items, playlists, programmes, toggleFavourite, isFavourite, progress,
    settings, parentalUnlocked, toggleItemLock, toggleReminder, hasReminder,
    loadSeriesEpisodes, loadShortEpg, toast,
  } = useStore();
  const preroll = usePrerollGate();
  const [epPass, setEpPass] = useState('');
  const [epBusy, setEpBusy] = useState(false);
  const [sgPass, setSgPass] = useState('');
  const [sgBusy, setSgBusy] = useState(false);
  const [pinOpen, setPinOpen] = useState(true);

  const item = items.find((i) => i.id === decodeURIComponent(id ?? ''));
  const todayShows = useMemo(() => {
    if (!item || item.kind !== 'live') return [] as typeof programmes;
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    return programmes
      .filter((pr) => matchesChannelEpg(pr.channelId, item) && pr.end > dayStart.getTime() && pr.start < dayStart.getTime() + 86400000)
      .sort((a, b) => a.start - b.start)
      .slice(0, 20);
  }, [programmes, item]);

  if (!ready) return <Skeleton className="aspect-video w-full" />;
  if (!item) return <EmptyState title="Item not found" body="This item may have been removed with its playlist. Your library is unchanged otherwise." action={<Link to="/"><Button>Back to Home</Button></Link>} />;

  const locked = isMediaLocked(item, settings, parentalUnlocked);
  if (locked) {
    return (
      <div>
        <Card className="mx-auto max-w-lg py-10 text-center">
          <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/15 text-amber-300">
            <Lock size={26} aria-hidden />
          </span>
          <h1 className="text-xl font-extrabold">Channel Protected by Parental Lock</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
            <strong className="text-silver">{cleanTitle(item.title)}</strong> ({item.group}) ko dekhne ke liye apna Parental PIN enter karein.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={() => setPinOpen(true)}>Enter PIN to Watch</Button>
            <Link to="/"><Button variant="ghost">Back Home</Button></Link>
          </div>
        </Card>
        <PinModal open={pinOpen} onClose={() => setPinOpen(false)} />
      </div>
    );
  }

  const saved = progress.find((p) => p.itemId === item.id);
  const sameGroupLive = item.kind === 'live'
    ? items.filter((i) => i.kind === 'live' && i.playlistId === item.playlistId && i.group === item.group && i.id !== item.id && !isMediaLocked(i, settings, parentalUnlocked)).slice(0, 24)
    : [];
  const moreLike = item.kind === 'movie'
    ? items.filter((i) => i.kind === 'movie' && i.group === item.group && i.id !== item.id && !isMediaLocked(i, settings, parentalUnlocked)).slice(0, 12)
    : [];
  const fav = isFavourite(item.id);
  const itemLockedRaw = settings.lockedItemIds.includes(item.id);
  const episodes = item.kind === 'series' ? items.filter((i) => i.kind === 'series' && (i.seriesTitle ?? i.title) === (item.seriesTitle ?? item.title)).sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0)) : [];
  const idx = episodes.findIndex((e) => e.id === item.id);
  const nextEp = idx >= 0 ? episodes[idx + 1] : undefined;
  const sourcePlaylist = playlists.find((p) => p.id === item.playlistId);
  const isPlaceholder = item.kind === 'series' && !item.url;
  // Live TV zapping never waits on pre-roll network checks — instant channel start!
  const showPreroll = item.kind !== 'live' && preroll.show;

  return (
    <div className="w-full min-w-0 max-w-full">
      <nav aria-label="Breadcrumb" className="mb-2.5 truncate text-xs text-muted sm:text-sm">
        <Link to="/" className="hover:text-cyanx">Home</Link> {' › '}
        <Link to={item.kind === 'live' ? '/live' : item.kind === 'movie' ? '/movies' : '/series'} className="hover:text-cyanx">
          {item.kind === 'live' ? 'Live TV' : item.kind === 'movie' ? 'Movies' : 'Series'}
        </Link> {' › '}
        <span className="text-silver">{cleanTitle(item.title)}</span>
      </nav>

      {isPlaceholder ? (
        <Card className="grid gap-4 sm:grid-cols-[150px_1fr]">
          <span className="relative aspect-[2/3] w-[130px] overflow-hidden rounded-xl bg-panel sm:w-[150px]"><SafeImage src={item.poster || item.logo} title={item.title} className="h-full w-full" /></span>
          <div className="min-w-0">
            <h1 className="break-anywhere text-xl font-extrabold sm:text-2xl">{item.seriesTitle ?? item.title}</h1>
            <p className="mt-1 text-sm text-muted">{[item.group, item.year, item.genre].filter(Boolean).join(' · ')}</p>
            {item.description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{item.description}</p>}
            <p className="mt-3 text-sm leading-6">Is show ke episodes abhi load nahi hue (import fast rakhne ke liye). Provider se abhi load karein — phir har episode yahan Play ho jayega.</p>
            {sourcePlaylist?.type === 'xtream' && !sourcePlaylist.password && <label className="mt-3 block max-w-sm text-xs text-muted">Account password (not saved)<input type="password" value={epPass} onChange={(e) => setEpPass(e.target.value)} autoComplete="current-password" className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-ink px-3 text-sm text-silver focus:border-sky-400 focus:outline-none" /></label>}
            <Button className="mt-3" disabled={epBusy} onClick={async () => { setEpBusy(true); try { const n = await loadSeriesEpisodes(item, epPass || undefined); toast({ tone: 'success', title: `${n} episodes loaded`, body: 'Ab koi episode select kar ke Play karein.' }); } catch (e) { toast({ tone: 'error', title: 'Episodes load nahi hue', body: e instanceof Error ? e.message : 'Failed' }); } finally { setEpBusy(false); } }}><ListVideo size={17} aria-hidden />{epBusy ? 'Loading episodes…' : 'Load episodes'}</Button>
          </div>
        </Card>
      ) : showPreroll ? <MzPreroll onDone={preroll.dismiss} /> : <PlayerShell item={item} />}

      {!isPlaceholder && <MzAdSlot slot="banner" placement="player" compact className="mt-4" />}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="break-anywhere text-lg font-extrabold sm:text-2xl">{cleanTitle(item.title)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted sm:text-sm">
            <span>{[item.group, item.year, item.durationLabel, item.genre].filter(Boolean).join(' · ') || item.kind}</span>
            {item.rating ? <span className="inline-flex items-center gap-1 font-bold text-amber-300"><Star size={13} aria-hidden />{item.rating.toFixed(1)}</span> : null}
          </p>
          {item.description && <p className="mt-2.5 max-w-3xl text-sm leading-6 text-muted">{item.description}</p>}
          {saved && saved.duration > 0 && settings.resumePlayback && <p className="mt-2 text-xs text-cyanx sm:text-sm">Resume point saved locally at {Math.floor(saved.position)}s.</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {item.kind === 'live' && (
            <Link to="/multiview">
              <Button variant="outline" className="min-h-[40px] px-3 text-xs sm:text-sm"><Grid2x2 size={15} aria-hidden />Multi-View</Button>
            </Link>
          )}
          {isParentalActive(settings) && (
            <Button variant="outline" className="min-h-[40px] px-3 text-xs sm:text-sm" onClick={() => toggleItemLock(item.id)}>
              {itemLockedRaw ? <Lock size={15} className="text-amber-300" aria-hidden /> : <LockOpen size={15} aria-hidden />}
              {itemLockedRaw ? 'PIN Locked' : 'Lock'}
            </Button>
          )}
          <Button variant="outline" className="min-h-[40px] px-3 text-xs sm:text-sm" onClick={() => void toggleFavourite(item.id)} aria-pressed={fav}>
            <Heart size={16} className={fav ? 'fill-red-400 text-red-400' : ''} aria-hidden />
            {fav ? 'Favourited' : 'Favourite'}
          </Button>
        </div>
      </div>

      {nextEp && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-3.5 sm:p-4">
          <p className="truncate text-sm"><strong>Next episode:</strong> {nextEp.title}</p>
          <Link to={`/player/${encodeURIComponent(nextEp.id)}`}><Button className="mt-2 min-h-[40px] text-xs sm:text-sm">Play next episode</Button></Link>
        </div>
      )}

      {item.kind === 'live' && sourcePlaylist?.type === 'xtream' && item.streamId && todayShows.length === 0 && (
        <section aria-label="Provider guide" className="mt-5 rounded-2xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-base font-extrabold"><CalendarClock size={18} className="text-cyanx" aria-hidden />Channel Guide (EPG)</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted sm:text-sm">Provider se is channel ki <strong className="text-silver">short EPG (now/next + upcoming)</strong> abhi load karein.</p>
          {!sourcePlaylist.password && <label className="mt-3 block max-w-sm text-xs text-muted">Account password (not saved)<input type="password" value={sgPass} onChange={(e) => setSgPass(e.target.value)} autoComplete="current-password" className="mt-1 min-h-[44px] w-full rounded-xl border border-border bg-ink px-3 text-sm text-silver focus:border-sky-400 focus:outline-none" /></label>}
          <Button className="mt-3 min-h-[40px] text-xs sm:text-sm" disabled={sgBusy} onClick={async () => { setSgBusy(true); try { const n = await loadShortEpg(item, sgPass || undefined); toast({ tone: 'success', title: `${n} programmes loaded` }); } catch (e) { toast({ tone: 'error', title: 'EPG load nahi hua', body: e instanceof Error ? e.message : 'Failed' }); } finally { setSgBusy(false); } }}><CalendarClock size={16} aria-hidden />{sgBusy ? 'Loading guide…' : 'Load channel guide'}</Button>
        </section>
      )}

      {/* Fixed horizontal ChannelCard row — never stacks giant full-width cards! */}
      {sameGroupLive.length > 0 && (
        <section aria-label="More channels in this group" className="mt-6 min-w-0">
          <h2 className="mb-2.5 text-base font-extrabold">Same Category — {cleanTitle(item.group) || 'Channels'}</h2>
          <div className="scroll-row pb-1.5">
            {sameGroupLive.map((c) => <ChannelCard key={c.id} item={c} />)}
          </div>
        </section>
      )}

      {todayShows.length > 0 && (
        <section aria-label="Today's schedule" className="mt-6">
          <h2 className="mb-2.5 text-base font-extrabold">Today&rsquo;s schedule — {cleanTitle(item.title)}</h2>
          <div className="grid gap-1.5">
            {todayShows.map((pr) => {
              const now = Date.now();
              const live = now >= pr.start && now < pr.end;
              const upcoming = pr.start > now;
              const remOn = hasReminder(pr.id);
              return (
                <div key={pr.id} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm sm:flex-nowrap ${live ? 'border-sky-500/50 bg-sky-950/40' : 'border-border bg-card'}`}>
                  <span className="w-[100px] shrink-0 font-mono text-[11px] tabular-nums text-muted">
                    {new Date(pr.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(pr.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold" title={pr.title}>{cleanTitle(pr.title)}</span>
                  {live && <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">ON NOW</span>}
                  {upcoming && (
                    <button
                      type="button"
                      onClick={() => toggleReminder(pr, item)}
                      title={remOn ? 'Cancel programme reminder' : 'Remind me when programme starts'}
                      aria-pressed={remOn}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                        remOn ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/50' : 'bg-white/5 text-muted hover:text-silver'
                      }`}
                    >
                      {remOn ? <BellRing size={12} aria-hidden /> : <Bell size={12} aria-hidden />}
                      {remOn ? 'Remind On' : 'Remind'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {moreLike.length > 0 && (
        <section aria-label="More like this" className="mt-6 min-w-0">
          <h2 className="mb-2.5 text-base font-extrabold">More in {cleanTitle(item.group) || 'this group'}</h2>
          <div className="grid grid-cols-2 gap-3 min-[500px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
            {moreLike.map((m) => <MediaCard key={m.id} item={m} />)}
          </div>
        </section>
      )}
    </div>
  );
}
