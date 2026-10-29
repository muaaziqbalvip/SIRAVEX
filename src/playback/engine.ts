import type Hls from 'hls.js';
import { formatOf, type StreamFormat } from './capabilities/capabilities';
import { mapPlaybackError, type PlaybackErrorInfo } from './errors/mapper';
import { normalizeStreamUrl } from '@/lib/security';

export interface TrackOption { id: string; label: string; lang?: string }
export interface QualityOption { id: string; label: string; height?: number; bitrate?: number }
export interface LoadOptions { forcedFormat?: string; clearKeys?: Record<string, string>; licenseUrl?: string }
export interface PlayerSnapshot {
  state: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';
  currentTime: number; duration: number; seekable: boolean; live: boolean;
  muted: boolean; volume: number; rate: number; bufferedEnd: number;
  qualities: QualityOption[]; qualityId: string; currentQualityLabel: string;
  audioTracks: TrackOption[]; audioId: string; audioLabel: string;
  subtitleTracks: TrackOption[]; subtitleId: string;
  resolution: string; bitrateKbps: number; droppedFrames: number; totalFrames: number; behindLiveSec: number;
  error: PlaybackErrorInfo | null; engine: string; format: string;
}

type Listener = (s: PlayerSnapshot) => void;
type HlsInstance = InstanceType<typeof Hls>;

/**
 * PlaybackEngine v3 — universal format coverage:
 *  HLS (.m3u8) HLS.js/native Safari · DASH (.mpd incl. ?auth=&q=auto URLs) Shaka
 *  MPEG-TS (.ts) + FLV (.flv) via mpegts.js (MSE) · MP4/WebM/MOV/MKV native attempt
 *  Optional user-supplied ClearKey / Widevine licence config for DASH (legitimate
 *  provider-issued keys only — configured into Shaka, never extracted or bypassed).
 * Fixes retained from v2: handlers before load, no video.load() after MSE attach,
 * ABR locking for quality, recover-before-fatal, one adapter at a time.
 */
export class PlaybackEngine {
  private video: HTMLVideoElement;
  private hls: HlsInstance | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private shakaPlayer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tsPlayer: any = null;
  private retries = 0;
  private listeners = new Set<Listener>();
  private bound: [string, EventListener][] = [];
  private destroyed = false;
  snap: PlayerSnapshot = { state: 'idle', currentTime: 0, duration: 0, seekable: false, live: false, muted: false, volume: 1, rate: 1, bufferedEnd: 0, qualities: [], qualityId: 'auto', currentQualityLabel: 'Auto', audioTracks: [], audioId: '', audioLabel: 'Default', subtitleTracks: [{ id: 'off', label: 'Off' }], subtitleId: 'off', resolution: '—', bitrateKbps: 0, droppedFrames: 0, totalFrames: 0, behindLiveSec: 0, error: null, engine: 'none', format: 'none' };
  currentUrl = '';

  constructor(video: HTMLVideoElement) {
    this.video = video;
    const on = (name: string, fn: () => void) => { const f = fn as EventListener; video.addEventListener(name, f); this.bound.push([name, f]); };
    on('play', () => this.set({ state: 'playing' }));
    on('playing', () => this.set({ state: 'playing' }));
    on('pause', () => this.set({ state: 'paused' }));
    on('waiting', () => this.set({ state: 'buffering' }));
    on('ended', () => this.set({ state: 'ended' }));
    on('canplay', () => { if (this.snap.state === 'loading') this.set({ state: 'ready' }); this.emit(); });
    on('loadedmetadata', () => this.emit());
    on('resize', () => this.emit());
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
    let droppedFrames = this.snap.droppedFrames; let totalFrames = this.snap.totalFrames;
    try { const q = (v as HTMLVideoElement & { getVideoPlaybackQuality?: () => { droppedVideoFrames: number; totalVideoFrames: number } }).getVideoPlaybackQuality?.(); if (q) { droppedFrames = q.droppedVideoFrames; totalFrames = q.totalVideoFrames; } } catch { /* noop */ }
    const subs: TrackOption[] = [{ id: 'off', label: 'Off' }];
    const seen = new Set<string>();
    for (let i = 0; i < v.textTracks.length; i++) {
      const t = v.textTracks[i];
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      const label = t.label || t.language || `Subtitle ${i + 1}`;
      if (seen.has(label)) continue; seen.add(label);
      subs.push({ id: String(i), label, lang: t.language });
    }
    const subtitleTracks = subs.length > 1 ? subs : (this.snap.subtitleTracks.length > 1 ? this.snap.subtitleTracks : subs);
    let behindLiveSec = 0;
    try { if (v.seekable.length) behindLiveSec = Math.max(0, v.seekable.end(v.seekable.length - 1) - (v.currentTime || 0)); } catch { /* noop */ }
    this.set({
      currentTime: v.currentTime || 0, duration: Number.isFinite(v.duration) ? v.duration : 0, live, seekable, behindLiveSec,
      muted: v.muted, volume: v.volume, rate: v.playbackRate, bufferedEnd, droppedFrames, totalFrames, subtitleTracks,
      resolution: v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : this.snap.resolution,
    });
  }
  private fail() {
    const err = this.video.error;
    if (!err) return;
    if (this.retries < 1 && this.currentUrl) { this.retries++; void this.load(this.currentUrl, { resetRetry: false }); return; }
    this.set({ state: 'error', error: mapPlaybackError({ code: err.code, message: err.message, url: this.currentUrl }) });
  }

