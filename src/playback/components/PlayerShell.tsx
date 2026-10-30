import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, AudioLines, Camera, Check, ChevronLeft, ChevronRight, Circle,
  ExternalLink, Frame, Gauge, Heart, ListVideo, Maximize, Minimize, Moon, Pause,
  PictureInPicture2, Play, Radio, RotateCcw, Search, Settings2, Share2,
  SlidersHorizontal, Square, Subtitles, Undo2, Upload, Volume2, VolumeX, Wifi, X,
} from 'lucide-react';
import {
  StreamRecorder, RecorderError, REC_QUALITIES, MEMORY_WARN_BYTES,
  formatBytes, formatRecClock, safeFileBase, downloadRecording,
} from '@/lib/recorder';
import { INITIAL_SNAPSHOT, PlaybackEngine, type LoadOptions, type PlayerSnapshot } from '@/playback/engine';
import { humanLanguageName } from '@/playback/tracks';
import { VIDEO_PICTURE_PRESET_LIST, buildVideoFilterCss } from '@/lib/m3u-export';
import { Button, formatTime } from '@/components/ui/ui';
import { useStore } from '@/app/store';
import { cleanGroup, cleanTitle } from '@/lib/display';
import { isSubtitleFile, srtToVtt } from '@/lib/subtitles';
import { trackWatch, trackWatchMinute } from '@/services/firebase/tracking';
import { matchesChannelEpg } from '@/services/epg/xmltv';
import type { MediaItem, VideoPicturePreset } from '@/types/models';

type Panel = 'none' | 'quality' | 'audio' | 'subs' | 'channels' | 'picture' | 'more' | 'rec';
type AspectMode = 'contain' | 'cover' | 'fill' | '4:3';

const PANEL_TITLES: Record<Exclude<Panel, 'none'>, string> = {
  quality: 'Video Resolution & Quality',
  audio: 'Audio Tracks',
  subs: 'Subtitles & Captions',
  channels: 'Quick Channel Switcher',
  picture: 'Video Picture Equalizer',
  more: 'Aspect Ratio, Speed & Sleep Timer',
  rec: 'Stream Recorder',
};

const ASPECT_OPTIONS: { id: AspectMode; label: string; short: string; sub: string }[] = [
  { id: 'contain', label: 'Fit (Original)', short: 'Fit', sub: 'Poora frame nazar ayega, kuch nahi katega' },
  { id: 'cover', label: 'Zoom Fill', short: 'Zoom', sub: 'Screen bhar dega (kinare halkay crop)' },
  { id: 'fill', label: 'Stretch 16:9', short: 'Stretch', sub: 'Poori chaurai aur unchai stretch' },
  { id: '4:3', label: '4:3 Classic TV', short: '4:3', sub: 'Classic broadcast framing' },
];

interface SavePickerWindow {
  showSaveFilePicker: (o: unknown) => Promise<{ createWritable: () => Promise<unknown> }>;
}

