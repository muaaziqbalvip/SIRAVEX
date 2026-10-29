import { formatOf } from './capabilities/capabilities';
import { mapPlaybackError, type PlaybackErrorInfo } from './errors/mapper';

export interface TrackOption { id: string; label: string; lang?: string }
export interface QualityOption { id: string; label: string; height?: number }
export interface PlayerSnapshot {
  state: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';
  currentTime: number; duration: number; seekable: boolean; live: boolean;
  muted: boolean; volume: number; rate: number;
  qualities: QualityOption[]; qualityId: string;
  audioTracks: TrackOption[]; audioId: string;
  subtitleTracks: TrackOption[]; subtitleId: string;
  error: PlaybackErrorInfo | null; engine: string;
}

type Listener = (s: PlayerSnapshot) => void;

/**
 * Single-owner playback engine. One video element, one adapter at a time.
 * HLS.js and Shaka are dynamically imported only when the format needs them.
 * destroy() removes every listener and tears down the adapter (no leaks).
 */
export class PlaybackEngine {
  private video: HTMLVideoElement;
  private hls: { destroy: () => void; levels?: unknown[]; audioTracks?: unknown[] } | null = null;
  private shakaPlayer: { destroy: () => Promise<void>; getVariantTracks?: () => { id: number; height: number; active: boolean }[]; getAudioLanguages?: () => string[]; addEventListener?: (t: string, f: () => void) => void } | null = null;
  private subsMode = 'showing';
  private retries = 0;
  private listeners = new Set<Listener>();
  private bound: [string, EventListener][] = [];
  snap: PlayerSnapshot = { state: 'idle', currentTime: 0, duration: 0, seekable: false, live: false, muted: false, volume: 1, rate: 1, qualities: [], qualityId: 'auto', audioTracks: [], audioId: '', subtitleTracks: [], subtitleId: 'off', error: null, engine: 'none' };
  currentUrl = '';

  constructor(video: HTMLVideoElement) {
    this.video = video;
    const upd = () => this.emit();
    const events: [string, () => void][] = [
      ['play', () => this.set({ state: 'playing' })], ['playing', () => this.set({ state: 'playing' })],
      ['pause', () => this.set({ state: 'paused' })], ['waiting', () => this.set({ state: 'buffering' })],
      ['ended', () => this.set({ state: 'ended' })], ['loadedmetadata', upd], ['timeupdate', upd], ['durationchange', upd], ['volumechange', upd], ['ratechange', upd],
      ['error', () => this.fail()],
    ];
    events.forEach(([name, fn]) => { const f = fn as EventListener; this.video.addEventListener(name, f); this.bound.push([name, f]); });
  }

  subscribe(fn: Listener): () => void { this.listeners.add(fn); fn(this.snap); return () => this.listeners.delete(fn); }
  private set(p: Partial<PlayerSnapshot>) { this.snap = { ...this.snap, ...p }; this.listeners.forEach((f) => f(this.snap)); }
  private emit() {
    const v = this.video;
    const live = !Number.isFinite(v.duration) || v.duration === Infinity;
    let seekable = false;
    try { seekable = v.seekable.length > 0 && v.seekable.end(0) - v.seekable.start(0) > 1; } catch { seekable = false; }
    const subs: TrackOption[] = [{ id: 'off', label: 'Off' }];
    for (let i = 0; i < v.textTracks.length; i++) { const t = v.textTracks[i]; subs.push({ id: String(i), label: t.label || t.language || `Subtitle ${i + 1}`, lang: t.language }); }
    this.set({ currentTime: v.currentTime || 0, duration: Number.isFinite(v.duration) ? v.duration : 0, live, seekable, muted: v.muted, volume: v.volume, rate: v.playbackRate, subtitleTracks: subs });
  }
  private fail() {
    const err = this.video.error;
    if (this.retries < 1 && this.currentUrl) { this.retries++; void this.load(this.currentUrl, false); return; }
    this.set({ state: 'error', error: mapPlaybackError({ code: err?.code, message: err?.message, url: this.currentUrl }) });
  }

