import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Gauge, Maximize, Pause, PictureInPicture2, Play, RotateCcw, Settings2, Subtitles, Volume2, VolumeX, AudioLines } from 'lucide-react';
import { PlaybackEngine, type PlayerSnapshot } from '@/playback/engine';
import { Button, formatTime } from '@/components/ui/ui';
import { useStore } from '@/app/store';
import type { MediaItem } from '@/types/models';

const IDLE: PlayerSnapshot = { state: 'idle', currentTime: 0, duration: 0, seekable: false, live: false, muted: false, volume: 1, rate: 1, bufferedEnd: 0, qualities: [], qualityId: 'auto', currentQualityLabel: 'Auto', audioTracks: [], audioId: '', subtitleTracks: [{ id: 'off', label: 'Off' }], subtitleId: 'off', error: null, engine: 'none' };
type Panel = 'none' | 'quality' | 'audio' | 'subs' | 'speed';

export function PlayerShell({ item }: { item: MediaItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const resumedRef = useRef(false);
  const navigate = useNavigate();
  const [snap, setSnap] = useState<PlayerSnapshot>(IDLE);
  const [theatre, setTheatre] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const [controlsVisible, setControlsVisible] = useState(true);
  const { settings, saveProgress, logDiagnostic, programmes, items, progress } = useStore();

  const liveSiblings = useMemo(() => (item.kind === 'live' ? items.filter((i) => i.playlistId === item.playlistId && i.kind === 'live') : []), [items, item.playlistId, item.kind]);
  const sibIdx = liveSiblings.findIndex((i) => i.id === item.id);
  const prevCh = sibIdx > 0 ? liveSiblings[sibIdx - 1] : undefined;
  const nextCh = sibIdx >= 0 && sibIdx < liveSiblings.length - 1 ? liveSiblings[sibIdx + 1] : undefined;

  const nowNext = useMemo(() => {
    if (!item.tvgId) return {};
    const list = programmes.filter((p) => p.channelId === item.tvgId).sort((a, b) => a.start - b.start);
    const now = Date.now();
    return { current: list.find((p) => now >= p.start && now < p.end), next: list.find((p) => p.start > now) };
  }, [programmes, item.tvgId]);

  const poke = useCallback((playing: boolean) => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (playing) hideTimer.current = window.setTimeout(() => { setControlsVisible(false); setPanel('none'); }, 3200);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    resumedRef.current = false;
    const engine = new PlaybackEngine(video);
    engineRef.current = engine;
    const unsub = engine.subscribe((s) => {
      setSnap(s);
      // Store guard throttles to >=5s movement — this no longer re-renders the whole app per tick.
      if ((s.state === 'playing' || s.state === 'paused') && s.duration > 0) saveProgress(item.id, s.currentTime, s.duration);
      if (s.state === 'error' && s.error) void logDiagnostic(s.error.category, s.error.message, item.url);
      if ((s.state === 'playing' || s.state === 'paused') && !resumedRef.current) {
        resumedRef.current = true;
        const saved = progress.find((p) => p.itemId === item.id);
        if (settings.resumePlayback && saved && saved.position > 10 && saved.duration > 0 && saved.position / saved.duration < 0.95 && Math.abs(video.currentTime - saved.position) > 3) {
          try { video.currentTime = saved.position; } catch { /* not seekable yet */ }
        }
      }
    });
    video.volume = settings.defaultVolume;
    video.playbackRate = settings.playbackSpeed;
    void engine.load(item.url).then(() => { if (settings.autoplay) engine.play(); });
    poke(false);
    return () => { unsub(); engine.destroy(); engineRef.current = null; if (hideTimer.current) window.clearTimeout(hideTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.url]);

  useEffect(() => { poke(snap.state === 'playing'); }, [snap.state, poke]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
      const eng = engineRef.current; if (!eng) return;
      if (e.code === 'Space') { e.preventDefault(); snap.state === 'playing' ? eng.pause() : eng.play(); }
      else if (e.key === 'm' || e.key === 'M') eng.toggleMute();
      else if (e.key === 'f' || e.key === 'F') void wrapRef.current?.requestFullscreen?.().catch(() => undefined);
      else if (e.key === 'ArrowRight') eng.seekBy(10);
      else if (e.key === 'ArrowLeft') eng.seekBy(-10);
      else if (e.key === 'Escape') setPanel('none');
      poke(snap.state === 'playing');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap.state, poke]);

  const eng = () => engineRef.current;
  const playing = snap.state === 'playing';
  const showUi = controlsVisible || !playing || panel !== 'none';
  const subtitleStyle = { fontSize: settings.subtitleSize === 'small' ? '14px' : settings.subtitleSize === 'large' ? '22px' : '18px', color: settings.subtitleColor } as React.CSSProperties;

  const optionList = (options: { id: string; label: string; lang?: string }[], active: string, onPick: (id: string) => void, emptyNote: string) => (
    options.length === 0 ? <p className="px-2 py-3 text-sm text-white/70">{emptyNote}</p> :
    <div className="grid max-h-56 gap-1 overflow-y-auto" role="listbox">
      {options.map((o) => (
        <button key={o.id} type="button" role="option" aria-selected={active === o.id} onClick={() => { onPick(o.id); setPanel('none'); poke(playing); }} className={`flex min-h-[44px] items-center justify-between rounded-lg px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${active === o.id ? 'bg-sky-500 text-white' : 'text-white/85 hover:bg-white/10'}`}>
          <span>{o.label}{o.lang ? ` · ${o.lang}` : ''}</span>{active === o.id && <span aria-hidden>✓</span>}
        </button>
      ))}
    </div>
  );

  return (
    <section aria-label={`Player: ${item.title}`} className={theatre ? 'mx-auto w-full max-w-none' : ''}>
      <div ref={wrapRef} className="group/player relative select-none overflow-hidden rounded-2xl border border-border bg-black shadow-card"
        onMouseMove={() => poke(playing)} onTouchStart={() => poke(playing)}>
        <video ref={videoRef} className="aspect-video w-full bg-black" playsInline aria-label={item.title} style={subtitleStyle}
          onClick={() => { playing ? eng()?.pause() : eng()?.play(); poke(!playing); }}
          onDoubleClick={(e) => { if (!snap.seekable) return; const r = (e.currentTarget as HTMLVideoElement).getBoundingClientRect(); eng()?.seekBy(e.clientX - r.left < r.width / 2 ? -10 : 10); }} />
        {/* Top bar */}
        <div className={`absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/85 to-transparent p-3 pb-8 transition-opacity duration-300 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <button type="button" onClick={() => navigate(-1)} aria-label="Go back" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/50 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><ChevronLeft size={21} /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white sm:text-base">{item.title}</p>
            <p className="truncate text-xs text-white/70">{nowNext.current ? `Now: ${nowNext.current.title}` : item.group}{snap.live ? '' : ''}</p>
          </div>
          {snap.live && <span className="inline-flex shrink-0 items-center gap-1.5 rounded bg-red-600 px-2 py-1 text-[11px] font-extrabold text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />LIVE</span>}
          <span className="hidden shrink-0 rounded bg-black/60 px-2 py-1 text-[11px] font-semibold text-white/85 sm:inline">{snap.currentQualityLabel} · {snap.engine}</span>
        </div>

        {/* Center states */}
        {(snap.state === 'loading' || snap.state === 'buffering') && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status" aria-label={snap.state}>
            <span className="grid place-items-center gap-2"><span className="h-12 w-12 animate-spin rounded-full border-[3px] border-white/25 border-t-cyan-300" /><span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">{snap.state === 'loading' ? 'Loading stream…' : 'Buffering…'}</span></span>
          </div>
        )}
        {!playing && snap.state !== 'loading' && snap.state !== 'buffering' && snap.state !== 'error' && (
          <button type="button" onClick={() => eng()?.play()} aria-label="Play" className="absolute inset-0 grid w-full place-items-center bg-black/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyanx">
            <span className="grid h-[72px] w-[72px] place-items-center rounded-full bg-sky-500 text-white shadow-glow transition hover:scale-105"><Play size={34} className="ml-1" /></span>
          </button>
        )}
        {snap.state === 'error' && snap.error && (
          <div className="absolute inset-0 grid place-items-center overflow-y-auto bg-black/90 p-4" role="alert">
            <div className="w-full max-w-lg text-center">
              <img src="/icons/logo-256.png" alt="" width={52} height={52} className="mx-auto mb-3 h-[52px] w-[52px] rounded-2xl opacity-90" />
              <h2 className="text-base font-bold sm:text-lg">Playback failed — {snap.error.category.replace(/-/g, ' ')}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{snap.error.message}</p>
              <p className="mt-1.5 text-sm leading-6 text-silver">{snap.error.action}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2"><Button onClick={() => eng()?.retry()}><RotateCcw size={16} aria-hidden />Retry</Button>{nextCh && <Button variant="outline" onClick={() => navigate(`/player/${encodeURIComponent(nextCh.id)}`)}>Next channel</Button>}</div>
              <p className="mt-3 text-[11px] text-muted">Engine {snap.engine} · only the source host is saved in Diagnostics — never full private URLs.</p>
            </div>
          </div>
        )}

        {/* Bottom controls */}
        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/92 via-black/60 to-transparent px-2.5 pb-2 pt-12 transition-opacity duration-300 sm:px-3 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          {snap.seekable && !snap.live ? (
            <div className="flex items-center gap-2">
              <span className="w-11 shrink-0 text-right text-[11px] tabular-nums text-white/90">{formatTime(snap.currentTime)}</span>
              <input type="range" min={0} max={snap.duration || 0} step={1} value={Math.min(snap.currentTime, snap.duration || 0)} onChange={(e) => eng()?.seek(Number(e.target.value))} className="min-w-0 flex-1 accent-sky-400" aria-label="Seek through video" />
              <span className="w-11 shrink-0 text-[11px] tabular-nums text-white/90">{formatTime(snap.duration)}</span>
            </div>
          ) : snap.live ? (
            <div className="mb-1 h-1 overflow-hidden rounded bg-white/15" aria-hidden><div className="h-full w-full origin-left bg-red-500/80" /></div>
          ) : null}
          <div className="mt-1 flex items-center gap-0.5 sm:gap-1.5">
            {item.kind === 'live' && <button type="button" disabled={!prevCh} onClick={() => prevCh && navigate(`/player/${encodeURIComponent(prevCh.id)}`)} aria-label={prevCh ? `Previous channel: ${prevCh.title}` : 'No previous channel'} className="grid h-10 w-9 place-items-center rounded-full text-white hover:bg-white/10 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><ChevronLeft size={21} /></button>}
            <button type="button" onClick={() => (playing ? eng()?.pause() : eng()?.play())} aria-label={playing ? 'Pause' : 'Play'} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sky-500 text-white shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">{playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}</button>
            {item.kind === 'live' && <button type="button" disabled={!nextCh} onClick={() => nextCh && navigate(`/player/${encodeURIComponent(nextCh.id)}`)} aria-label={nextCh ? `Next channel: ${nextCh.title}` : 'No next channel'} className="grid h-10 w-9 place-items-center rounded-full text-white hover:bg-white/10 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><ChevronRight size={21} /></button>}
            <button type="button" onClick={() => eng()?.toggleMute()} aria-label={snap.muted ? 'Unmute' : 'Mute'} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">{snap.muted || snap.volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
            <input type="range" min={0} max={1} step={0.05} value={snap.muted ? 0 : snap.volume} onChange={(e) => eng()?.setVolume(Number(e.target.value))} className="hidden w-20 accent-sky-400 md:block" aria-label="Volume" />
            {!snap.live && <span className="hidden shrink-0 text-[11px] tabular-nums text-white/85 sm:inline">{formatTime(snap.currentTime)}{snap.duration > 0 ? ` / ${formatTime(snap.duration)}` : ''}</span>}
            <span className="min-w-0 flex-1" />
            <button type="button" onClick={() => setPanel(panel === 'quality' ? 'none' : 'quality')} aria-expanded={panel === 'quality'} className="inline-flex h-10 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-bold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Gauge size={17} aria-hidden /><span className="max-w-[92px] truncate">{snap.currentQualityLabel}</span></button>
            <button type="button" onClick={() => setPanel(panel === 'audio' ? 'none' : 'audio')} aria-expanded={panel === 'audio'} aria-label="Audio tracks" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><AudioLines size={19} /></button>
            <button type="button" onClick={() => setPanel(panel === 'subs' ? 'none' : 'subs')} aria-expanded={panel === 'subs'} aria-label="Subtitles" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Subtitles size={19} /></button>
            <button type="button" onClick={() => setPanel(panel === 'speed' ? 'none' : 'speed')} aria-expanded={panel === 'speed'} aria-label="Playback speed and player options" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Settings2 size={19} /></button>
            <button type="button" onClick={async () => { try { await videoRef.current?.requestPictureInPicture(); } catch { /* unsupported */ } }} aria-label="Picture in picture" className="hidden h-10 w-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx sm:grid"><PictureInPicture2 size={19} /></button>
            <button type="button" onClick={() => void wrapRef.current?.requestFullscreen?.().catch(() => undefined)} aria-label="Fullscreen" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Maximize size={19} /></button>
          </div>

          {panel !== 'none' && (
            <div className="absolute inset-x-2 bottom-full mb-1 max-h-[52%] overflow-hidden rounded-2xl border border-white/15 bg-[#0a1122f2] p-2 shadow-card backdrop-blur sm:left-auto sm:right-2 sm:w-[320px]" role="dialog" aria-label={panel === 'quality' ? 'Quality' : panel === 'audio' ? 'Audio tracks' : panel === 'subs' ? 'Subtitles' : 'Playback speed'}>
              <p className="px-2 pb-1.5 pt-1 text-xs font-bold uppercase tracking-wider text-white/60">{panel === 'quality' ? `Quality — now ${snap.currentQualityLabel}` : panel === 'audio' ? 'Audio track' : panel === 'subs' ? 'Subtitles' : 'Speed & view'}</p>
              {panel === 'quality' && optionList(snap.qualities.length ? snap.qualities : [{ id: 'auto', label: 'Auto (browser managed)' }], snap.qualityId, (id) => eng()?.setQuality(id), 'Renditions are managed automatically by this source/browser.')}
              {panel === 'audio' && optionList(snap.audioTracks, snap.audioId, (id) => eng()?.setAudio(id), 'This stream exposes a single audio track, so there is nothing to switch.')}
              {panel === 'subs' && optionList(snap.subtitleTracks, snap.subtitleId, (id) => eng()?.setSubtitle(id), 'No subtitle tracks in this stream.')}
              {panel === 'speed' && (
                <div>
                  {optionList([0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => ({ id: String(r), label: `${r}×${r === 1 ? ' (Normal)' : ''}` })), String(snap.rate), (id) => eng()?.setRate(Number(id)), '')}
                  <button type="button" onClick={() => setTheatre(!theatre)} aria-pressed={theatre} className={`mt-1 flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${theatre ? 'bg-sky-500 text-white' : 'text-white/85 hover:bg-white/10'}`}>Theatre mode {theatre && <span aria-hidden>✓</span>}</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <span>Engine <strong className="text-silver">{snap.engine}</strong></span><span>Quality <strong className="text-silver">{snap.currentQualityLabel}</strong></span><span>State <strong className="text-silver">{snap.state}</strong></span>
        <span className="hidden sm:inline">Keys: Space · ←/→ seek · M mute · F fullscreen</span>
      </div>
      {(nowNext.current || nowNext.next) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {nowNext.current && <div className="rounded-xl border border-sky-500/40 bg-sky-950/40 p-3 text-sm"><p className="font-bold">Now — {nowNext.current.title}</p><p className="mt-0.5 text-xs text-muted">{new Date(nowNext.current.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(nowNext.current.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p><span className="mt-2 block h-1.5 overflow-hidden rounded bg-slate-800"><span className="block h-full bg-sky-400" style={{ width: `${Math.min(100, Math.max(0, ((Date.now() - nowNext.current.start) / (nowNext.current.end - nowNext.current.start)) * 100))}%` }} /></span></div>}
          {nowNext.next && <div className="rounded-xl border border-border bg-card p-3 text-sm"><p className="font-bold">Next — {nowNext.next.title}</p><p className="mt-0.5 text-xs text-muted">{new Date(nowNext.next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(nowNext.next.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div>}
        </div>
      )}
    </section>
  );
}
