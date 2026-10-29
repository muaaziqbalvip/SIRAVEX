import type Hls from 'hls.js';
import { formatOf } from './capabilities/capabilities';
import { mapPlaybackError, type PlaybackErrorInfo } from './errors/mapper';
import { normalizeStreamUrl } from '@/lib/security';

export interface TrackOption { id: string; label: string; lang?: string }
export interface QualityOption { id: string; label: string; height?: number; bitrate?: number }
export interface PlayerSnapshot {
  state: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';
  currentTime: number; duration: number; seekable: boolean; live: boolean;
  muted: boolean; volume: number; rate: number; bufferedEnd: number;
  qualities: QualityOption[]; qualityId: string; currentQualityLabel: string;
  audioTracks: TrackOption[]; audioId: string;
  subtitleTracks: TrackOption[]; subtitleId: string;
  error: PlaybackErrorInfo | null; engine: string;
}

type Listener = (s: PlayerSnapshot) => void;
type HlsInstance = InstanceType<typeof Hls>;

/**
 * Single-owner playback engine (v2 — rewritten after field reports of black screens,
 * stuck quality and missing audio tracks):
 *  - Handlers are registered BEFORE loadSource (no missed MANIFEST_PARSED race).
 *  - video.load() is NEVER called after attaching MSE (that destroyed the source buffer).
 *  - HLS network/media errors recover (startLoad / recoverMediaError) before going fatal.
 *  - Quality selection locks ABR (Hls currentLevel / Shaka abr.enabled=false) so the
 *    user's pick actually sticks; LEVEL_SWITCHED / variant changes report the real rendition.
 *  - Audio/subtitle lists update on AUDIO_TRACKS_UPDATED / SUBTITLE_TRACKS_UPDATED too.
 *  - One video element, one adapter; destroy() removes everything.
 */
export class PlaybackEngine {
  private video: HTMLVideoElement;
  private hls: HlsInstance | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private shakaPlayer: any = null;
  private retries = 0;
  private listeners = new Set<Listener>();
  private bound: [string, EventListener][] = [];
  private destroyed = false;
  snap: PlayerSnapshot = { state: 'idle', currentTime: 0, duration: 0, seekable: false, live: false, muted: false, volume: 1, rate: 1, bufferedEnd: 0, qualities: [], qualityId: 'auto', currentQualityLabel: 'Auto', audioTracks: [], audioId: '', subtitleTracks: [{ id: 'off', label: 'Off' }], subtitleId: 'off', error: null, engine: 'none' };
  currentUrl = '';