export function PlayerShell({ item, loadOpts }: { item: MediaItem; loadOpts?: LoadOptions }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const sleepTimer = useRef<number | null>(null);
  const tapTimer = useRef<number | null>(null);
  const zapTimer = useRef<number | null>(null);
  const lastTapAt = useRef<number>(0);
  const extSubUrl = useRef<string | null>(null);
  const subInputRef = useRef<HTMLInputElement>(null);
  const resumedRef = useRef(false);
  const navigate = useNavigate();

  const [snap, setSnap] = useState<PlayerSnapshot>(INITIAL_SNAPSHOT);
  const [theatre, setTheatre] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const inFullView = isFullscreen || pseudoFullscreen;

  const [panel, setPanel] = useState<Panel>('none');
  const panelRef = useRef<Panel>('none');
  useEffect(() => { panelRef.current = panel; }, [panel]);
  const [aspect, setAspect] = useState<AspectMode>('contain');
  const [seekFlash, setSeekFlash] = useState<'left' | 'right' | null>(null);
  const [zapDigits, setZapDigits] = useState('');
  const zapDigitsRef = useRef('');
  useEffect(() => { zapDigitsRef.current = zapDigits; }, [zapDigits]);
  const [chQuery, setChQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [statsOn, setStatsOn] = useState(false);
  const [sleepMin, setSleepMin] = useState(0);
  const recorderRef = useRef<StreamRecorder | null>(null);
  const recBaseRef = useRef('');
  const [recState, setRecState] = useState<'idle' | 'recording' | 'paused'>('idle');
  const [recBytes, setRecBytes] = useState(0);
  const [recSecs, setRecSecs] = useState(0);
  const [recQuality, setRecQuality] = useState('medium');
  const [recToDisk, setRecToDisk] = useState(false);
  const diskSupported = typeof window !== 'undefined' && typeof (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
  const [controlsVisible, setControlsVisible] = useState(true);

  const {
    settings, updateSettings, saveProgress, recordLiveWatch, previousLiveId,
    logDiagnostic, programmes, items, progress, toggleFavourite, isFavourite,
  } = useStore();
  const fav = isFavourite(item.id);

  const liveSiblings = useMemo(
    () => (item.kind === 'live' ? items.filter((i) => i.playlistId === item.playlistId && i.kind === 'live') : []),
    [items, item.playlistId, item.kind],
  );
  const filteredSiblings = useMemo(() => {
    if (!chQuery.trim()) return liveSiblings.slice(0, 150);
    const q = chQuery.trim().toLowerCase();
    return liveSiblings
      .filter((c) => c.title.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
      .slice(0, 150);
  }, [liveSiblings, chQuery]);
  const sibIdx = liveSiblings.findIndex((i) => i.id === item.id);
  const prevCh = sibIdx > 0 ? liveSiblings[sibIdx - 1] : undefined;
  const nextCh = sibIdx >= 0 && sibIdx < liveSiblings.length - 1 ? liveSiblings[sibIdx + 1] : undefined;
  const recallCh = useMemo(
    () => (item.kind === 'live' && previousLiveId && previousLiveId !== item.id ? items.find((i) => i.id === previousLiveId && i.kind === 'live') : undefined),
    [item.kind, item.id, previousLiveId, items],
  );

  const zapPreviewChannel = useMemo(() => {
    if (!zapDigits || liveSiblings.length === 0) return undefined;
    const n = Number(zapDigits);
    return n >= 1 && n <= liveSiblings.length ? liveSiblings[n - 1] : undefined;
  }, [zapDigits, liveSiblings]);

  const nowNext = useMemo(() => {
    const list = programmes.filter((p) => matchesChannelEpg(p.channelId, item)).sort((a, b) => a.start - b.start);
    if (list.length === 0) return {};
    const now = Date.now();
    return {
      current: list.find((p) => now >= p.start && now < p.end),
      next: list.find((p) => p.start > now),
    };
  }, [programmes, item]);

  const poke = useCallback((isPlaying: boolean) => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    if (isPlaying) {
      hideTimer.current = window.setTimeout(() => {
        if (panelRef.current === 'none') setControlsVisible(false);
      }, 3800);
    }
  }, []);

  useEffect(() => {
    if (panel !== 'none') {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
      setControlsVisible(true);
    }
  }, [panel]);

  // Lock body scroll whenever pseudoFullscreen or mobile bottom-sheet is open
  useEffect(() => {
    if (pseudoFullscreen) {
      document.body.classList.add('svx-lock-scroll');
      return () => document.body.classList.remove('svx-lock-scroll');
    }
    return undefined;
  }, [pseudoFullscreen]);

  /**
   * Universal Full View:
   * 1) Uses native element Fullscreen API (`wrap.requestFullscreen`) + landscape lock where supported.
   * 2) On iOS Safari / WebViews where element Fullscreen is unavailable, activates Immersive
   *    Full-Viewport Mode (`fixed inset-0 z-[90] h-[100dvh] w-[100dvw]`) so 100% of SIRAVEX Pro
   *    buttons (Quality, Audio, Channels, Picture EQ, Aspect, Recorder) stay visible & usable!
   */
  const toggleFullscreen = useCallback(async () => {
    const wrap = wrapRef.current;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setPseudoFullscreen(false);
        return;
      }
      if (pseudoFullscreen) {
        setPseudoFullscreen(false);
        const orient = (screen as unknown as { orientation?: { unlock?: () => void } }).orientation;
        try { orient?.unlock?.(); } catch { /* ignore */ }
        return;
      }
      if (wrap && typeof wrap.requestFullscreen === 'function') {
        await wrap.requestFullscreen();
        const orient = (screen as unknown as { orientation?: { lock?: (m: string) => Promise<void> } }).orientation;
        if (orient?.lock && window.innerWidth < 1024) {
          orient.lock('landscape').catch(() => undefined);
        }
        return;
      }
      // Fallback for iPhone Safari / mobile WebViews: keep custom SIRAVEX UI in 100dvh Full View!
      setPseudoFullscreen(true);
    } catch {
      setPseudoFullscreen((v) => !v);
    }
  }, [pseudoFullscreen]);

  useEffect(() => {
    const onFs = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (!fs) {
        const orient = (screen as unknown as { orientation?: { unlock?: () => void } }).orientation;
        try { orient?.unlock?.(); } catch { /* ignore */ }
      }
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    resumedRef.current = false;
    setRecState('idle'); setRecBytes(0); setRecSecs(0);
    setPanel('none');
    setZapDigits('');
    const engine = new PlaybackEngine(video);
    engineRef.current = engine;
    const unsub = engine.subscribe((s) => {
      setSnap(s);
      if ((s.state === 'playing' || s.state === 'paused') && s.duration > 0) {
        saveProgress(item.id, s.currentTime, s.duration);
      }
      if (s.state === 'error' && s.error) {
        void logDiagnostic(s.error.category, `${s.error.message}${s.error.codeLabel ? ` [${s.error.codeLabel}]` : ''}`, item.url);
      }
      if ((s.state === 'playing' || s.state === 'paused') && !resumedRef.current) {
        resumedRef.current = true;
        const saved = progress.find((p) => p.itemId === item.id);
        if (
          item.kind !== 'live' &&
          settings.resumePlayback &&
          saved &&
          saved.position > 10 &&
          saved.duration > 0 &&
          saved.position / saved.duration < 0.95 &&
          Math.abs(video.currentTime - saved.position) > 3
        ) {
          try { video.currentTime = saved.position; } catch { /* not seekable yet */ }
        }
      }
    });
    video.volume = settings.defaultVolume;
    video.playbackRate = settings.playbackSpeed;

    const mergedOpts: LoadOptions = {
      forcedFormat: loadOpts?.forcedFormat ?? item.forcedFormat,
      clearKeys: loadOpts?.clearKeys ?? item.drmClearKeys,
      licenseUrl: loadOpts?.licenseUrl ?? item.drmLicenseUrl,
      referrer: loadOpts?.referrer ?? item.referrer,
      autoplay: loadOpts?.autoplay ?? settings.autoplay,
      isLiveHint: item.kind === 'live',
      preferredAudioLang: loadOpts?.preferredAudioLang ?? (settings.audioLanguage || undefined),
      preferredSubtitleLang: loadOpts?.preferredSubtitleLang ?? (settings.subtitleLanguage || undefined),
    };

    void engine.load(item.url, mergedOpts);
    poke(false);
    return () => {
      unsub();
      engine.destroy();
      engineRef.current = null;
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (tapTimer.current) window.clearTimeout(tapTimer.current);
      if (zapTimer.current) window.clearTimeout(zapTimer.current);
      if (extSubUrl.current) { URL.revokeObjectURL(extSubUrl.current); extSubUrl.current = null; }
      const rec = recorderRef.current;
      if (rec && rec.state !== 'idle') {
        void rec.stop().then((r) => {
          if (r.blob) downloadRecording(r.blob, recBaseRef.current || 'siravex-recording', r.ext);
        }).catch(() => undefined);
      }
      video.querySelectorAll('track[data-siravex-ext]').forEach((t) => t.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.url]);

  useEffect(() => { if (panel === 'none') poke(snap.state === 'playing'); }, [snap.state, poke, panel]);

  const noticeShown = useRef('');
  useEffect(() => {
    if (snap.notice && snap.notice !== noticeShown.current) {
      noticeShown.current = snap.notice;
      setNotice(snap.notice);
    }
  }, [snap.notice]);

  const watchTracked = useRef(false);
  useEffect(() => { watchTracked.current = false; }, [item.id]);
  useEffect(() => {
    if (snap.state !== 'playing') return;
    if (!watchTracked.current) {
      watchTracked.current = true;
      void trackWatch(item);
      if (item.kind === 'live' && item.playlistId !== 'direct') {
        recordLiveWatch(item.id);
      }
    }
    const iv = window.setInterval(() => void trackWatchMinute(item), 60000);
    return () => window.clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.state === 'playing', item.id]);

  useEffect(() => {
    if (sleepTimer.current) window.clearTimeout(sleepTimer.current);
    sleepTimer.current = null;
    if (sleepMin > 0) {
      sleepTimer.current = window.setTimeout(() => {
        engineRef.current?.pause();
        setSleepMin(0);
        setNotice('Sleep timer — playback paused.');
        setControlsVisible(true);
      }, sleepMin * 60000);
    }
    return () => { if (sleepTimer.current) window.clearTimeout(sleepTimer.current); };
  }, [sleepMin]);

  const cycleAspect = useCallback(() => {
    setAspect((cur) => {
      const idx = ASPECT_OPTIONS.findIndex((a) => a.id === cur);
      const next = ASPECT_OPTIONS[(idx + 1) % ASPECT_OPTIONS.length];
      setNotice(`Aspect ratio: ${next.label}`);
      return next.id;
    });
  }, []);

  const commitZap = useCallback((digits: string) => {
    if (zapTimer.current) { window.clearTimeout(zapTimer.current); zapTimer.current = null; }
    setZapDigits('');
    const num = Number(digits);
    if (num >= 1 && num <= liveSiblings.length) {
      const target = liveSiblings[num - 1];
      if (target && target.id !== item.id) {
        navigate(`/player/${encodeURIComponent(target.id)}`);
      }
    } else if (num > 0) {
      setNotice(`Channel #${num} is playlist mein maujood nahi (1–${liveSiblings.length}).`);
    }
  }, [liveSiblings, item.id, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
      const eng = engineRef.current;
      if (!eng) return;

      if (item.kind === 'live' && liveSiblings.length > 1 && /^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const nextDigits = (zapDigitsRef.current + e.key).slice(0, 4);
        setZapDigits(nextDigits);
        if (zapTimer.current) window.clearTimeout(zapTimer.current);
        zapTimer.current = window.setTimeout(() => commitZap(nextDigits), 1100);
        return;
      }
      if (e.key === 'Enter' && zapDigitsRef.current) {
        e.preventDefault();
        commitZap(zapDigitsRef.current);
        return;
      }

      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        snap.state === 'playing' ? eng.pause() : eng.play();
      } else if (e.key === 'm' || e.key === 'M') eng.toggleMute();
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); void toggleFullscreen(); }
      else if (e.key === 'a' || e.key === 'A') cycleAspect();
      else if ((e.key === 'l' || e.key === 'L') && recallCh) navigate(`/player/${encodeURIComponent(recallCh.id)}`);
      else if ((e.key === 'c' || e.key === 'C') && liveSiblings.length > 1) setPanel((p) => (p === 'channels' ? 'none' : 'channels'));
      else if (e.key === 'PageUp' && nextCh) navigate(`/player/${encodeURIComponent(nextCh.id)}`);
      else if (e.key === 'PageDown' && prevCh) navigate(`/player/${encodeURIComponent(prevCh.id)}`);
      else if (e.key === 'ArrowRight') eng.seekBy(10);
      else if (e.key === 'ArrowLeft') eng.seekBy(-10);
      else if (e.key === 'ArrowUp') { e.preventDefault(); eng.setVolume(Math.min(1, snap.volume + 0.1)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); eng.setVolume(Math.max(0, snap.volume - 0.1)); }
      else if (e.key === 'Escape') {
        setZapDigits('');
        if (panel !== 'none') setPanel('none');
        else if (pseudoFullscreen) setPseudoFullscreen(false);
      }
      poke(snap.state === 'playing');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap.state, snap.volume, poke, toggleFullscreen, cycleAspect, liveSiblings.length, nextCh, prevCh, recallCh, item.kind, commitZap, navigate, panel, pseudoFullscreen]);

  const flashSeek = (side: 'left' | 'right') => {
    setSeekFlash(side);
    window.setTimeout(() => setSeekFlash(null), 550);
  };

  const onVideoSurfaceClick = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (panel !== 'none') { setPanel('none'); return; }
    const isCoarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches;
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / Math.max(1, rect.width);

    if (now - lastTapAt.current < 280) {
      if (tapTimer.current) { window.clearTimeout(tapTimer.current); tapTimer.current = null; }
      lastTapAt.current = 0;
      if (snap.seekable && relX < 0.35) { engineRef.current?.seekBy(-10); flashSeek('left'); }
      else if (snap.seekable && relX > 0.65) { engineRef.current?.seekBy(10); flashSeek('right'); }
      else void toggleFullscreen();
      return;
    }

    lastTapAt.current = now;
    if (tapTimer.current) window.clearTimeout(tapTimer.current);
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      if (isCoarse) {
        if (!controlsVisible) poke(snap.state === 'playing');
        else if (snap.state === 'playing') setControlsVisible(false);
        else engineRef.current?.play();
      } else {
        snap.state === 'playing' ? engineRef.current?.pause() : engineRef.current?.play();
      }
    }, 220);
  };

  const startRecording = async () => {
    const video = videoRef.current;
    if (!video) return;
    const q = REC_QUALITIES.find((x) => x.id === recQuality) ?? REC_QUALITIES[1];
    type Sink = { write: (d: Blob) => Promise<void>; close: () => Promise<void>; abort?: (r?: unknown) => Promise<void> };
    let sink: Sink | null = null;
    recBaseRef.current = safeFileBase(cleanTitle(item.title));
    if (recToDisk && diskSupported) {
      try {
        const picker = (window as unknown as SavePickerWindow).showSaveFilePicker;
        const handle = await picker({
          suggestedName: `${recBaseRef.current}.webm`,
          types: [{ description: 'SIRAVEX recording', accept: { 'video/webm': ['.webm'], 'video/mp4': ['.mp4'] } }],
        });
        sink = (await handle.createWritable()) as Sink;
      } catch {
        setNotice('File select cancel ho gayi — recording start nahi hui.');
        return;
      }
    }
    const rec = recorderRef.current ?? new StreamRecorder();
    recorderRef.current = rec;
    try {
      const { mime } = await rec.start(video, {
        videoBitsPerSecond: q.videoBitsPerSecond,
        sink,
        onProgress: (b, s) => { setRecBytes(b); setRecSecs(s); },
      });
      setRecState('recording');
      setPanel('none');
      setNotice(`Recording start — ${mime.includes('mp4') ? 'MP4' : 'WebM'} · ${q.label}.`);
    } catch (e) {
      if (sink?.abort) { try { await sink.abort(); } catch { /* ignore */ } }
      setRecState('idle');
      setNotice(e instanceof RecorderError ? e.message : 'Recording start nahi ho saki.');
    }
  };

  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'idle') return;
    try {
      const r = await rec.stop();
      setRecState('idle'); setRecBytes(0); setRecSecs(0);
      if (r.streamedToDisk) setNotice(`Recording disk par save ho gayi — ${formatRecClock(r.seconds)} · ${formatBytes(r.bytes)}.`);
      else if (r.blob) {
        downloadRecording(r.blob, recBaseRef.current || safeFileBase('siravex'), r.ext);
        setNotice(`Recording save ho gayi — ${formatRecClock(r.seconds)} · ${formatBytes(r.bytes)} (${r.ext.toUpperCase()}).`);
      }
    } catch {
      setRecState('idle');
      setNotice('Recording save karne me masla aya — dobara try karein.');
    }
  }, []);

  useEffect(() => { if (snap.state === 'ended' && recState !== 'idle') void stopRecording(); }, [snap.state, recState, stopRecording]);

  const eng = () => engineRef.current;
  const playing = snap.state === 'playing';
  const showUi = controlsVisible || !playing || panel !== 'none';
  const filterCss = buildVideoFilterCss(settings);
  const currentAspectMeta = ASPECT_OPTIONS.find((a) => a.id === aspect) ?? ASPECT_OPTIONS[0];
  const videoStyle: React.CSSProperties = {
    fontSize: settings.subtitleSize === 'small' ? '14px' : settings.subtitleSize === 'large' ? '22px' : '18px',
    color: settings.subtitleColor,
    objectFit: aspect === '4:3' ? 'contain' : aspect,
    maxWidth: aspect === '4:3' ? '75%' : '100%',
    margin: aspect === '4:3' ? '0 auto' : undefined,
    filter: filterCss || undefined,
  };
  const bufferAhead = Math.max(0, Math.round(snap.bufferedEnd - snap.currentTime));
  const dropPct = snap.totalFrames > 0 ? ((snap.droppedFrames / snap.totalFrames) * 100).toFixed(1) : '0.0';
  const togglePanel = (p: Panel) => setPanel((cur) => (cur === p ? 'none' : p));

  const applyPreset = (id: VideoPicturePreset) => {
    const found = VIDEO_PICTURE_PRESET_LIST.find((x) => x.id === id) ?? VIDEO_PICTURE_PRESET_LIST[0];
    updateSettings({
      videoPreset: found.id,
      videoBrightness: found.brightness,
      videoContrast: found.contrast,
      videoSaturation: found.saturation,
    });
  };

  const onExternalSubtitle = async (file: File) => {
    const video = videoRef.current;
    const engine = engineRef.current;
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
        for (let i = 0; i < video.textTracks.length; i++) {
          if (video.textTracks[i].label === file.name) { engine.showExternalSubtitle(i); done = true; break; }
        }
        setNotice(done ? `Subtitle loaded: ${file.name}` : 'Subtitle file add ho gayi magar browser ne track register nahi kiya.');
      }, 80);
      setPanel('none');
    } catch { setNotice('Subtitle file parhi nahi ja saki.'); }
  };

  const openInDirect = () => {
    try { sessionStorage.setItem('siravex-direct-prefill', item.url); } catch { /* ignore */ }
    navigate('/direct');
  };

  const requestPip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoRef.current?.requestPictureInPicture();
    } catch {
      setNotice('Picture-in-Picture is browser/stream par available nahi.');
    }
  };

  const optionRow = (o: { id: string; label: string; sub?: string }, active: string, onPick: (id: string) => void) => (
    <button
      key={o.id}
      type="button"
      role="option"
      aria-selected={active === o.id}
      onClick={() => { onPick(o.id); setPanel('none'); }}
      className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${active === o.id ? 'bg-sky-500 text-white' : 'text-white/90 hover:bg-white/10'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{o.label}</span>
        {o.sub && <span className={`block truncate text-[11px] ${active === o.id ? 'text-white/80' : 'text-white/55'}`}>{o.sub}</span>}
      </span>
      {active === o.id && <Check size={17} className="shrink-0" aria-hidden />}
    </button>
  );

  const panelBody = () => {
    if (panel === 'quality') {
      const levels = snap.qualities.filter((q) => q.id !== 'auto');
      const single = levels.length === 0;
      const autoSubParts = [
        'Adaptive (recommended)',
        snap.resolution !== '—' ? `current ${snap.resolution}` : '',
        snap.bitrateKbps ? `${snap.bitrateKbps} kbps` : '',
      ].filter(Boolean);
      return (
        <div className="grid gap-1" role="listbox" aria-label="Video quality">
          {optionRow(
            { id: 'auto', label: 'Auto (Adaptive)', sub: autoSubParts.join(' · ') },
            snap.qualityId,
            (id) => eng()?.setQuality(id),
          )}
          {levels.map((q) => optionRow(q, snap.qualityId, (id) => eng()?.setQuality(id)))}
          {single && (
            <p className="px-3 py-2 text-xs leading-5 text-white/60">
              Ye stream single-rendition bhejta hai{snap.resolution !== '—' ? ` (${snap.resolution})` : ''} — jab provider multiple resolutions (1080p/720p/480p/360p) encode karta hai to woh sab yahan list hote hain.
            </p>
          )}
        </div>
      );
    }

    if (panel === 'audio') {
      if (snap.audioTracks.length === 0) {
        return (
          <p className="px-3 py-2 text-sm leading-6 text-white/75">
            Is stream mein single embedded audio track hai ({snap.audioLabel}) — multi-language audio tracks jab stream manifest mein maujood hon to sab yahan foran switch ke liye list hote hain.
          </p>
        );
      }
      return (
        <div className="grid gap-1" role="listbox" aria-label="Audio tracks">
          {snap.audioTracks.map((t) =>
            optionRow(
              {
                id: t.id,
                label: t.label,
                sub: t.sub ?? (t.lang ? humanLanguageName(t.lang) : undefined),
              },
              snap.audioId,
              (id) => eng()?.setAudio(id),
            ),
          )}
        </div>
      );
    }

    if (panel === 'subs') {
      return (
        <div>
          <div className="grid gap-1" role="listbox" aria-label="Subtitles">
            {snap.subtitleTracks.map((t) =>
              optionRow(
                { id: t.id, label: t.label, sub: t.sub ?? (t.lang ? humanLanguageName(t.lang) : undefined) },
                snap.subtitleId,
                (id) => eng()?.setSubtitle(id),
              ),
            )}
          </div>
          <input
            ref={subInputRef}
            type="file"
            accept=".srt,.vtt"
            className="sr-only"
            aria-label="Load subtitle file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onExternalSubtitle(f); }}
          />
          <button
            type="button"
            onClick={() => subInputRef.current?.click()}
            className="mt-2 flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-dashed border-white/25 px-3 text-sm font-semibold text-white/90 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"
          >
            <Upload size={17} aria-hidden />Apni subtitle file load karein (.srt / .vtt)
          </button>
        </div>
      );
    }

    if (panel === 'picture') {
      return (
        <div className="px-2">
          <p className="pb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/50">Picture Mode Presets</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {VIDEO_PICTURE_PRESET_LIST.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  settings.videoPreset === p.id
                    ? 'border-sky-400 bg-sky-500/25 text-white'
                    : 'border-white/10 bg-white/5 text-white/85 hover:bg-white/10'
                }`}
              >
                <span className="block text-xs font-extrabold">{p.label}</span>
                <span className="block truncate text-[10px] text-white/60">{p.sub}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-3">
            {([
              ['Brightness', 'videoBrightness', settings.videoBrightness],
              ['Contrast', 'videoContrast', settings.videoContrast],
              ['Saturation', 'videoSaturation', settings.videoSaturation],
            ] as const).map(([label, key, val]) => (
              <label key={key} className="grid gap-1 text-xs text-white/85">
                <span className="flex justify-between font-semibold">
                  <span>{label}</span>
                  <span className="font-mono text-cyanx">{val}%</span>
                </span>
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={2}
                  value={val}
                  onChange={(e) => updateSettings({ videoPreset: 'custom', [key]: Number(e.target.value) })}
                  className="accent-sky-400"
                />
              </label>
            ))}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => applyPreset('standard')}
                className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-white/80 hover:bg-white/20"
              >
                Reset to 100%
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (panel === 'channels') {
      return (
        <div>
          <div className="relative mb-2 px-1">
            <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/45" aria-hidden />
            <input
              value={chQuery}
              onChange={(e) => setChQuery(e.target.value)}
              placeholder={`Search ${liveSiblings.length} channels…`}
              aria-label="Search channels in player"
              className="min-h-[42px] w-full rounded-xl border border-white/15 bg-white/5 pl-9 pr-3 text-sm text-white placeholder:text-white/45 focus:border-sky-400 focus:outline-none"
            />
          </div>
          <div className="grid gap-1" role="listbox" aria-label="Live channels">
            {filteredSiblings.map((ch) => {
              const num = liveSiblings.findIndex((x) => x.id === ch.id) + 1;
              return optionRow(
                { id: ch.id, label: `${num > 0 ? `#${num} · ` : ''}${cleanTitle(ch.title)}`, sub: cleanGroup(ch.group) },
                item.id,
                (id) => navigate(`/player/${encodeURIComponent(id)}`),
              );
            })}
            {filteredSiblings.length === 0 && (
              <p className="px-3 py-3 text-xs text-white/60">Koi channel match nahi hua.</p>
            )}
          </div>
        </div>
      );
    }

    if (panel === 'rec') {
      const active = recState !== 'idle';
      return (
        <div>
          <p className="px-3 pb-2 text-xs leading-5 text-white/65">
            Jo video abhi chal raha hai, usi ko record karke file save hoti hai (MP4 ya WebM). <strong className="text-white/90">Sirf wahi content record karein jis ke rights aap ke paas hon.</strong>
          </p>
          {!active && (
            <>
              <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/50">Recording quality</p>
              <div className="grid gap-1" role="listbox" aria-label="Recording quality">
                {REC_QUALITIES.map((q) => optionRow({ id: q.id, label: q.label, sub: q.sub }, recQuality, setRecQuality))}
              </div>
              {diskSupported && (
                <button
                  type="button"
                  onClick={() => setRecToDisk(!recToDisk)}
                  aria-pressed={recToDisk}
                  className={`mt-2 flex min-h-[48px] w-full items-center justify-between rounded-xl px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${recToDisk ? 'bg-sky-500 text-white' : 'text-white/90 hover:bg-white/10'}`}
                >
                  Direct disk par save (lambi recording ke liye) {recToDisk && <Check size={17} aria-hidden />}
                </button>
              )}
              <button
                type="button"
                onClick={() => void startRecording()}
                className="mt-3 flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-extrabold text-white shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"
              >
                <Circle size={15} className="fill-white" aria-hidden />Start Recording
              </button>
            </>
          )}
          {active && (
            <>
              <div className="mx-1 rounded-xl border border-red-500/40 bg-red-950/40 p-3 font-mono text-xs leading-6 text-red-100" role="status">
                <p className="flex justify-between"><span>{recState === 'paused' ? 'PAUSED' : '● RECORDING'}</span><span>{formatRecClock(recSecs)}</span></p>
                <p className="flex justify-between"><span>Size</span><span>{formatBytes(recBytes)}{recToDisk ? ' · disk' : ''}</span></p>
              </div>
              {!recToDisk && recBytes > MEMORY_WARN_BYTES && (
                <p className="px-3 pt-2 text-xs leading-5 text-amber-300">
                  Recording bohat bari ho gayi hai ({formatBytes(recBytes)}) — Stop &amp; Save kar lein.
                </p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                {recState === 'recording' ? (
                  <button type="button" onClick={() => { recorderRef.current?.pause(); setRecState('paused'); }} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/25 text-sm font-bold text-white"><Pause size={16} aria-hidden />Pause</button>
                ) : (
                  <button type="button" onClick={() => { recorderRef.current?.resume(); setRecState('recording'); }} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-white/25 text-sm font-bold text-white"><Play size={16} aria-hidden />Resume</button>
                )}
                <button type="button" onClick={() => void stopRecording()} className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-red-600 text-sm font-extrabold text-white"><Square size={14} className="fill-white" aria-hidden />Stop &amp; Save</button>
              </div>
            </>
          )}
        </div>
      );
    }

    return (
      <div>
        <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-white/50">Aspect Ratio &amp; Framing (key: A)</p>
        <div className="grid gap-1" role="listbox" aria-label="Aspect ratio">
          {ASPECT_OPTIONS.map((a) => optionRow(a, aspect, (id) => setAspect(id as AspectMode)))}
        </div>
        <p className="px-2 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-white/50">Playback speed</p>
        <div className="grid gap-1" role="listbox" aria-label="Playback speed">
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) =>
            optionRow({ id: String(r), label: `${r}×${r === 1 ? ' · Normal' : ''}` }, String(snap.rate), (id) => eng()?.setRate(Number(id))),
          )}
        </div>
        <p className="px-2 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-white/50">Sleep timer</p>
        <div className="grid gap-1" role="listbox" aria-label="Sleep timer">
          {[0, 15, 30, 45, 60, 90].map((m) =>
            optionRow(
              { id: String(m), label: m === 0 ? 'Off' : `${m} minutes`, sub: m > 0 && sleepMin === m ? 'Chal raha hai — waqt pura hone par pause' : undefined },
              String(sleepMin),
              (id) => setSleepMin(Number(id)),
            ),
          )}
        </div>
        <button
          type="button"
          onClick={() => setTheatre(!theatre)}
          aria-pressed={theatre}
          className={`mt-3 flex min-h-[48px] w-full items-center justify-between rounded-xl px-3 text-sm font-semibold ${theatre ? 'bg-sky-500 text-white' : 'text-white/90 hover:bg-white/10'}`}
        >
          Theatre mode {theatre && <Check size={17} aria-hidden />}
        </button>
      </div>
    );
  };

  /** Sheet drawer rendered inside Full View OR as a spacious fixed mobile bottom sheet when inline */
  const renderSheetModal = (insideFull: boolean) => {
    if (panel === 'none') return null;
    if (insideFull && !inFullView) return null;
    if (!insideFull && inFullView) return null;

    return (
      <div
        className={
          insideFull
            ? 'absolute inset-0 z-30 flex flex-col justify-end bg-black/65 backdrop-blur-[2px]'
            : 'fixed inset-0 z-[95] flex flex-col justify-end bg-black/70 backdrop-blur-[2px]'
        }
        role="dialog"
        aria-modal="true"
        aria-label={PANEL_TITLES[panel]}
        onClick={() => setPanel('none')}
      >
        <div
          className="mx-auto flex max-h-[82dvh] w-full max-w-xl flex-col rounded-t-3xl border-t border-white/15 bg-[#070d1df7] shadow-card"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
            <h3 className="min-w-0 flex-1 truncate text-sm font-extrabold text-white">
              {PANEL_TITLES[panel]}
              {panel === 'quality' && <span className="ml-2 font-mono text-[11px] font-semibold text-cyanx">{snap.currentQualityLabel}{snap.bitrateKbps ? ` · ${snap.bitrateKbps}k` : ''}</span>}
              {panel === 'audio' && <span className="ml-2 font-mono text-[11px] font-semibold text-cyanx">{snap.audioLabel}</span>}
            </h3>
            <button
              type="button"
              onClick={() => setPanel('none')}
              aria-label="Close panel"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <X size={18} />
            </button>
          </div>
          <div className="nice-scroll min-h-0 flex-1 overflow-y-auto p-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {panelBody()}
          </div>
        </div>
      </div>
    );
  };

  return (
    <section aria-label={`Player: ${item.title}`} className={theatre ? 'mx-auto w-full max-w-none' : 'w-full min-w-0'}>
      <div
        ref={wrapRef}
        className={`group/player relative w-full min-w-0 select-none overflow-hidden bg-black shadow-card ${
          inFullView
            ? 'fixed inset-0 z-[90] flex h-[100dvh] w-[100dvw] flex-col justify-center rounded-none border-0'
            : 'rounded-2xl border border-border'
        }`}
        onMouseMove={() => poke(playing)}
      >
        <video
          ref={videoRef}
          className={`${inFullView ? 'h-full max-h-[100dvh] w-full' : 'aspect-video w-full'} bg-black`}
          playsInline
          aria-label={item.title}
          style={videoStyle}
          onClick={onVideoSurfaceClick}
        />

        {/* TV Set-Top Box Numeric Channel Zapper OSD */}
        {zapDigits && (
          <div className="pointer-events-none absolute right-4 top-16 z-30 rounded-2xl border border-cyan-400/50 bg-black/90 px-4 py-2.5 text-right shadow-glow backdrop-blur" role="status">
            <p className="font-mono text-2xl font-extrabold tracking-widest text-cyanx">CH {zapDigits}</p>
            <p className="max-w-[220px] truncate text-xs font-semibold text-white/85">
              {zapPreviewChannel ? cleanTitle(zapPreviewChannel.title) : `1–${liveSiblings.length} available`}
            </p>
          </div>
        )}

        {/* Seek feedback ripples */}
        {seekFlash === 'left' && (
          <div className="pointer-events-none absolute left-6 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/75 px-4 py-2 text-xs font-extrabold text-white backdrop-blur">
            ⏪ −10s
          </div>
        )}
        {seekFlash === 'right' && (
          <div className="pointer-events-none absolute right-6 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/75 px-4 py-2 text-xs font-extrabold text-white backdrop-blur">
            +10s ⏩
          </div>
        )}

        {/* Top bar — sleek on mobile inline, full info in Full View */}
        <div
          className={`absolute inset-x-0 top-0 z-10 flex items-center gap-1.5 bg-gradient-to-b from-black/85 via-black/45 to-transparent transition-opacity duration-200 ${
            inFullView ? 'svx-safe-top svx-safe-x pb-8' : 'px-2.5 pb-6 pt-2 sm:px-3.5 sm:pt-3'
          } ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          <button
            type="button"
            onClick={() => (inFullView ? void toggleFullscreen() : navigate(-1))}
            aria-label={inFullView ? 'Exit full view' : 'Go back'}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/55 text-white hover:bg-black/80 sm:h-10 sm:w-10"
          >
            <ChevronLeft size={20} />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-white sm:text-base" title={item.title}>
              {sibIdx >= 0 ? <span className="mr-1 font-mono text-[11px] text-cyanx">#{sibIdx + 1}</span> : null}
              {cleanTitle(item.title)}
            </p>
            <p className="hidden truncate text-[11px] text-white/75 min-[420px]:block sm:text-xs">
              {nowNext.current ? `Now: ${cleanTitle(nowNext.current.title)}` : cleanTitle(item.group)}
            </p>
          </div>

          {recallCh && inFullView && (
            <button
              type="button"
              onClick={() => navigate(`/player/${encodeURIComponent(recallCh.id)}`)}
              title={`Last Channel Recall: ${cleanTitle(recallCh.title)}`}
              className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-black/60 px-2.5 text-xs font-bold text-cyanx hover:bg-black/80"
            >
              <Undo2 size={14} aria-hidden />
              <span>Recall</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void eng()?.reconnectNow()}
            aria-label="Reconnect stream"
            title="Reconnect / Reload Stream"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/55 text-white hover:bg-black/80 sm:h-10 sm:w-10"
          >
            <RotateCcw size={16} />
          </button>

          <button
            type="button"
            onClick={() => void toggleFavourite(item.id)}
            aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
            aria-pressed={fav}
            className="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-black/55 text-white hover:bg-black/80 min-[390px]:grid sm:h-10 sm:w-10"
          >
            <Heart size={17} className={fav ? 'fill-red-400 text-red-400' : ''} />
          </button>

          {inFullView && (
            <button
              type="button"
              onClick={() => setStatsOn(!statsOn)}
              aria-label="Toggle stream statistics"
              aria-pressed={statsOn}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-white ${statsOn ? 'bg-sky-500' : 'bg-black/55 hover:bg-black/80'}`}
            >
              <Activity size={16} />
            </button>
          )}

          {snap.live && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-[10px] font-extrabold text-white sm:text-[11px]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />LIVE
            </span>
          )}
        </div>

        {/* One-tap Unmute pill when browser forced muted autoplay */}
        {snap.autoplayMuted && snap.muted && snap.state !== 'error' && (
          <button
            type="button"
            onClick={() => eng()?.unmuteAutoplay(settings.defaultVolume)}
            className="absolute left-3 top-14 z-20 inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-sky-500 px-3.5 py-1.5 text-xs font-extrabold text-white shadow-glow transition hover:scale-105"
          >
            <VolumeX size={15} aria-hidden />Tap for Sound
          </button>
        )}

        {/* Live Auto-Reconnect Pill */}
        {snap.reconnecting && (
          <div className="absolute right-3 top-14 z-20 inline-flex items-center gap-2 rounded-full border border-sky-400/50 bg-black/85 px-3 py-1 text-xs font-semibold text-sky-200 backdrop-blur" role="status">
            <Wifi size={13} className="animate-pulse text-sky-400" aria-hidden />
            <span>Reconnecting ({snap.reconnectAttempt}/{snap.maxReconnects})…</span>
            <button type="button" onClick={() => void eng()?.reconnectNow()} className="rounded-full bg-sky-500 px-2 py-0.5 text-[11px] font-bold text-white">Now</button>
          </div>
        )}

        {recState !== 'idle' && (
          <button type="button" onClick={() => void stopRecording()} aria-label="Stop recording and save" className="absolute left-3 top-24 z-20 inline-flex items-center gap-1.5 rounded-full border border-red-400/50 bg-black/85 px-2.5 py-1 font-mono text-[11px] font-bold text-red-200 backdrop-blur">
            <span className={`h-2 w-2 rounded-full bg-red-500 ${recState === 'recording' ? 'animate-pulse' : ''}`} />
            {recState === 'paused' ? 'PAUSED' : 'REC'} {formatRecClock(recSecs)}
          </button>
        )}

        {/* Stats overlay */}
        {statsOn && (
          <div className="pointer-events-none absolute left-3 top-14 z-20 w-[225px] rounded-xl border border-white/15 bg-black/85 p-2.5 font-mono text-[10px] leading-4 text-emerald-200 backdrop-blur sm:text-[11px] sm:leading-5" aria-label="Stream statistics">
            {[
              ['Engine', snap.engine],
              ['Format', snap.format.toUpperCase()],
              ['Resolution', snap.resolution],
              ['Bitrate', snap.bitrateKbps ? `${snap.bitrateKbps} kbps` : '—'],
              ['Quality', snap.currentQualityLabel],
              ['Audio', snap.audioLabel],
              ['Buffer', `${bufferAhead}s`],
              ['Dropped', `${snap.droppedFrames} (${dropPct}%)`],
            ].map(([k, v]) => (
              <p key={k} className="flex justify-between gap-2"><span className="text-white/50">{k}</span><span className="truncate">{v}</span></p>
            ))}
          </div>
        )}

        {/* Go Live button for DVR live */}
        {snap.live && snap.seekable && snap.behindLiveSec > 15 && snap.state !== 'error' && (
          <button
            type="button"
            onClick={() => eng()?.goLive()}
            className={`absolute right-3 z-20 inline-flex min-h-[34px] items-center gap-1.5 rounded-full bg-red-600 px-3 text-[11px] font-extrabold text-white shadow-glow ${inFullView ? 'bottom-28' : 'bottom-14'}`}
          >
            <Radio size={13} aria-hidden />GO LIVE · −{Math.round(snap.behindLiveSec)}s
          </button>
        )}

        {(snap.state === 'loading' || snap.state === 'buffering') && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center" role="status" aria-label={snap.state}>
            <span className="grid place-items-center gap-2">
              <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-white/25 border-t-cyan-300 sm:h-12 sm:w-12" />
              <span className="rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium text-white sm:text-xs">
                {snap.reconnecting
                  ? `Reconnecting (${snap.reconnectAttempt}/${snap.maxReconnects})…`
                  : snap.state === 'loading'
                    ? `Starting stream…${snap.attempts > 1 && snap.attempt > 1 ? ` (route ${snap.attempt}/${snap.attempts})` : ''}`
                    : 'Buffering…'}
              </span>
            </span>
          </div>
        )}

        {!playing && snap.state !== 'loading' && snap.state !== 'buffering' && snap.state !== 'error' && panel === 'none' && (
          <button type="button" onClick={() => eng()?.play()} aria-label="Play" className="absolute inset-0 z-10 grid w-full place-items-center bg-black/25">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-sky-500 text-white shadow-glow transition hover:scale-105 sm:h-[68px] sm:w-[68px]">
              <Play size={28} className="ml-1" />
            </span>
          </button>
        )}

        {snap.state === 'error' && snap.error && (
          <div className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-black/92 p-3 sm:p-5" role="alert">
            <div className="w-full max-w-md text-center">
              <h2 className="text-sm font-bold text-white sm:text-lg">Playback failed — {snap.error.category.replace(/-/g, ' ')}</h2>
              {snap.error.codeLabel && <p className="mt-1 inline-block rounded-full border border-white/20 bg-white/5 px-2.5 py-0.5 font-mono text-[10px] text-amber-300">{snap.error.codeLabel}</p>}
              <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-muted sm:text-sm">{snap.error.message}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button className="min-h-[38px] px-3.5 text-xs" onClick={() => eng()?.retry()}>
                  <RotateCcw size={14} aria-hidden />Retry
                </Button>
                <Button variant="outline" className="min-h-[38px] px-3.5 text-xs" onClick={openInDirect}>
                  <ExternalLink size={14} aria-hidden />Play Stream
                </Button>
                {nextCh && (
                  <Button variant="ghost" className="min-h-[38px] px-3.5 text-xs" onClick={() => navigate(`/player/${encodeURIComponent(nextCh.id)}`)}>
                    Next Channel →
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Bottom HUD — Clean compact bar when inline; Spacious 2-Row Full Pro Dock in Full View! */}
        <div
          className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/70 to-transparent transition-opacity duration-200 ${
            inFullView ? 'svx-safe-bottom svx-safe-x pt-10' : 'px-2 pb-1.5 pt-8 sm:px-3 sm:pb-2'
          } ${showUi ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        >
          {/* Seekbar */}
          {snap.seekable && !snap.live ? (
            <div className="mb-1 flex items-center gap-2">
              <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/90">{formatTime(snap.currentTime)}</span>
              <input
                type="range"
                min={0}
                max={snap.duration || 0}
                step={1}
                value={Math.min(snap.currentTime, snap.duration || 0)}
                onChange={(e) => eng()?.seek(Number(e.target.value))}
                className="min-w-0 flex-1 accent-sky-400"
                aria-label="Seek through video"
              />
              <span className="w-10 shrink-0 font-mono text-[11px] tabular-nums text-white/90">{formatTime(snap.duration)}</span>
            </div>
          ) : snap.live ? (
            <div className="mb-1.5 h-0.5 overflow-hidden rounded bg-white/15" aria-hidden>
              <div className="h-full w-full bg-red-500/85" />
            </div>
          ) : null}

          {/* Row 1: Primary Transport (Zero-overflow on all phone widths!) */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            {item.kind === 'live' && (
              <button
                type="button"
                disabled={!prevCh}
                onClick={() => prevCh && navigate(`/player/${encodeURIComponent(prevCh.id)}`)}
                aria-label={prevCh ? `Previous channel: ${prevCh.title}` : 'No previous channel'}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white hover:bg-white/15 disabled:opacity-35 sm:h-10 sm:w-10"
              >
                <ChevronLeft size={20} />
              </button>
            )}

            {snap.seekable && (
              <button
                type="button"
                onClick={() => eng()?.seekBy(-10)}
                aria-label="Back 10 seconds"
                className="inline-flex h-9 shrink-0 items-center rounded-full px-2 text-[11px] font-bold text-white hover:bg-white/15"
              >
                −10s
              </button>
            )}

            <button
              type="button"
              onClick={() => (playing ? eng()?.pause() : eng()?.play())}
              aria-label={playing ? 'Pause' : 'Play'}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-500 text-white shadow-glow sm:h-11 sm:w-11"
            >
              {playing ? <Pause size={19} /> : <Play size={19} className="ml-0.5" />}
            </button>

            {snap.seekable && (
              <button
                type="button"
                onClick={() => eng()?.seekBy(10)}
                aria-label="Forward 10 seconds"
                className="inline-flex h-9 shrink-0 items-center rounded-full px-2 text-[11px] font-bold text-white hover:bg-white/15"
              >
                +10s
              </button>
            )}

            {item.kind === 'live' && (
              <button
                type="button"
                disabled={!nextCh}
                onClick={() => nextCh && navigate(`/player/${encodeURIComponent(nextCh.id)}`)}
                aria-label={nextCh ? `Next channel: ${nextCh.title}` : 'No next channel'}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white hover:bg-white/15 disabled:opacity-35 sm:h-10 sm:w-10"
              >
                <ChevronRight size={20} />
              </button>
            )}

            <button
              type="button"
              onClick={() => eng()?.toggleMute()}
              aria-label={snap.muted ? 'Unmute' : 'Mute'}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white hover:bg-white/15 sm:h-10 sm:w-10"
            >
              {snap.muted || snap.volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={snap.muted ? 0 : snap.volume}
              onChange={(e) => eng()?.setVolume(Number(e.target.value))}
              className="hidden w-20 shrink-0 accent-sky-400 md:block"
              aria-label="Volume"
            />

            <span className="min-w-0 flex-1" />

            {/* Desktop inline shortcuts (hidden on cramped mobile inline because mobile has the dedicated dock right below + Row 2 in Full View!) */}
            {!inFullView && (
              <div className="hidden items-center gap-1 md:flex">
                {liveSiblings.length > 1 && (
                  <button type="button" onClick={() => togglePanel('channels')} aria-label="Quick channel list" className="grid h-9 w-9 place-items-center rounded-full text-white hover:bg-white/15">
                    <ListVideo size={18} />
                  </button>
                )}
                <button type="button" onClick={() => togglePanel('quality')} aria-label="Video quality" className="inline-flex h-9 items-center gap-1 rounded-full px-2.5 text-xs font-bold text-white hover:bg-white/15">
                  <Gauge size={15} /><span>{snap.currentQualityLabel}</span>
                </button>
                <button type="button" onClick={() => togglePanel('audio')} aria-label="Audio tracks" className="relative grid h-9 w-9 place-items-center rounded-full text-white hover:bg-white/15">
                  <AudioLines size={17} />
                  {snap.audioTracks.length > 1 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-sky-500 px-1 text-[9px] font-extrabold text-white">{snap.audioTracks.length}</span>}
                </button>
                <button type="button" onClick={() => togglePanel('subs')} aria-label="Subtitles" className="grid h-9 w-9 place-items-center rounded-full text-white hover:bg-white/15">
                  <Subtitles size={17} />
                </button>
                <button type="button" onClick={() => togglePanel('picture')} aria-label="Picture equalizer" className={`grid h-9 w-9 place-items-center rounded-full hover:bg-white/15 ${filterCss ? 'text-cyanx' : 'text-white'}`}>
                  <SlidersHorizontal size={16} />
                </button>
                <button type="button" onClick={() => togglePanel('more')} aria-label="More options" className="grid h-9 w-9 place-items-center rounded-full text-white hover:bg-white/15">
                  <Settings2 size={17} />
                </button>
              </div>
            )}

            {/* Prominent Full View / Exit Full View Button — ALWAYS visible & clear! */}
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={inFullView ? 'Exit full view' : 'Full view'}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 text-xs font-extrabold text-white backdrop-blur hover:bg-sky-500 sm:h-10"
            >
              {inFullView ? <Minimize size={16} /> : <Maximize size={16} />}
              <span>{inFullView ? 'Exit Full' : 'Full View'}</span>
            </button>
          </div>

          {/* Row 2 in Full View: ALL Pro Buttons clearly labeled & horizontally scrollable — ZERO hidden or crushed buttons on ANY phone! */}
          {inFullView && (
            <div className="chips-row mt-2 flex items-center gap-1.5 overflow-x-auto border-t border-white/10 pt-2">
              {liveSiblings.length > 1 && (
                <button
                  type="button"
                  onClick={() => togglePanel('channels')}
                  className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold ${panel === 'channels' ? 'bg-sky-500 text-white' : 'bg-white/12 text-white hover:bg-white/20'}`}
                >
                  <ListVideo size={15} aria-hidden />Channels ({liveSiblings.length})
                </button>
              )}

              <button
                type="button"
                onClick={() => togglePanel('quality')}
                className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold ${panel === 'quality' ? 'bg-sky-500 text-white' : 'bg-white/12 text-white hover:bg-white/20'}`}
              >
                <Gauge size={15} aria-hidden />{snap.currentQualityLabel}
              </button>

              <button
                type="button"
                onClick={() => togglePanel('audio')}
                className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold ${panel === 'audio' ? 'bg-sky-500 text-white' : 'bg-white/12 text-white hover:bg-white/20'}`}
              >
                <AudioLines size={15} aria-hidden />
                Audio{snap.audioTracks.length > 1 ? ` (${snap.audioTracks.length})` : ''}
              </button>

              <button
                type="button"
                onClick={() => togglePanel('subs')}
                className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold ${panel === 'subs' ? 'bg-sky-500 text-white' : 'bg-white/12 text-white hover:bg-white/20'}`}
              >
                <Subtitles size={15} aria-hidden />Subtitles
              </button>

              <button
                type="button"
                onClick={cycleAspect}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-white/12 px-3 text-xs font-bold text-white hover:bg-white/20"
              >
                <Frame size={14} aria-hidden />Aspect: {currentAspectMeta.short}
              </button>

              <button
                type="button"
                onClick={() => togglePanel('picture')}
                className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold ${panel === 'picture' ? 'bg-sky-500 text-white' : filterCss ? 'bg-cyan-500/25 text-cyanx' : 'bg-white/12 text-white hover:bg-white/20'}`}
              >
                <SlidersHorizontal size={14} aria-hidden />Picture EQ
              </button>

              <button
                type="button"
                onClick={() => (recState === 'idle' ? togglePanel('rec') : void stopRecording())}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-white/12 px-3 text-xs font-bold text-white hover:bg-white/20"
              >
                {recState === 'idle' ? <Circle size={13} className="fill-red-500 text-red-500" /> : <Square size={13} className="animate-pulse fill-red-500 text-red-500" />}
                {recState === 'idle' ? 'Record' : 'Stop Rec'}
              </button>

              <button
                type="button"
                onClick={() => togglePanel('more')}
                className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-bold ${panel === 'more' ? 'bg-sky-500 text-white' : 'bg-white/12 text-white hover:bg-white/20'}`}
              >
                <Settings2 size={14} aria-hidden />Speed &amp; Sleep
              </button>

              <button
                type="button"
                onClick={() => void requestPip()}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-white/12 px-3 text-xs font-bold text-white hover:bg-white/20"
              >
                <PictureInPicture2 size={14} aria-hidden />PiP
              </button>
            </div>
          )}
        </div>

        {/* Sheet Drawer inside Full View */}
        {renderSheetModal(true)}
      </div>

      {/* Sheet Drawer when NOT in Full View (Full-height mobile bottom sheet — never cramped inside 16:9!) */}
      {renderSheetModal(false)}

      {/* Always-Visible Mobile & Tablet Pro Control Dock right beneath the video! */}
      {!inFullView && (
        <div
          className="chips-row mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1"
          aria-label="Player quick controls"
        >
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl bg-sky-500 px-3 text-xs font-extrabold text-white shadow-glow"
          >
            <Maximize size={14} aria-hidden />Full Screen
          </button>

          {liveSiblings.length > 1 && (
            <button
              type="button"
              onClick={() => togglePanel('channels')}
              className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-silver hover:border-sky-400"
            >
              <ListVideo size={15} className="text-cyanx" aria-hidden />Channels ({liveSiblings.length})
            </button>
          )}

          {recallCh && (
            <button
              type="button"
              onClick={() => navigate(`/player/${encodeURIComponent(recallCh.id)}`)}
              className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-cyanx hover:border-sky-400"
            >
              <Undo2 size={14} aria-hidden />Recall
            </button>
          )}

          <button
            type="button"
            onClick={() => togglePanel('quality')}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-silver hover:border-sky-400"
          >
            <Gauge size={14} className="text-cyanx" aria-hidden />{snap.currentQualityLabel}
          </button>

          <button
            type="button"
            onClick={() => togglePanel('audio')}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-silver hover:border-sky-400"
          >
            <AudioLines size={14} className="text-cyanx" aria-hidden />
            Audio{snap.audioTracks.length > 1 ? ` (${snap.audioTracks.length})` : `: ${snap.audioLabel}`}
          </button>

          <button
            type="button"
            onClick={() => togglePanel('subs')}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-silver hover:border-sky-400"
          >
            <Subtitles size={14} className="text-cyanx" aria-hidden />Subtitles
          </button>

          <button
            type="button"
            onClick={cycleAspect}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-silver hover:border-sky-400"
          >
            <Frame size={14} className="text-cyanx" aria-hidden />Aspect: {currentAspectMeta.short}
          </button>

          <button
            type="button"
            onClick={() => togglePanel('picture')}
            className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold ${
              filterCss ? 'border-sky-400 bg-sky-500/15 text-cyanx' : 'border-border bg-card text-silver hover:border-sky-400'
            }`}
          >
            <SlidersHorizontal size={14} aria-hidden />Picture EQ
          </button>

          <button
            type="button"
            onClick={() => (recState === 'idle' ? togglePanel('rec') : void stopRecording())}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-silver hover:border-sky-400"
          >
            {recState === 'idle' ? <Circle size={12} className="fill-red-500 text-red-500" /> : <Square size={12} className="animate-pulse fill-red-500 text-red-500" />}
            {recState === 'idle' ? 'Record' : 'Stop Rec'}
          </button>

          <button
            type="button"
            onClick={() => togglePanel('more')}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-silver hover:border-sky-400"
          >
            <Settings2 size={14} aria-hidden />More / Sleep
          </button>

          <button
            type="button"
            onClick={() => void requestPip()}
            className="inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-silver hover:border-sky-400"
          >
            <PictureInPicture2 size={14} aria-hidden />PiP
          </button>

          <button
            type="button"
            onClick={() => setStatsOn(!statsOn)}
            className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold ${
              statsOn ? 'border-sky-400 bg-sky-500/15 text-cyanx' : 'border-border bg-card text-silver hover:border-sky-400'
            }`}
          >
            <Activity size={14} aria-hidden />Stats
          </button>
        </div>
      )}

      {/* Status chips */}
      <div className="chips-row mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Stream status">
        {[
          ['Engine', snap.engine],
          ['Format', snap.format.toUpperCase()],
          ['Resolution', snap.resolution],
          ['Buffer', `${bufferAhead}s`],
          ...(sleepMin > 0 ? [['Sleep', `${sleepMin}m`]] : []),
          ['State', snap.reconnecting ? `reconnecting ${snap.reconnectAttempt}/${snap.maxReconnects}` : snap.state],
        ].map(([k, v]) => (
          <span key={k} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px]">
            <span className="font-semibold uppercase tracking-wide text-muted">{k}</span>
            <strong className="max-w-[140px] truncate text-silver">{v}</strong>
          </span>
        ))}
        <span className="hidden items-center gap-2 px-1 text-[11px] text-muted xl:inline-flex">
          <button
            type="button"
            onClick={() => {
              const v = videoRef.current;
              if (!v || !v.videoWidth) { setNotice('Frame abhi available nahi.'); return; }
              try {
                const c = document.createElement('canvas');
                c.width = v.videoWidth; c.height = v.videoHeight;
                c.getContext('2d')?.drawImage(v, 0, 0);
                const a = document.createElement('a');
                a.href = c.toDataURL('image/png');
                a.download = `siravex-${Date.now()}.png`;
                a.click();
                setNotice('Snapshot saved.');
              } catch { setNotice('Snapshot blocked (stream CORS).'); }
            }}
            className="inline-flex items-center gap-1 font-semibold text-cyanx hover:underline"
          >
            <Camera size={13} aria-hidden />Snapshot
          </button>
          <button
            type="button"
            onClick={async () => {
              const text = `Watching “${cleanTitle(item.title)}” on SIRAVEX`;
              try {
                if (navigator.share) await navigator.share({ title: 'SIRAVEX', text });
                else { await navigator.clipboard.writeText(text); setNotice('Title copied.'); }
              } catch { /* cancelled */ }
            }}
            className="inline-flex items-center gap-1 font-semibold text-cyanx hover:underline"
          >
            <Share2 size={13} aria-hidden />Share
          </button>
          <span className="inline-flex items-center gap-1"><Moon size={13} aria-hidden />Sleep &amp; Speed More mein</span>
        </span>
      </div>

      {notice && (
        <p className="mt-2 text-xs font-medium text-cyanx" role="status">
          {notice}
          <button type="button" onClick={() => setNotice('')} className="ml-2 text-muted underline">dismiss</button>
        </p>
      )}

      {(nowNext.current || nowNext.next) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {nowNext.current && (
            <div className="rounded-xl border border-sky-500/40 bg-sky-950/40 p-3 text-sm">
              <p className="break-anywhere line-clamp-2 font-bold">Now — {cleanTitle(nowNext.current.title)}</p>
              <p className="mt-0.5 text-xs text-muted">
                {new Date(nowNext.current.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(nowNext.current.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
              <span className="mt-2 block h-1.5 overflow-hidden rounded bg-slate-800">
                <span className="block h-full bg-sky-400" style={{ width: `${Math.min(100, Math.max(0, ((Date.now() - nowNext.current.start) / Math.max(1, nowNext.current.end - nowNext.current.start)) * 100))}%` }} />
              </span>
            </div>
          )}
          {nowNext.next && (
            <div className="rounded-xl border border-border bg-card p-3 text-sm">
              <p className="break-anywhere line-clamp-2 font-bold">Next — {cleanTitle(nowNext.next.title)}</p>
              <p className="mt-0.5 text-xs text-muted">
                {new Date(nowNext.next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(nowNext.next.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
