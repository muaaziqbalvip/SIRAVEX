import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Camera, Check, ChevronLeft, ChevronRight, ExternalLink, Gauge, Heart, Maximize, Moon, Pause, PictureInPicture2, Play, Radio, RotateCcw, Settings2, Share2, Subtitles, Upload, Volume2, VolumeX, AudioLines, X } from 'lucide-react';
import { PlaybackEngine, type LoadOptions, type PlayerSnapshot } from '@/playback/engine';
import { Button, formatTime } from '@/components/ui/ui';
import { useStore } from '@/app/store';
import { cleanTitle } from '@/lib/display';
import { isSubtitleFile, srtToVtt } from '@/lib/subtitles';
import { trackWatch, trackWatchMinute } from '@/services/firebase/tracking';
import type { MediaItem } from '@/types/models';

const IDLE: PlayerSnapshot = { state: 'idle', currentTime: 0, duration: 0, seekable: false, live: false, muted: false, volume: 1, rate: 1, bufferedEnd: 0, qualities: [], qualityId: 'auto', currentQualityLabel: 'Auto', audioTracks: [], audioId: '', audioLabel: 'Default', subtitleTracks: [{ id: 'off', label: 'Off' }], subtitleId: 'off', resolution: '—', bitrateKbps: 0, droppedFrames: 0, totalFrames: 0, behindLiveSec: 0, error: null, engine: 'none', format: 'none', attempt: 1, attempts: 1, notice: '' };
type Panel = 'none' | 'quality' | 'audio' | 'subs' | 'more';
const PANEL_TITLES: Record<Exclude<Panel, 'none'>, string> = { quality: 'Video Quality', audio: 'Audio Track', subs: 'Subtitles', more: 'Speed, Sleep Timer & View' };

function langName(code?: string): string {
  if (!code) return '';
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code.split('-')[0]) ?? code; } catch { return code; }
}