  async load(rawUrl: string, opts: LoadOptions & { resetRetry?: boolean } = {}): Promise<void> {
    if (opts.resetRetry !== false) this.retries = 0;
    this.teardownAdapter();
    const url = normalizeStreamUrl(rawUrl);
    this.currentUrl = url;
    const format: StreamFormat = formatOf(url, opts.forcedFormat);
    this.set({ state: 'loading', error: null, engine: format.toUpperCase(), format, qualities: [], qualityId: 'auto', currentQualityLabel: 'Auto', audioTracks: [], audioId: '', audioLabel: 'Default', subtitleTracks: [{ id: 'off', label: 'Off' }], subtitleId: 'off', currentTime: 0, duration: 0, resolution: '—', bitrateKbps: 0 });
    if (format === 'unsupported') { this.set({ state: 'error', error: mapPlaybackError({ url, format }) }); return; }
    try {
      const nativeHls = format === 'hls' && this.video.canPlayType('application/vnd.apple.mpegurl') !== '';
      if (format === 'hls' && !nativeHls) await this.loadHls(url);
      else if (format === 'dash') await this.loadDash(url, opts);
      else if (format === 'mpegts' || format === 'flv') await this.loadTs(url, format);
      else { this.video.preload = 'auto'; this.video.src = url; this.video.load(); }
    } catch (e) {
      const errObj = e as { code?: number; message?: string } | null;
      const shakaCode = typeof errObj?.code === 'number' ? errObj.code : undefined;
      this.set({ state: 'error', error: mapPlaybackError({ shakaCode, message: e instanceof Error ? e.message : errObj?.message, url }) });
    }
  }

