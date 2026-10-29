import { useEffect, useRef, useState } from 'react';
import { Maximize, Pause, PictureInPicture2, Play, Settings2, Volume2, VolumeX } from 'lucide-react';
import { PlaybackEngine, type PlayerSnapshot } from '@/playback/engine';
import { Button, formatTime } from '@/components/ui/ui';
import { useStore } from '@/app/store';
import type { MediaItem } from '@/types/models';

const IDLE: PlayerSnapshot = { state: 'idle', currentTime: 0, duration: 0, seekable: false, live: false, muted: false, volume: 1, rate: 1, qualities: [], qualityId: 'auto', audioTracks: [], audioId: '', subtitleTracks: [], subtitleId: 'off', error: null, engine: 'none' };

export function PlayerShell({ item }: { item: MediaItem }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<PlayerSnapshot>(IDLE);
  const [theatre, setTheatre] = useState(false);
  const [panel, setPanel] = useState<'none' | 'tracks'>('none');
  const { settings, saveProgress, logDiagnostic, programmes } = useStore();
  const prog = programmes.filter((p) => item.tvgId && p.channelId === item.tvgId);
  const now = Date.now();
  const current = prog.find((p) => now >= p.start && now < p.end);
  const next = prog.filter((p) => p.start >= now).sort((a, b) => a.start - b.start)[0];

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const engine = new PlaybackEngine(video);
    engineRef.current = engine;
    const unsub = engine.subscribe((s) => {
      setSnap(s);
      if (s.state === 'playing' && s.duration > 0) void saveProgress(item.id, s.currentTime, s.duration);
      if (s.state === 'error' && s.error) void logDiagnostic(s.error.category, s.error.message, item.url);
    });
    video.volume = settings.defaultVolume; video.playbackRate = settings.playbackSpeed;
    void engine.load(item.url);
    if (settings.autoplay) engine.play();
    return () => { unsub(); engine.destroy(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
      const eng = engineRef.current; if (!eng) return;
      if (e.code === 'Space') { e.preventDefault(); snap.state === 'playing' ? eng.pause() : eng.play(); }
      else if (e.key === 'm' || e.key === 'M') eng.toggleMute();
      else if (e.key === 'f' || e.key === 'F') void wrapRef.current?.requestFullscreen?.().catch(() => undefined);
      else if (e.key === 'ArrowRight' && snap.seekable) eng.seek(Math.min(snap.duration, snap.currentTime + 10));
      else if (e.key === 'ArrowLeft' && snap.seekable) eng.seek(Math.max(0, snap.currentTime - 10));
      else if (e.key === 'Escape') setPanel('none');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap.state, snap.seekable, snap.currentTime, snap.duration]);

  const eng = () => engineRef.current;
  const subtitleStyle = { fontSize: settings.subtitleSize === 'small' ? '14px' : settings.subtitleSize === 'large' ? '22px' : '18px', color: settings.subtitleColor } as React.CSSProperties;

  return (
    <section className={theatre ? 'w-full' : ''} aria-label={`Player: ${item.title}`}>
      <div ref={wrapRef} className="relative overflow-hidden rounded-2xl border border-border bg-black shadow-card">
        <video ref={videoRef} className="aspect-video w-full" controls={false} playsInline aria-label={item.title} style={subtitleStyle} crossOrigin="anonymous" />
        {snap.state === 'loading' || snap.state === 'buffering' ? <div className="absolute inset-0 grid place-items-center bg-black/50" role="status"><span className="rounded-full border border-border bg-panel px-4 py-2 text-sm">{snap.state === 'loading' ? 'Loading stream…' : 'Buffering…'}</span></div> : null}
        {snap.state === 'error' && snap.error && (
          <div className="absolute inset-0 grid place-items-center bg-black/85 p-5" role="alert"><div className="max-w-lg text-center"><h2 className="text-lg font-bold">Playback failed — {snap.error.category.replace('-', ' ')}</h2><p className="mt-2 text-sm leading-6 text-muted">{snap.error.message}</p><p className="mt-2 text-sm leading-6 text-silver">{snap.error.action}</p><div className="mt-4 flex justify-center gap-2"><Button onClick={() => eng()?.retry()}>Retry</Button></div><p className="mt-3 text-xs text-muted">Engine: {snap.engine}. Only the source host is recorded in Diagnostics — never full private URLs.</p></div></div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-10">
          {snap.seekable && !snap.live && <label className="block"><span className="sr-only">Seek</span><input type="range" min={0} max={snap.duration || 0} step={1} value={Math.min(snap.currentTime, snap.duration || 0)} onChange={(e) => eng()?.seek(Number(e.target.value))} className="w-full accent-sky-400" aria-label="Seek through video" /></label>}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={() => (snap.state === 'playing' ? eng()?.pause() : eng()?.play())} aria-label={snap.state === 'playing' ? 'Pause' : 'Play'} className="grid h-11 w-11 place-items-center rounded-full bg-sky-500 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">{snap.state === 'playing' ? <Pause size={20} /> : <Play size={20} />}</button>
            <button type="button" onClick={() => eng()?.toggleMute()} aria-label={snap.muted ? 'Unmute' : 'Mute'} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">{snap.muted || snap.volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}</button>
            <label className="hidden items-center gap-2 text-xs sm:flex"><span className="sr-only">Volume</span><input type="range" min={0} max={1} step={0.05} value={snap.muted ? 0 : snap.volume} onChange={(e) => eng()?.setVolume(Number(e.target.value))} className="w-24 accent-sky-400" aria-label="Volume" /></label>
            <span className="text-xs text-white/90" aria-live="off">{snap.live ? <span className="mr-2 rounded bg-red-600 px-2 py-0.5 font-bold">LIVE</span> : null}{formatTime(snap.currentTime)}{snap.duration > 0 ? ` / ${formatTime(snap.duration)}` : ''}</span>
            <span className="ml-auto flex items-center gap-1.5">
              <label className="hidden items-center gap-1 text-xs text-white/80 md:flex">Speed
                <select value={snap.rate} onChange={(e) => eng()?.setRate(Number(e.target.value))} className="min-h-[40px] rounded-lg border border-white/20 bg-black/70 px-2 text-white" aria-label="Playback speed">{[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}</select></label>
              <button type="button" onClick={() => setPanel(panel === 'tracks' ? 'none' : 'tracks')} aria-label="Audio, subtitle and quality settings" aria-expanded={panel === 'tracks'} className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Settings2 size={20} /></button>
              <button type="button" onClick={async () => { try { await videoRef.current?.requestPictureInPicture(); } catch { /* unsupported */ } }} aria-label="Picture in picture" className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><PictureInPicture2 size={20} /></button>
              <button type="button" onClick={() => setTheatre(!theatre)} aria-label="Toggle theatre mode" aria-pressed={theatre} className="hidden h-11 items-center rounded-full bg-white/10 px-3 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx sm:inline-flex">Theatre</button>
              <button type="button" onClick={() => void wrapRef.current?.requestFullscreen?.().catch(() => undefined)} aria-label="Fullscreen" className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Maximize size={20} /></button>
            </span>
          </div>
          {panel === 'tracks' && (
            <div className="mt-3 grid gap-3 rounded-xl border border-white/15 bg-black/85 p-3 text-sm sm:grid-cols-3" role="dialog" aria-label="Track settings">
              <label className="block text-xs text-white/70">Quality (real variants only)
                <select value={snap.qualityId} onChange={(e) => eng()?.setQuality(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/20 bg-panel px-2 text-silver" aria-label="Quality">{snap.qualities.length ? snap.qualities.map((q) => <option key={q.id} value={q.id}>{q.label}</option>) : <option value="auto">Auto (managed by stream)</option>}</select></label>
              <label className="block text-xs text-white/70">Audio track
                <select value={snap.audioId} onChange={(e) => eng()?.setAudio(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/20 bg-panel px-2 text-silver" aria-label="Audio track">{snap.audioTracks.length ? snap.audioTracks.map((t) => <option key={t.id} value={t.id}>{t.label}{t.lang ? ` (${t.lang})` : ''}</option>) : <option value="">Default (only track)</option>}</select></label>
              <label className="block text-xs text-white/70">Subtitles
                <select value={snap.subtitleId} onChange={(e) => eng()?.setSubtitle(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-white/20 bg-panel px-2 text-silver" aria-label="Subtitles">{snap.subtitleTracks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
                <span className="mt-1 block text-[11px] text-white/50">Appearance (size/colour) is set in Settings and applies where the browser renders native tracks.</span></label>
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>Engine: <strong className="text-silver">{snap.engine}</strong></span><span>State: <strong className="text-silver">{snap.state}</strong></span>
        <span>Shortcuts: Space play/pause · ←/→ seek (VOD) · M mute · F fullscreen</span>
      </div>
      {(current || next) && <div className="mt-3 grid gap-2 sm:grid-cols-2">{current && <p className="rounded-xl border border-sky-500/40 bg-sky-950/40 p-3 text-sm"><strong>Now:</strong> {current.title}<br /><span className="text-muted">{new Date(current.start).toLocaleTimeString()} – {new Date(current.end).toLocaleTimeString()}</span></p>}{next && <p className="rounded-xl border border-border bg-card p-3 text-sm"><strong>Next:</strong> {next.title}<br /><span className="text-muted">{new Date(next.start).toLocaleTimeString()} – {new Date(next.end).toLocaleTimeString()}</span></p>}</div>}
    </section>
  );
}