export function PlayerShell({ item, loadOpts }: { item: MediaItem; loadOpts?: LoadOptions }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const sleepTimer = useRef<number | null>(null);
  const extSubUrl = useRef<string | null>(null);
  const subInputRef = useRef<HTMLInputElement>(null);
  const resumedRef = useRef(false);
  const navigate = useNavigate();
  const [snap, setSnap] = useState<PlayerSnapshot>(IDLE);
  const [theatre, setTheatre] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const panelRef = useRef<Panel>('none');
  useEffect(() => { panelRef.current = panel; }, [panel]);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [notice, setNotice] = useState('');
  const [statsOn, setStatsOn] = useState(false);
  const [sleepMin, setSleepMin] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const { settings, saveProgress, logDiagnostic, programmes, items, progress, toggleFavourite, isFavourite } = useStore();
  const fav = isFavourite(item.id);

  const liveSiblings = useMemo(() => (item.kind === 'live' ? items.filter((i) => i.playlistId === item.playlistId && i.kind === 'live') : []), [items, item.playlistId, item.kind]);
  const sibIdx = liveSiblings.findIndex((i) => i.id === item.id);
  const prevCh = sibIdx > 0 ? liveSiblings[sibIdx - 1] : undefined;
  const nextCh = sibIdx >= 0 && sibIdx < liveSiblings.length - 1 ? liveSiblings[sibIdx + 1] : undefined;

  const nowNext = useMemo(() => {
    if (!item.tvgId) return {};
    const list = programmes.filter((p) => p.channelId === item.tvgId || p.channelId === item.id).sort((a, b) => a.start - b.start);
    const now = Date.now();
    return { current: list.find((p) => now >= p.start && now < p.end), next: list.find((p) => p.start > now) };
  }, [programmes, item.tvgId]);

  /** Auto-hide sirf jab playing hai aur koi panel khula nahi. Panel khulte hi timer cancel. */
  const poke = useCallback((isPlaying: boolean) => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    if (isPlaying) {
      hideTimer.current = window.setTimeout(() => { if (panelRef.current === 'none') setControlsVisible(false); }, 3400);
    }
  }, []);

  useEffect(() => {
    if (panel !== 'none') {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
      setControlsVisible(true);
    }
  }, [panel]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    resumedRef.current = false;
    const engine = new PlaybackEngine(video);
    engineRef.current = engine;
    const unsub = engine.subscribe((s) => {
      setSnap(s);
      if ((s.state === 'playing' || s.state === 'paused') && s.duration > 0) saveProgress(item.id, s.currentTime, s.duration);
      if (s.state === 'error' && s.error) void logDiagnostic(s.error.category, `${s.error.message}${s.error.codeLabel ? ` [${s.error.codeLabel}]` : ''}`, item.url);
      if ((s.state === 'playing' || s.state === 'paused') && !resumedRef.current) {
        resumedRef.current = true;
        const saved = progress.find((p) => p.itemId === item.id);
        if (item.kind !== 'live' && settings.resumePlayback && saved && saved.position > 10 && saved.duration > 0 && saved.position / saved.duration < 0.95 && Math.abs(video.currentTime - saved.position) > 3) {
          try { video.currentTime = saved.position; } catch { /* not seekable yet */ }
        }
      }
    });
    video.volume = settings.defaultVolume;
    video.playbackRate = settings.playbackSpeed;
    void engine.load(item.url, loadOpts).then(() => { if (settings.autoplay) engine.play(); });
    poke(false);
    return () => {
      unsub(); engine.destroy(); engineRef.current = null;
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (extSubUrl.current) { URL.revokeObjectURL(extSubUrl.current); extSubUrl.current = null; }
      video.querySelectorAll('track[data-siravex-ext]').forEach((t) => t.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.url]);

  useEffect(() => { if (panel === 'none') poke(snap.state === 'playing'); }, [snap.state, poke, panel]);

  // Engine ki notice (masalan audio codec auto-switch) user ko dikhao
  const noticeShown = useRef('');
  useEffect(() => {
    if (snap.notice && snap.notice !== noticeShown.current) { noticeShown.current = snap.notice; setNotice(snap.notice); }
  }, [snap.notice]);

  // Deep tracking: pehli dafa play hone par watch event + har minute watch-time.
  // Sirf login users (tracking layer khud check karta hai); stream URL kabhi nahi jata.
  const watchTracked = useRef(false);
  useEffect(() => { watchTracked.current = false; }, [item.id]);
  useEffect(() => {
    if (snap.state !== 'playing') return;
    if (!watchTracked.current) { watchTracked.current = true; void trackWatch(item); }
    const iv = window.setInterval(() => void trackWatchMinute(item), 60000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.state === 'playing', item.id]);

  // Sleep timer
  useEffect(() => {
    if (sleepTimer.current) window.clearTimeout(sleepTimer.current);
    sleepTimer.current = null;
    if (sleepMin > 0) {
      sleepTimer.current = window.setTimeout(() => { engineRef.current?.pause(); setSleepMin(0); setNotice('Sleep timer — playback paused.'); setControlsVisible(true); }, sleepMin * 60000);
    }
    return () => { if (sleepTimer.current) window.clearTimeout(sleepTimer.current); };
  }, [sleepMin]);

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
      else if (e.key === 'ArrowUp') { e.preventDefault(); eng.setVolume(Math.min(1, snap.volume + 0.1)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); eng.setVolume(Math.max(0, snap.volume - 0.1)); }
      else if (e.key === 'Escape') setPanel('none');
      poke(snap.state === 'playing');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap.state, snap.volume, poke]);

  const eng = () => engineRef.current;
  const playing = snap.state === 'playing';
  const showUi = controlsVisible || !playing || panel !== 'none';
  const subtitleStyle = { fontSize: settings.subtitleSize === 'small' ? '14px' : settings.subtitleSize === 'large' ? '22px' : '18px', color: settings.subtitleColor } as React.CSSProperties;
  const bufferAhead = Math.max(0, Math.round(snap.bufferedEnd - snap.currentTime));
  const dropPct = snap.totalFrames > 0 ? ((snap.droppedFrames / snap.totalFrames) * 100).toFixed(1) : '0.0';
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? 'none' : p));

  const onExternalSubtitle = async (file: File) => {
    const video = videoRef.current; const engine = engineRef.current;
    if (!video || !engine) return;
    if (!isSubtitleFile(file.name)) { setNotice('Sirf .srt ya .vtt subtitle file chalein gi.'); return; }
    if (file.size > 2 * 1024 * 1024) { setNotice('Subtitle file bohat bari hai (max 2 MB).'); return; }
    try {
      const text = await file.text();
      const vtt = /\.srt$/i.test(file.name) ? srtToVtt(text) : text;
      if (extSubUrl.current) URL.revokeObjectURL(extSubUrl.current);
      video.querySelectorAll('track[data-siravex-ext]').forEach((t) => t.remove());
      extSubUrl.current = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      const track = document.createElement('track');
      track.kind = 'subtitles'; track.label = file.name; track.srclang = 'und'; track.src = extSubUrl.current;
      track.setAttribute('data-siravex-ext', '1');
      video.appendChild(track);
      window.setTimeout(() => {
        let done = false;
        for (let i = 0; i < video.textTracks.length; i++) if (video.textTracks[i].label === file.name) { engine.showExternalSubtitle(i); done = true; break; }
        setNotice(done ? `Subtitle loaded: ${file.name}` : 'Subtitle file add ho gayi magar browser ne track register nahi kiya.');
      }, 80);
      setPanel('none');
    } catch { setNotice('Subtitle file parhi nahi ja saki.'); }
  };

  const openInDirect = () => {
    try { sessionStorage.setItem('siravex-direct-prefill', item.url); } catch { /* ignore */ }
    navigate('/direct');
  };

  const optionRow = (o: { id: string; label: string; sub?: string }, active: string, onPick: (id: string) => void) => (
    <button key={o.id} type="button" role="option" aria-selected={active === o.id} onClick={() => { onPick(o.id); setPanel('none'); }} className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${active === o.id ? 'bg-sky-500 text-white' : 'text-white/90 hover:bg-white/10'}`}>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{o.label}</span>{o.sub && <span className={`block truncate text-[11px] ${active === o.id ? 'text-white/75' : 'text-white/50'}`}>{o.sub}</span>}</span>
      {active === o.id && <Check size={17} className="shrink-0" aria-hidden />}
    </button>
  );

  const panelBody = () => {
    if (panel === 'quality') {
      const single = snap.qualities.length <= 1;
      return (
        <div className="grid gap-1" role="listbox" aria-label="Video quality">
          {optionRow({ id: 'auto', label: 'Auto', sub: snap.bitrateKbps ? `Adaptive · abhi ${snap.bitrateKbps} kbps` : 'Adaptive — network ke hisab se behtareen' }, snap.qualityId, (id) => eng()?.setQuality(id))}
          {snap.qualities.filter((q) => q.id !== 'auto').map((q) => optionRow(q, snap.qualityId, (id) => eng()?.setQuality(id)))}
          {single && <p className="px-3 py-2 text-xs leading-5 text-white/60">Ye stream sirf aik rendition bhejta hai{snap.resolution !== '—' ? ` (${snap.resolution})` : ''} — mazeed qualities source mein hain hi nahi, is liye menu mein nahi dikhtin. Ye player ki kharabi nahi hai.</p>}
        </div>
      );
    }
    if (panel === 'audio') {
      return snap.audioTracks.length === 0
        ? <p className="px-3 py-2 text-sm leading-6 text-white/70">Is stream mein sirf aik audio track hai ({snap.audioLabel}) — badalne ke liye doosra track source mein maujood hi nahi. Multi-audio streams mein saare tracks yahan list hote hain.</p>
        : <div className="grid gap-1" role="listbox" aria-label="Audio tracks">{snap.audioTracks.map((t) => optionRow({ id: t.id, label: t.label, sub: t.lang ? langName(t.lang) : undefined }, snap.audioId, (id) => eng()?.setAudio(id)))}</div>;
    }
    if (panel === 'subs') {
      return (
        <div>
          <div className="grid gap-1" role="listbox" aria-label="Subtitles">{snap.subtitleTracks.map((t) => optionRow({ id: t.id, label: t.label, sub: t.lang ? langName(t.lang) : undefined }, snap.subtitleId, (id) => eng()?.setSubtitle(id)))}</div>
          <input ref={subInputRef} type="file" accept=".srt,.vtt" className="sr-only" aria-label="Load subtitle file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onExternalSubtitle(f); }} />
          <button type="button" onClick={() => subInputRef.current?.click()} className="mt-2 flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-dashed border-white/25 px-3 text-sm font-semibold text-white/90 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Upload size={17} aria-hidden />Apni subtitle file load karein (.srt / .vtt)</button>
          <p className="px-1 pt-2 text-[11px] leading-4 text-white/50">Subtitle ka size/colour Settings se badlein — jahan browser native track render karta hai wahan apply hota hai.</p>
        </div>
      );
    }
    return (
      <div>
        <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/50">Playback speed</p>
        <div className="grid gap-1" role="listbox" aria-label="Playback speed">{[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => optionRow({ id: String(r), label: `${r}×${r === 1 ? ' · Normal' : ''}` }, String(snap.rate), (id) => eng()?.setRate(Number(id))))}</div>
        <p className="px-2 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-white/50">Sleep timer</p>
        <div className="grid gap-1" role="listbox" aria-label="Sleep timer">{[0, 15, 30, 45, 60].map((m) => optionRow({ id: String(m), label: m === 0 ? 'Off' : `${m} minutes`, sub: m > 0 && sleepMin === m ? 'Chal raha hai — waqt pura hone par pause' : undefined }, String(sleepMin), (id) => setSleepMin(Number(id))))}</div>
        <button type="button" onClick={() => setTheatre(!theatre)} aria-pressed={theatre} className={`mt-3 flex min-h-[48px] w-full items-center justify-between rounded-xl px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${theatre ? 'bg-sky-500 text-white' : 'text-white/90 hover:bg-white/10'}`}>Theatre mode {theatre && <Check size={17} aria-hidden />}</button>
        <button type="button" onClick={() => setFit(fit === 'contain' ? 'cover' : 'contain')} aria-pressed={fit === 'cover'} className="flex min-h-[48px] w-full items-center justify-between rounded-xl px-3 text-sm font-semibold text-white/90 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">Video fill (crop) {fit === 'cover' && <Check size={17} aria-hidden />}</button>
      </div>
    );
  };

  return (
    <section aria-label={`Player: ${item.title}`} className={theatre ? 'mx-auto w-full max-w-none' : 'w-full min-w-0'}>
      <div ref={wrapRef} className="group/player relative w-full min-w-0 select-none overflow-hidden rounded-2xl border border-border bg-black shadow-card"
        onMouseMove={() => poke(playing)} onTouchStart={() => poke(playing)}>
        <video ref={videoRef} className="aspect-video w-full bg-black" playsInline aria-label={item.title} style={{ ...subtitleStyle, objectFit: fit }}
          onClick={() => { playing ? eng()?.pause() : eng()?.play(); }}
          onDoubleClick={(e) => { if (!snap.seekable) return; const r = (e.currentTarget as HTMLVideoElement).getBoundingClientRect(); eng()?.seekBy(e.clientX - r.left < r.width / 2 ? -10 : 10); }} />

        {/* Top bar */}
        <div className={`absolute inset-x-0 top-0 z-10 flex items-center gap-1.5 bg-gradient-to-b from-black/85 to-transparent p-2.5 pb-9 transition-opacity duration-300 sm:gap-2 sm:p-3 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          <button type="button" onClick={() => navigate(-1)} aria-label="Go back" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/50 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><ChevronLeft size={21} /></button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white sm:text-base" title={item.title}>{cleanTitle(item.title)}</p>
            <p className="truncate text-xs text-white/70">{nowNext.current ? `Now: ${cleanTitle(nowNext.current.title)}` : cleanTitle(item.group)}</p>
          </div>
          <button type="button" onClick={() => void toggleFavourite(item.id)} aria-label={fav ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={fav} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/50 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Heart size={18} className={fav ? 'fill-red-400 text-red-400' : ''} /></button>
          <button type="button" onClick={() => setStatsOn(!statsOn)} aria-label="Toggle stream statistics" aria-pressed={statsOn} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${statsOn ? 'bg-sky-500' : 'bg-black/50'}`}><Activity size={18} /></button>
          {snap.live && <span className="inline-flex shrink-0 items-center gap-1.5 rounded bg-red-600 px-2 py-1 text-[11px] font-extrabold text-white"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />LIVE</span>}
        </div>

        {/* Stats overlay (asal numbers) */}
        {statsOn && (
          <div className="pointer-events-none absolute left-2.5 top-16 z-10 w-[220px] rounded-xl border border-white/15 bg-black/80 p-3 font-mono text-[11px] leading-5 text-emerald-200 backdrop-blur" aria-label="Stream statistics">
            {[['Engine', snap.engine], ['Format', snap.format.toUpperCase()], ['Resolution', snap.resolution], ['Bitrate', snap.bitrateKbps ? `${snap.bitrateKbps} kbps` : '—'], ['Quality', snap.currentQualityLabel], ['Audio', snap.audioLabel], ['Buffer ahead', `${bufferAhead}s`], ['Dropped', `${snap.droppedFrames}/${snap.totalFrames} (${dropPct}%)`], ['State', snap.state]].map(([k, v]) => <p key={k} className="flex justify-between gap-2"><span className="text-white/50">{k}</span><span className="truncate">{v}</span></p>)}
          </div>
        )}

        {/* Go Live (DVR live par peeche hon to) */}
        {snap.live && snap.seekable && snap.behindLiveSec > 15 && snap.state !== 'error' && (
          <button type="button" onClick={() => eng()?.goLive()} className="absolute bottom-24 right-3 z-10 inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-red-600 px-3 text-xs font-extrabold text-white shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Radio size={14} aria-hidden />GO LIVE · -{Math.round(snap.behindLiveSec)}s</button>
        )}

        {(snap.state === 'loading' || snap.state === 'buffering') && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center" role="status" aria-label={snap.state}>
            <span className="grid place-items-center gap-2"><span className="h-12 w-12 animate-spin rounded-full border-[3px] border-white/25 border-t-cyan-300" /><span className="rounded-full bg-black/60 px-3 py-1 text-xs text-white">{snap.state === 'loading' ? `Loading stream…${snap.attempts > 1 ? ` (source ${snap.attempt}/${snap.attempts})` : ''}` : 'Buffering…'}</span></span>
          </div>
        )}
        {!playing && snap.state !== 'loading' && snap.state !== 'buffering' && snap.state !== 'error' && panel === 'none' && (
          <button type="button" onClick={() => eng()?.play()} aria-label="Play" className="absolute inset-0 z-10 grid w-full place-items-center bg-black/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyanx">
            <span className="grid h-[68px] w-[68px] place-items-center rounded-full bg-sky-500 text-white shadow-glow transition hover:scale-105 sm:h-[72px] sm:w-[72px]"><Play size={32} className="ml-1" /></span>
          </button>
        )}
        {snap.state === 'error' && snap.error && (
          <div className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-black/92 p-4" role="alert">
            <div className="w-full max-w-lg text-center">
              <img src="/icons/logo-256.png" alt="" width={52} height={52} className="mx-auto mb-3 h-[52px] w-[52px] rounded-2xl opacity-90" />
              <h2 className="text-base font-bold sm:text-lg">Playback failed — {snap.error.category.replace(/-/g, ' ')}</h2>
              {snap.error.codeLabel && <p className="mt-1.5 inline-block rounded-full border border-white/20 bg-white/5 px-2.5 py-0.5 font-mono text-[11px] text-amber-300">{snap.error.codeLabel}</p>}
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{snap.error.message}</p>
              <p className="mx-auto mt-1.5 max-w-md text-sm leading-6 text-silver">{snap.error.action}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button onClick={() => eng()?.retry()}><RotateCcw size={16} aria-hidden />Retry</Button>
                <Button variant="outline" onClick={openInDirect}><ExternalLink size={16} aria-hidden />Play Stream mein kholein</Button>
                {nextCh && <Button variant="ghost" onClick={() => navigate(`/player/${encodeURIComponent(nextCh.id)}`)}>Next channel</Button>}
              </div>
              <p className="mt-3 text-[11px] text-muted">Sirf source ka host Diagnostics mein save hota hai — poora private link kabhi nahi.</p>
            </div>
          </div>
        )}

        {/* Bottom controls */}
        <div className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-2 pb-1.5 pt-12 transition-opacity duration-300 sm:px-3 ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
          {snap.seekable && !snap.live ? (
            <div className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-white/90">{formatTime(snap.currentTime)}</span>
              <input type="range" min={0} max={snap.duration || 0} step={1} value={Math.min(snap.currentTime, snap.duration || 0)} onChange={(e) => eng()?.seek(Number(e.target.value))} className="min-w-0 flex-1 accent-sky-400" aria-label="Seek through video" />
              <span className="w-10 shrink-0 text-[11px] tabular-nums text-white/90">{formatTime(snap.duration)}</span>
            </div>
          ) : snap.live ? <div className="mb-1 h-1 overflow-hidden rounded bg-white/15" aria-hidden><div className="h-full w-full bg-red-500/80" /></div> : null}
          <div className="mt-0.5 flex items-center gap-0.5 sm:gap-1">
            {item.kind === 'live' && <button type="button" disabled={!prevCh} onClick={() => prevCh && navigate(`/player/${encodeURIComponent(prevCh.id)}`)} aria-label={prevCh ? `Previous channel: ${prevCh.title}` : 'No previous channel'} className="grid h-10 w-8 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><ChevronLeft size={20} /></button>}
            {snap.seekable && <button type="button" onClick={() => eng()?.seekBy(-10)} aria-label="Back 10 seconds" className="hidden h-10 shrink-0 items-center rounded-full px-1.5 text-[11px] font-bold text-white hover:bg-white/10 min-[400px]:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">−10s</button>}
            <button type="button" onClick={() => (playing ? eng()?.pause() : eng()?.play())} aria-label={playing ? 'Pause' : 'Play'} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sky-500 text-white shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">{playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}</button>
            {snap.seekable && <button type="button" onClick={() => eng()?.seekBy(10)} aria-label="Forward 10 seconds" className="hidden h-10 shrink-0 items-center rounded-full px-1.5 text-[11px] font-bold text-white hover:bg-white/10 min-[400px]:inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">+10s</button>}
            {item.kind === 'live' && <button type="button" disabled={!nextCh} onClick={() => nextCh && navigate(`/player/${encodeURIComponent(nextCh.id)}`)} aria-label={nextCh ? `Next channel: ${nextCh.title}` : 'No next channel'} className="grid h-10 w-8 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><ChevronRight size={20} /></button>}
            <button type="button" onClick={() => eng()?.toggleMute()} aria-label={snap.muted ? 'Unmute' : 'Mute'} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">{snap.muted || snap.volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
            <input type="range" min={0} max={1} step={0.05} value={snap.muted ? 0 : snap.volume} onChange={(e) => eng()?.setVolume(Number(e.target.value))} className="hidden w-[72px] shrink-0 accent-sky-400 lg:block" aria-label="Volume" />
            <span className="min-w-0 flex-1" />
            <button type="button" onClick={() => togglePanel('quality')} aria-expanded={panel === 'quality'} aria-label="Video quality" className="inline-flex h-10 max-w-[118px] shrink-0 items-center gap-1 truncate rounded-full px-2 text-xs font-bold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Gauge size={16} className="shrink-0" aria-hidden /><span className="truncate">{snap.currentQualityLabel}</span></button>
            <button type="button" onClick={() => togglePanel('audio')} aria-expanded={panel === 'audio'} aria-label="Audio tracks" className="grid h-10 w-9 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><AudioLines size={18} /></button>
            <button type="button" onClick={() => togglePanel('subs')} aria-expanded={panel === 'subs'} aria-label="Subtitles" className="grid h-10 w-9 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Subtitles size={18} /></button>
            <button type="button" onClick={() => togglePanel('more')} aria-expanded={panel === 'more'} aria-label="Speed, sleep timer and view options" className="grid h-10 w-9 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Settings2 size={18} /></button>
            <button type="button" onClick={async () => { try { await videoRef.current?.requestPictureInPicture(); } catch { setNotice('Picture-in-Picture is browser/stream par available nahi.'); } }} aria-label="Picture in picture" className="hidden h-10 w-9 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx min-[480px]:grid"><PictureInPicture2 size={18} /></button>
            <button type="button" onClick={() => void wrapRef.current?.requestFullscreen?.().catch(() => undefined)} aria-label="Fullscreen" className="grid h-10 w-9 shrink-0 place-items-center rounded-full text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Maximize size={18} /></button>
          </div>
        </div>

        {/* Sheet panel — hamesha player ke ANDAR full-width, kinare se kabhi nahi katega */}
        {panel !== 'none' && (
          <div className="absolute inset-x-0 bottom-0 z-20 flex max-h-[74%] flex-col rounded-t-3xl border-t border-white/15 bg-[#070d1df7] shadow-card backdrop-blur" role="dialog" aria-modal="false" aria-label={PANEL_TITLES[panel]}>
            <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
              <h3 className="min-w-0 flex-1 truncate text-sm font-extrabold text-white">{PANEL_TITLES[panel]}{panel === 'quality' && <span className="ml-2 font-mono text-[11px] font-semibold text-cyanx">{snap.currentQualityLabel}{snap.bitrateKbps ? ` · ${snap.bitrateKbps}k` : ''}</span>}{panel === 'audio' && <span className="ml-2 font-mono text-[11px] font-semibold text-cyanx">{snap.audioLabel}</span>}</h3>
              <button type="button" onClick={() => setPanel('none')} aria-label="Close panel" autoFocus className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><X size={18} /></button>
            </div>
            <div className="nice-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{panelBody()}</div>
          </div>
        )}
      </div>

      {/* Status chips — asal engine data */}
      <div className="chips-row -mx-3 mt-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Stream status">
        {[
          ['Format', snap.format.toUpperCase()],
          ['Quality', snap.bitrateKbps ? `${snap.currentQualityLabel} · ${snap.bitrateKbps} kbps` : snap.currentQualityLabel],
          ['Resolution', snap.resolution],
          ['Audio', snap.audioLabel],
          ['Subtitles', snap.subtitleTracks.find((t) => t.id === snap.subtitleId)?.label ?? 'Off'],
          ['Buffer', snap.live ? `${bufferAhead}s` : `${bufferAhead}s`],
          ['Dropped', `${snap.droppedFrames} frames`],
          ['Speed', `${snap.rate}×`],
          ...(sleepMin > 0 ? [['Sleep', `${sleepMin}m`]] : []),
          ['State', snap.attempts > 1 ? `${snap.state} · try ${snap.attempt}/${snap.attempts}` : snap.state],
        ].map(([k, v]) => (
          <span key={k} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1.5 text-[11px]"><span className="font-semibold uppercase tracking-wide text-muted">{k}</span><strong className="max-w-[150px] truncate text-silver">{v}</strong></span>
        ))}
        <span className="hidden items-center gap-2 px-1 text-[11px] text-muted xl:inline-flex">
          <button type="button" onClick={() => {
            const v = videoRef.current; if (!v || !v.videoWidth) { setNotice('Frame abhi available nahi.'); return; }
            try { const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d')?.drawImage(v, 0, 0); const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `siravex-${Date.now()}.png`; a.click(); setNotice('Snapshot saved.'); } catch { setNotice('Snapshot blocked (stream CORS).'); }
          }} className="inline-flex items-center gap-1 font-semibold text-cyanx hover:underline"><Camera size={13} aria-hidden />Snapshot</button>
          <button type="button" onClick={async () => { const text = `Watching “${cleanTitle(item.title)}” on SIRAVEX`; try { if (navigator.share) await navigator.share({ title: 'SIRAVEX', text }); else { await navigator.clipboard.writeText(text); setNotice('Title copied (private links kabhi share nahi hote).'); } } catch { /* cancelled */ } }} className="inline-flex items-center gap-1 font-semibold text-cyanx hover:underline"><Share2 size={13} aria-hidden />Share</button>
          <span className="inline-flex items-center gap-1"><Moon size={13} aria-hidden />Sleep timer More (⚙) mein</span>
        </span>
      </div>
      {notice && <p className="mt-2 text-xs font-medium text-cyanx" role="status">{notice}<button type="button" onClick={() => setNotice('')} className="ml-2 text-muted underline">dismiss</button></p>}
      {(nowNext.current || nowNext.next) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {nowNext.current && <div className="rounded-xl border border-sky-500/40 bg-sky-950/40 p-3 text-sm"><p className="break-anywhere line-clamp-2 font-bold">Now — {cleanTitle(nowNext.current.title)}</p><p className="mt-0.5 text-xs text-muted">{new Date(nowNext.current.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(nowNext.current.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p><span className="mt-2 block h-1.5 overflow-hidden rounded bg-slate-800"><span className="block h-full bg-sky-400" style={{ width: `${Math.min(100, Math.max(0, ((Date.now() - nowNext.current.start) / (nowNext.current.end - nowNext.current.start)) * 100))}%` }} /></span></div>}
          {nowNext.next && <div className="rounded-xl border border-border bg-card p-3 text-sm"><p className="break-anywhere line-clamp-2 font-bold">Next — {cleanTitle(nowNext.next.title)}</p><p className="mt-0.5 text-xs text-muted">{new Date(nowNext.next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(nowNext.next.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div>}
        </div>
      )}
    </section>
  );
}