  constructor(video: HTMLVideoElement) {
    this.video = video;
    const on = (name: string, fn: () => void) => { const f = fn as EventListener; video.addEventListener(name, f); this.bound.push([name, f]); };
    on('play', () => this.set({ state: 'playing' }));
    on('playing', () => this.set({ state: 'playing' }));
    on('pause', () => this.set({ state: 'paused' }));
    on('waiting', () => this.set({ state: 'buffering' }));
    on('ended', () => this.set({ state: 'ended' }));
    on('canplay', () => { if (this.snap.state === 'loading') this.set({ state: 'ready' }); });
    on('loadedmetadata', () => this.emit());
    on('timeupdate', () => this.emit());
    on('durationchange', () => this.emit());
    on('volumechange', () => this.emit());
    on('ratechange', () => this.emit());
    on('progress', () => this.emit());
    on('error', () => this.fail());
  }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); fn(this.snap); return () => this.listeners.delete(fn); }
  private set(p: Partial<PlayerSnapshot>) { if (this.destroyed) return; this.snap = { ...this.snap, ...p }; this.listeners.forEach((f) => f(this.snap)); }
  private emit() {
    const v = this.video;
    const live = !Number.isFinite(v.duration) || v.duration === Infinity;
    let seekable = false;
    try { seekable = v.seekable.length > 0 && v.seekable.end(0) - v.seekable.start(0) > 1; } catch { seekable = false; }
    let bufferedEnd = 0;
    try { if (v.buffered.length) bufferedEnd = v.buffered.end(v.buffered.length - 1); } catch { /* noop */ }
    const subs: TrackOption[] = [{ id: 'off', label: 'Off' }];
    const seen = new Set<string>();
    for (let i = 0; i < v.textTracks.length; i++) {
      const t = v.textTracks[i];
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      const label = t.label || t.language || `Subtitle ${i + 1}`;
      if (seen.has(label)) continue; seen.add(label);
      subs.push({ id: String(i), label, lang: t.language });
    }
    // Keep HLS/Shaka-provided subtitle lists if native tracks are empty.
    const subtitleTracks = subs.length > 1 ? subs : (this.snap.subtitleTracks.length > 1 ? this.snap.subtitleTracks : subs);
    this.set({ currentTime: v.currentTime || 0, duration: Number.isFinite(v.duration) ? v.duration : 0, live, seekable, muted: v.muted, volume: v.volume, rate: v.playbackRate, bufferedEnd, subtitleTracks });
  }
  private fail() {
    const err = this.video.error;
    if (!err) return;
    if (this.retries < 1 && this.currentUrl) { this.retries++; void this.load(this.currentUrl, false); return; }
    this.set({ state: 'error', error: mapPlaybackError({ code: err.code, message: err.message, url: this.currentUrl }) });
  }

  async load(rawUrl: string, resetRetry = true): Promise<void> {
    if (resetRetry) this.retries = 0;
    this.teardownAdapter();
    const url = normalizeStreamUrl(rawUrl);
    this.currentUrl = url;
    const format = formatOf(url);
    this.set({ state: 'loading', error: null, engine: format === 'hls' ? 'HLS' : format === 'dash' ? 'DASH' : format, qualities: [], qualityId: 'auto', currentQualityLabel: 'Auto', audioTracks: [], audioId: '', subtitleTracks: [{ id: 'off', label: 'Off' }], subtitleId: 'off', currentTime: 0, duration: 0 });
    if (format === 'unsupported') { this.set({ state: 'error', error: mapPlaybackError({ url, format }) }); return; }
    try {
      const nativeHls = format === 'hls' && this.video.canPlayType('application/vnd.apple.mpegurl') !== '';
      if (format === 'hls' && !nativeHls) await this.loadHls(url);
      else if (format === 'dash') await this.loadDash(url);
      else { this.video.src = url; this.video.load(); }
    } catch (e) {
      this.set({ state: 'error', error: mapPlaybackError({ message: e instanceof Error ? e.message : 'network', url }) });
    }
  }

  private async loadHls(url: string): Promise<void> {
    const mod = await import('hls.js');
    const HlsCtor = mod.default;
    if (!HlsCtor.isSupported()) { this.set({ state: 'error', error: mapPlaybackError({ message: 'format not supported', url }) }); return; }
    const hls = new HlsCtor({
      enableWorker: true,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      fragLoadingMaxRetry: 4,
      manifestLoadingMaxRetry: 2,
      levelLoadingMaxRetry: 4,
    });
    this.hls = hls;
    const syncTracks = () => {
      if (!this.hls) return;
      const qualities: QualityOption[] = [{ id: 'auto', label: 'Auto' }, ...hls.levels.map((l, i) => ({ id: String(i), label: l.height ? `${l.height}p` : `Level ${i + 1}`, height: l.height, bitrate: l.bitrate }))];
      const audioTracks: TrackOption[] = (hls.audioTracks ?? []).map((t, i) => ({ id: String(i), label: t.name || t.lang || `Audio ${i + 1}`, lang: t.lang }));
      const subtitleTracks: TrackOption[] = [{ id: 'off', label: 'Off' }, ...(hls.subtitleTracks ?? []).map((t, i) => ({ id: `hls-${i}`, label: t.name || t.lang || `Subtitle ${i + 1}`, lang: t.lang }))];
      this.set({
        qualities,
        audioTracks,
        audioId: hls.audioTrack >= 0 ? String(hls.audioTrack) : this.snap.audioId,
        subtitleTracks: subtitleTracks.length > 1 ? subtitleTracks : this.snap.subtitleTracks,
      });
    };
    // Register EVERYTHING before attaching/loading — fixes the "no qualities / no audio" race.
    hls.on(HlsCtor.Events.MANIFEST_PARSED, syncTracks);
    hls.on(HlsCtor.Events.AUDIO_TRACKS_UPDATED, syncTracks);
    hls.on(HlsCtor.Events.SUBTITLE_TRACKS_UPDATED, syncTracks);
    hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, data) => {
      const lvl = hls.levels[data.level];
      this.set({ currentQualityLabel: this.snap.qualityId === 'auto' ? `Auto${lvl?.height ? ` · ${lvl.height}p` : ''}` : this.snap.currentQualityLabel });
    });
    hls.on(HlsCtor.Events.AUDIO_TRACK_SWITCHED, (_e, data) => this.set({ audioId: String(data.id) }));
    let networkRecoveries = 0; let mediaRecoveries = 0;
    hls.on(HlsCtor.Events.ERROR, (_e, data) => {
      if (!data.fatal) {
        if (data.details === HlsCtor.ErrorDetails.BUFFER_STALLED_ERROR && mediaRecoveries < 2) { mediaRecoveries++; hls.recoverMediaError(); }
        return;
      }
      if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && networkRecoveries < 2) { networkRecoveries++; hls.startLoad(); return; }
      if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) { mediaRecoveries++; hls.recoverMediaError(); return; }
      this.set({ state: 'error', error: mapPlaybackError({ message: data.details, url }) });
    });
    hls.attachMedia(this.video);
    hls.on(HlsCtor.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
  }

  private async loadDash(url: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('shaka-player/dist/shaka-player.compiled');
    const shaka = mod.default ?? mod;
    shaka.polyfill.installAll();
    if (!shaka.isBrowserSupported()) { this.set({ state: 'error', error: mapPlaybackError({ message: 'format not supported', url }) }); return; }
    const player = new shaka.Player();
    this.shakaPlayer = player;
    await player.attach(this.video);
    player.configure({ streaming: { bufferingGoal: 30, rebufferingGoal: 2 }, abr: { enabled: true } });
    const syncDash = () => {
      try {
        const variants = (player.getVariantTracks() as { id: number; height?: number; bandwidth?: number; active: boolean }[]) ?? [];
        const seen = new Set<number>();
        const qualities: QualityOption[] = [{ id: 'auto', label: 'Auto' }];
        for (const v of variants) { if (v.height && !seen.has(v.height)) { seen.add(v.height); qualities.push({ id: `h-${v.height}`, label: `${v.height}p`, height: v.height, bitrate: v.bandwidth }); } }
        qualities.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
        const langs = (player.getAudioLanguagesAndRoles?.() as { language: string }[] | string[]) ?? [];
        const audioTracks: TrackOption[] = langs.map((l) => { const lang = typeof l === 'string' ? l : l.language; return { id: lang, label: lang, lang }; });
        const active = variants.find((v) => v.active);
        this.set({ qualities, audioTracks, currentQualityLabel: this.snap.qualityId === 'auto' ? `Auto${active?.height ? ` · ${active.height}p` : ''}` : this.snap.currentQualityLabel });
      } catch { /* player tearing down */ }
    };
    player.addEventListener('variantchanged', syncDash);
    player.addEventListener('trackschanged', syncDash);
    player.addEventListener('error', (ev: Event) => { const detail = (ev as CustomEvent<{ code?: number }>).detail; void detail; this.set({ state: 'error', error: mapPlaybackError({ message: 'network', url }) }); });
    await player.load(url);
    syncDash();
  }

  play(): void { void this.video.play().catch(() => { /* autoplay policy / abort — error event handles real failures */ }); }
  pause(): void { this.video.pause(); }
  seek(t: number): void { if (this.snap.seekable) { try { this.video.currentTime = Math.max(0, t); } catch { /* live edge */ } } }
  seekBy(delta: number): void { if (this.snap.seekable) this.seek(this.video.currentTime + delta); }
  setVolume(v: number): void { this.video.volume = Math.min(1, Math.max(0, v)); if (v > 0) this.video.muted = false; this.emit(); }
  toggleMute(): void { this.video.muted = !this.video.muted; this.emit(); }
  setRate(r: number): void { this.video.playbackRate = r; this.emit(); }

  setQuality(id: string): void {
    this.set({ qualityId: id, currentQualityLabel: id === 'auto' ? 'Auto' : this.snap.qualities.find((q) => q.id === id)?.label ?? id });
    if (this.hls) {
      if (id === 'auto') { this.hls.currentLevel = -1; this.hls.nextLevel = -1; }
      else { this.hls.currentLevel = Number(id); }
      return;
    }
    if (this.shakaPlayer) {
      try {
        if (id === 'auto') { this.shakaPlayer.configure({ abr: { enabled: true } }); return; }
        const height = Number(id.replace('h-', ''));
        const variants = (this.shakaPlayer.getVariantTracks() as { id: number; height?: number }[]) ?? [];
        const best = variants.filter((v) => v.height === height).sort((a, b) => 0)[0] ?? variants.find((v) => String(v.id) === id);
        if (best) { this.shakaPlayer.configure({ abr: { enabled: false } }); this.shakaPlayer.selectVariantTrack(best, true); }
      } catch { /* noop */ }
    }
    // Native (Safari HLS / MP4): rendition is browser-managed — label already says Auto/managed.
  }

  setAudio(id: string): void {
    this.set({ audioId: id });
    if (this.hls) { const idx = Number(id); if (Number.isFinite(idx)) this.hls.audioTrack = idx; return; }
    if (this.shakaPlayer) { try { this.shakaPlayer.selectAudioLanguage(id); } catch { /* noop */ } return; }
    // Safari native audioTracks (non-standard but real where present).
    const native = (this.video as unknown as { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }).audioTracks;
    if (native) for (let i = 0; i < native.length; i++) native[i].enabled = String(i) === id;
  }

  setSubtitle(id: string): void {
    this.set({ subtitleId: id });
    if (this.hls) { this.hls.subtitleTrack = id === 'off' ? -1 : Number(id.replace('hls-', '')); }
    if (this.shakaPlayer) {
      try {
        const tracks = (this.shakaPlayer.getTextTracks() as { id: number; language: string }[]) ?? [];
        const match = tracks[Number(id)];
        if (id === 'off' || !match) this.shakaPlayer.setTextTrackVisibility(false);
        else { this.shakaPlayer.selectTextTrack(match); this.shakaPlayer.setTextTrackVisibility(true); }
      } catch { /* noop */ }
    }
    for (let i = 0; i < this.video.textTracks.length; i++) this.video.textTracks[i].mode = id === String(i) ? 'showing' : 'disabled';
    this.emit();
  }

  retry(): void { if (this.currentUrl) void this.load(this.currentUrl); }
  private teardownAdapter() {
    try { this.hls?.destroy(); } catch { /* noop */ } this.hls = null;
    if (this.shakaPlayer) { const p = this.shakaPlayer; this.shakaPlayer = null; void Promise.resolve(p.destroy?.()).catch(() => undefined); }
    if (this.video.getAttribute('src')) { this.video.removeAttribute('src'); try { this.video.load(); } catch { /* noop */ } }
  }
  destroy(): void { this.destroyed = true; this.teardownAdapter(); this.bound.forEach(([n, f]) => this.video.removeEventListener(n, f)); this.bound = []; this.listeners.clear(); }
}