  async load(url: string, resetRetry = true): Promise<void> {
    if (resetRetry) this.retries = 0;
    this.teardownAdapter();
    this.currentUrl = url;
    const format = formatOf(url);
    this.set({ state: 'loading', error: null, engine: format, qualities: [], qualityId: 'auto', audioTracks: [], audioId: '' });
    if (format === 'unsupported') { this.set({ state: 'error', error: mapPlaybackError({ url, format }) }); return; }
    try {
      if (format === 'hls' && !this.video.canPlayType('application/vnd.apple.mpegurl')) {
        const mod = await import('hls.js');
        const HlsCtor = mod.default as unknown as { isSupported: () => boolean; new (cfg: object): { loadSource(u: string): void; attachMedia(v: HTMLVideoElement): void; destroy(): void; on(e: string, f: (ev: string, data: { fatal?: boolean; details?: string }) => void): void; levels: { height: number }[]; audioTracks: { name: string; lang?: string }[]; currentLevel: number; audioTrack: number } };
        if (!HlsCtor.isSupported()) { this.set({ state: 'error', error: mapPlaybackError({ message: 'format not supported', url }) }); return; }
        const hls = new HlsCtor({ maxBufferLength: 30, enableWorker: true });
        this.hls = hls as unknown as typeof this.hls;
        hls.loadSource(url); hls.attachMedia(this.video);
        hls.on('hlsManifestParsed', () => {
          const qualities: QualityOption[] = [{ id: 'auto', label: 'Auto' }, ...hls.levels.map((l, i) => ({ id: String(i), label: l.height ? `${l.height}p` : `Level ${i + 1}`, height: l.height }))];
          const audioTracks = hls.audioTracks.map((t, i) => ({ id: String(i), label: t.name || `Audio ${i + 1}`, lang: t.lang }));
          this.set({ qualities, audioTracks });
        });
        hls.on('hlsError', (_e, data) => { if (data.fatal) this.set({ state: 'error', error: mapPlaybackError({ message: data.details, url }) }); });
      } else if (format === 'dash') {
        const mod = await import('shaka-player/dist/shaka-player.compiled');
        const shaka = (mod as unknown as { default?: { polyfill: { installAll(): void }; Player: new (v: HTMLVideoElement) => NonNullable<PlaybackEngine['shakaPlayer']> & { load(u: string): Promise<void>; selectVariantTrack(t: unknown, clear: boolean): void }; isBrowserSupported(): boolean } }).default
          ?? (mod as unknown as { polyfill: { installAll(): void }; Player: new (v: HTMLVideoElement) => NonNullable<PlaybackEngine['shakaPlayer']> & { load(u: string): Promise<void> }; isBrowserSupported(): boolean });
        shaka.polyfill.installAll();
        if (!shaka.isBrowserSupported()) { this.set({ state: 'error', error: mapPlaybackError({ message: 'format not supported', url }) }); return; }
        const player = new shaka.Player(this.video);
        this.shakaPlayer = player as typeof this.shakaPlayer;
        player.addEventListener?.('error', () => this.set({ state: 'error', error: mapPlaybackError({ message: 'network', url }) }));
        await player.load(url);
        const variants = player.getVariantTracks?.() ?? [];
        const qualities: QualityOption[] = [{ id: 'auto', label: 'Auto' }, ...variants.map((v) => ({ id: String(v.id), label: v.height ? `${v.height}p` : `Track ${v.id}`, height: v.height }))];
        const langs = player.getAudioLanguages?.() ?? [];
        this.set({ qualities, audioTracks: langs.map((l) => ({ id: l, label: l, lang: l })) });
      } else {
        this.video.src = url;
      }
      this.video.load?.();
    } catch (e) {
      this.set({ state: 'error', error: mapPlaybackError({ message: e instanceof Error ? e.message : 'network', url }) });
    }
  }

  play(): void { void this.video.play().catch(() => this.fail()); }
  pause(): void { this.video.pause(); }
  seek(t: number): void { if (this.snap.seekable) this.video.currentTime = Math.max(0, t); }
  setVolume(v: number): void { this.video.volume = Math.min(1, Math.max(0, v)); if (v > 0) this.video.muted = false; this.emit(); }
  toggleMute(): void { this.video.muted = !this.video.muted; this.emit(); }
  setRate(r: number): void { this.video.playbackRate = r; this.emit(); }
  setQuality(id: string): void {
    this.set({ qualityId: id });
    const h = this.hls as unknown as { currentLevel?: number } | null;
    if (h && typeof h.currentLevel === 'number') h.currentLevel = id === 'auto' ? -1 : Number(id);
    const sp = this.shakaPlayer as unknown as { getVariantTracks?: () => { id: number }[]; selectVariantTrack?: (t: unknown, c: boolean) => void } | null;
    if (sp?.getVariantTracks && sp.selectVariantTrack && id !== 'auto') { const t = sp.getVariantTracks().find((v) => String(v.id) === id); if (t) sp.selectVariantTrack(t, true); }
  }
  setAudio(id: string): void {
    this.set({ audioId: id });
    const h = this.hls as unknown as { audioTrack?: number } | null;
    if (h) h.audioTrack = Number(id);
    const sp = this.shakaPlayer as unknown as { selectAudioLanguage?: (l: string) => void } | null;
    sp?.selectAudioLanguage?.(id);
  }
  setSubtitle(id: string): void {
    this.set({ subtitleId: id });
    for (let i = 0; i < this.video.textTracks.length; i++) this.video.textTracks[i].mode = id === String(i) ? (this.subsMode as TextTrackMode) : 'disabled';
    this.emit();
  }
  retry(): void { if (this.currentUrl) void this.load(this.currentUrl); }
  private teardownAdapter() {
    try { this.hls?.destroy(); } catch { /* noop */ } this.hls = null;
    if (this.shakaPlayer) { void this.shakaPlayer.destroy().catch(() => undefined); this.shakaPlayer = null; }
    this.video.removeAttribute('src'); try { this.video.load(); } catch { /* noop */ }
  }
  destroy(): void { this.teardownAdapter(); this.bound.forEach(([n, f]) => this.video.removeEventListener(n, f)); this.bound = []; this.listeners.clear(); }
}