  private async loadHls(url: string): Promise<void> {
    const mod = await import('hls.js');
    const HlsCtor = mod.default;
    if (!HlsCtor.isSupported()) { this.set({ state: 'error', error: mapPlaybackError({ message: 'format not supported', url }) }); return; }
    const hls = new HlsCtor({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 30, maxMaxBufferLength: 60, fragLoadingMaxRetry: 4, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 4 });
    this.hls = hls;
    const syncTracks = () => {
      if (!this.hls) return;
      const qualities: QualityOption[] = [{ id: 'auto', label: 'Auto' }, ...hls.levels.map((l, i) => ({ id: String(i), label: `${l.height ? `${l.height}p` : `Level ${i + 1}`}${l.bitrate ? ` · ${Math.round(l.bitrate / 1000)}k` : ''}`, height: l.height, bitrate: l.bitrate }))];
      const audioTracks: TrackOption[] = (hls.audioTracks ?? []).map((t, i) => ({ id: String(i), label: t.name || t.lang || `Audio ${i + 1}`, lang: t.lang }));
      const subtitleTracks: TrackOption[] = [{ id: 'off', label: 'Off' }, ...(hls.subtitleTracks ?? []).map((t, i) => ({ id: `hls-${i}`, label: t.name || t.lang || `Subtitle ${i + 1}`, lang: t.lang }))];
      const audioLabel = audioTracks.find((t) => t.id === String(hls.audioTrack))?.label ?? this.snap.audioLabel;
      this.set({ qualities, audioTracks, audioLabel, audioId: hls.audioTrack >= 0 ? String(hls.audioTrack) : this.snap.audioId, subtitleTracks: subtitleTracks.length > 1 ? subtitleTracks : this.snap.subtitleTracks });
    };
    hls.on(HlsCtor.Events.MANIFEST_PARSED, syncTracks);
    hls.on(HlsCtor.Events.AUDIO_TRACKS_UPDATED, syncTracks);
    hls.on(HlsCtor.Events.SUBTITLE_TRACKS_UPDATED, syncTracks);
    hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, data) => {
      const lvl = hls.levels[data.level];
      this.set({ bitrateKbps: lvl?.bitrate ? Math.round(lvl.bitrate / 1000) : this.snap.bitrateKbps, currentQualityLabel: this.snap.qualityId === 'auto' ? `Auto${lvl?.height ? ` · ${lvl.height}p` : ''}` : this.snap.currentQualityLabel });
    });
    hls.on(HlsCtor.Events.AUDIO_TRACK_SWITCHED, (_e, data) => { const t = (hls.audioTracks ?? [])[data.id]; this.set({ audioId: String(data.id), audioLabel: t?.name || t?.lang || `Audio ${data.id + 1}` }); });
    let networkRecoveries = 0; let mediaRecoveries = 0;
    hls.on(HlsCtor.Events.ERROR, (_e, data) => {
      if (!data.fatal) { if (data.details === HlsCtor.ErrorDetails.BUFFER_STALLED_ERROR && mediaRecoveries < 2) { mediaRecoveries++; hls.recoverMediaError(); } return; }
      if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && networkRecoveries < 2) { networkRecoveries++; hls.startLoad(); return; }
      if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) { mediaRecoveries++; hls.recoverMediaError(); return; }
      this.set({ state: 'error', error: mapPlaybackError({ message: data.details, url, detailCode: `HLS ${data.type}: ${data.details}` }) });
    });
    hls.attachMedia(this.video);
    hls.on(HlsCtor.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
  }

  private async loadDash(url: string, opts: LoadOptions): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('shaka-player/dist/shaka-player.compiled');
    const shaka = mod.default ?? mod;
    shaka.polyfill.installAll();
    if (!shaka.isBrowserSupported()) { this.set({ state: 'error', error: mapPlaybackError({ message: 'format not supported', url }) }); return; }
    const player = new shaka.Player();
    this.shakaPlayer = player;
    await player.attach(this.video);
    player.configure({ streaming: { bufferingGoal: 24, rebufferingGoal: 2, lowLatencyMode: true }, abr: { enabled: true } });
    // Legitimate, user-supplied DRM configuration (provider-issued keys/licence server).
    if (opts.clearKeys && Object.keys(opts.clearKeys).length) player.configure({ drm: { clearKeys: opts.clearKeys } });
    if (opts.licenseUrl) player.configure({ drm: { servers: { 'com.widevine.alpha': opts.licenseUrl } } });
    const syncDash = () => {
      try {
        const variants = (player.getVariantTracks() as { id: number; height?: number; bandwidth?: number; active: boolean; audioLanguage?: string }[]) ?? [];
        const seen = new Set<number>();
        const qualities: QualityOption[] = [{ id: 'auto', label: 'Auto' }];
        for (const v of variants) { if (v.height && !seen.has(v.height)) { seen.add(v.height); qualities.push({ id: `h-${v.height}`, label: `${v.height}p${v.bandwidth ? ` · ${Math.round(v.bandwidth / 1000)}k` : ''}`, height: v.height, bitrate: v.bandwidth }); } }
        qualities.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
        const langs = (player.getAudioLanguagesAndRoles?.() as { language: string }[] | string[]) ?? [];
        const audioTracks: TrackOption[] = [];
        const seenLang = new Set<string>();
        for (const l of langs) { const lang = typeof l === 'string' ? l : l.language; if (!seenLang.has(lang)) { seenLang.add(lang); audioTracks.push({ id: lang, label: lang, lang }); } }
        const active = variants.find((v) => v.active);
        const stats = player.getStats?.() as { streamBandwidth?: number } | undefined;
        this.set({
          qualities, audioTracks,
          audioLabel: active?.audioLanguage ?? this.snap.audioLabel,
          bitrateKbps: stats?.streamBandwidth ? Math.round(stats.streamBandwidth / 1000) : active?.bandwidth ? Math.round(active.bandwidth / 1000) : this.snap.bitrateKbps,
          currentQualityLabel: this.snap.qualityId === 'auto' ? `Auto${active?.height ? ` · ${active.height}p` : ''}` : this.snap.currentQualityLabel,
        });
      } catch { /* tearing down */ }
    };
    player.addEventListener('variantchanged', syncDash);
    player.addEventListener('trackschanged', syncDash);
    player.addEventListener('adaptation', syncDash);
    player.addEventListener('error', (ev: Event) => {
      const detail = (ev as CustomEvent<{ code?: number; message?: string }>).detail;
      const code = typeof detail?.code === 'number' ? detail.code : undefined;
      this.set({ state: 'error', error: mapPlaybackError({ shakaCode: code, message: detail?.message, url }) });
    });
    await player.load(url);
    syncDash();
  }

  /** MPEG-TS / FLV via mpegts.js — yehi woh engine hai jo .ts live channels browser mein chalata hai. */
  private async loadTs(url: string, format: 'mpegts' | 'flv'): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('mpegts.js');
    const Mpegts = mod.default ?? mod;
    if (!Mpegts.isSupported()) { this.set({ state: 'error', error: mapPlaybackError({ message: 'format not supported', url }) }); return; }
    const player = Mpegts.createPlayer({ type: format === 'flv' ? 'flv' : 'mpegts', isLive: true, url }, { enableWorker: true, enableStashBuffer: false, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 8, liveBufferLatencyMinRemain: 2 });
    this.tsPlayer = player;
    player.on(Mpegts.Events.ERROR, () => {
      if (this.retries < 1) { this.retries++; void this.load(url, { resetRetry: false }); return; }
      this.set({ state: 'error', error: mapPlaybackError({ message: 'network', url }) });
    });
    player.attachMediaElement(this.video);
    player.load();
    this.set({ engine: format === 'flv' ? 'FLV · mpegts.js' : 'MPEG-TS · mpegts.js', qualities: [{ id: 'auto', label: 'Auto (single rendition)' }], currentQualityLabel: 'Auto' });
  }

  play(): void { void this.video.play().catch(() => { /* policy */ }); }
  pause(): void { this.video.pause(); }
  togglePlay(): void { this.video.paused ? this.play() : this.pause(); }
  seek(t: number): void { if (this.snap.seekable) { try { this.video.currentTime = Math.max(0, t); } catch { /* live edge */ } } }
  seekBy(delta: number): void { if (this.snap.seekable) this.seek(this.video.currentTime + delta); else if (this.tsPlayer) { try { this.video.currentTime = Math.max(0, this.video.currentTime + delta); } catch { /* live TS edge */ } } }
  /** Jump to the live edge for DVR-capable live streams. */
  goLive(): void {
    try {
      const v = this.video;
      if (v.seekable.length) { v.currentTime = v.seekable.end(v.seekable.length - 1); return; }
      if (v.buffered.length) v.currentTime = v.buffered.end(v.buffered.length - 1);
    } catch { /* noop */ }
  }
  behindLiveEdgeSec(): number {
    try {
      const v = this.video;
      if (!v.seekable.length) return 0;
      return Math.max(0, v.seekable.end(v.seekable.length - 1) - v.currentTime);
    } catch { return 0; }
  }
  setVolume(v: number): void { this.video.volume = Math.min(1, Math.max(0, v)); if (v > 0) this.video.muted = false; this.emit(); }
  toggleMute(): void { this.video.muted = !this.video.muted; this.emit(); }
  setRate(r: number): void { this.video.playbackRate = r; this.emit(); }

  setQuality(id: string): void {
    this.set({ qualityId: id, currentQualityLabel: id === 'auto' ? 'Auto' : this.snap.qualities.find((q) => q.id === id)?.label ?? id });
    if (this.hls) { this.hls.currentLevel = id === 'auto' ? -1 : Number(id); if (id === 'auto') this.hls.nextLevel = -1; return; }
    if (this.shakaPlayer) {
      try {
        if (id === 'auto') { this.shakaPlayer.configure({ abr: { enabled: true } }); return; }
        const height = Number(id.replace('h-', ''));
        const variants = (this.shakaPlayer.getVariantTracks() as { id: number; height?: number; bandwidth?: number }[]) ?? [];
        const best = variants.filter((v) => v.height === height).sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
        if (best) { this.shakaPlayer.configure({ abr: { enabled: false } }); this.shakaPlayer.selectVariantTrack(best, true); }
      } catch { /* noop */ }
    }
  }

  setAudio(id: string): void {
    const label = this.snap.audioTracks.find((t) => t.id === id)?.label;
    this.set({ audioId: id, audioLabel: label ?? this.snap.audioLabel });
    if (this.hls) { const idx = Number(id); if (Number.isFinite(idx)) this.hls.audioTrack = idx; return; }
    if (this.shakaPlayer) { try { this.shakaPlayer.selectAudioLanguage(id); } catch { /* noop */ } return; }
    const native = (this.video as unknown as { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }).audioTracks;
    if (native) for (let i = 0; i < native.length; i++) native[i].enabled = String(i) === id;
  }

  setSubtitle(id: string): void {
    this.set({ subtitleId: id });
    if (this.hls) this.hls.subtitleTrack = id === 'off' ? -1 : Number(id.replace('hls-', ''));
    if (this.shakaPlayer) {
      try {
        const tracks = (this.shakaPlayer.getTextTracks() as { id: number }[]) ?? [];
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
    if (this.tsPlayer) { try { this.tsPlayer.destroy(); } catch { /* noop */ } this.tsPlayer = null; }
    if (this.video.getAttribute('src')) { this.video.removeAttribute('src'); try { this.video.load(); } catch { /* noop */ } }
  }
  destroy(): void { this.destroyed = true; this.teardownAdapter(); this.bound.forEach(([n, f]) => this.video.removeEventListener(n, f)); this.bound = []; this.listeners.clear(); }
}
