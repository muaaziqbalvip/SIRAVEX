import type Hls from 'hls.js';
import { formatOf, type StreamFormat } from './capabilities/capabilities';
import { isShakaCritical, mapPlaybackError, type PlaybackErrorInfo } from './errors/mapper';
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
type AdapterKind = 'none' | 'hls' | 'shaka' | 'ts' | 'native';

/**
 * PlaybackEngine v4 — universal format coverage:
 *  HLS (.m3u8) HLS.js / native Safari · DASH (.mpd incl. ?auth=&q=auto) Shaka
 *  MPEG-TS (.ts) + FLV (.flv) mpegts.js (MSE) · MP4/WebM/MOV/MKV native.
 *  Optional user-supplied ClearKey / Widevine config for DASH (provider-issued
 *  keys only — configured into Shaka EME, never extracted or bypassed).
 *
 * v4 audit fixes (har bug runtime par confirm ki gayi thi):
 *  1. LOAD RACE: channel tezzi se badalne par purana slow load naya channel
 *     hijack kar leta tha → har load ka generation number; purana load state
 *     ya adapter kabhi apply nahi karta.
 *  2. SHAKA "har cheez error": Shaka RECOVERABLE errors (jo woh khud retry
 *     karta hai) bhi error screen khol dete thay → sirf CRITICAL error par
 *     error state.
 *  3. SUBTITLE KILLER: setSubtitle hls + shaka + raw textTracks teeno ko
 *     chalata tha; hls wala pick (id `hls-N`) akhir mein saare text tracks
 *     disable kar deti thi → ab handling sirf ACTIVE engine ki hoti hai.
 *  4. DASH subtitles panel mein aate hi nahi thay (Shaka text tracks video
 *     element mein selected hone se pehle nazar nahi aate) → getTextTracks()
 *     se list publish hoti hai, select bhi wahin se.
 *  5. Native <video> 'error' event adapter teardown ke waqt full reload
 *     loop bana deta tha → video-error sirf native playback par handle hota.
 *  6. VOD par bhi LIVE badge: duration NaN ko live samajhna band;
 *     live sirf duration === Infinity.
 *  7. Safari/iPhone par audio panel khaali: native audioTracks publish.
 *  8. Forced format (Play Stream) par Xtream .ts→.m3u8 rewrite ab URL ko
 *     kharab nahi karta.
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
  private loadSeq = 0;
  private adapter: AdapterKind = 'none';
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
  private isCurrent(seq: number): boolean { return !this.destroyed && seq === this.loadSeq; }

  /** External subtitle file ke text-track indices (sirf <track data-siravex-ext> wale). */
  private externalTrackIndices(): Set<number> {
    const out = new Set<number>();
    const tracks = this.video.textTracks;
    this.video.querySelectorAll('track[data-siravex-ext]').forEach((el) => {
      const tt = (el as HTMLTrackElement).track;
      for (let i = 0; i < tracks.length; i++) if (tracks[i] === tt) out.add(i);
    });
    return out;
  }

  private emit() {
    const v = this.video;
    // LIVE sirf jab duration Infinity ho. NaN (metadata se pehle) live NAHI hai —
    // pehle VOD items par bhi LIVE badge aur chhupa hua seek bar aata tha.
    const live = v.duration === Infinity;
    let seekable = false;
    try { seekable = v.seekable.length > 0 && v.seekable.end(0) - v.seekable.start(0) > 1; } catch { seekable = false; }
    let bufferedEnd = 0;
    try { if (v.buffered.length) bufferedEnd = v.buffered.end(v.buffered.length - 1); } catch { /* noop */ }
    let droppedFrames = this.snap.droppedFrames; let totalFrames = this.snap.totalFrames;
    try { const q = (v as HTMLVideoElement & { getVideoPlaybackQuality?: () => { droppedVideoFrames: number; totalVideoFrames: number } }).getVideoPlaybackQuality?.(); if (q) { droppedFrames = q.droppedVideoFrames; totalFrames = q.totalVideoFrames; } } catch { /* noop */ }
    // Subtitle list ki ownership: HLS/Shaka apni list khud publish karte hain
    // (ids hls-N / shaka-<id>). Emit un par textTracks index wali list kabhi
    // overwrite nahi karega — sirf external file wale tracks merge honge.
    const extIdx = this.externalTrackIndices();
    let subtitleTracks: TrackOption[];
    if (this.adapter === 'hls' || this.adapter === 'shaka') {
      const base = this.snap.subtitleTracks.filter((t) => !t.id.startsWith('ext:'));
      const ext: TrackOption[] = [];
      for (let i = 0; i < v.textTracks.length; i++) if (extIdx.has(i)) ext.push({ id: `ext:${i}`, label: v.textTracks[i].label || 'Subtitle file', lang: v.textTracks[i].language });
      subtitleTracks = [...base, ...ext];
      if (!subtitleTracks.some((t) => t.id === 'off')) subtitleTracks = [{ id: 'off', label: 'Off' }, ...subtitleTracks];
    } else {
      const subs: TrackOption[] = [{ id: 'off', label: 'Off' }];
      const seen = new Set<string>();
      for (let i = 0; i < v.textTracks.length; i++) {
        const t = v.textTracks[i];
        if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
        const label = t.label || t.language || `Subtitle ${i + 1}`;
        if (seen.has(label)) continue; seen.add(label);
        subs.push({ id: extIdx.has(i) ? `ext:${i}` : String(i), label, lang: t.language });
      }
      subtitleTracks = subs;
    }
    // Safari native HLS: audio renditions video.audioTracks se (MSE engines apni list dete hain).
    let audioTracks = this.snap.audioTracks; let audioLabel = this.snap.audioLabel; let audioId = this.snap.audioId;
    if (this.adapter === 'native') {
      const nat = (v as unknown as { audioTracks?: { length: number; [i: number]: { label?: string; language?: string; enabled: boolean } } }).audioTracks;
      if (nat && nat.length > 0) {
        audioTracks = [];
        for (let i = 0; i < nat.length; i++) { audioTracks.push({ id: `nat-${i}`, label: nat[i].label || nat[i].language || `Audio ${i + 1}`, lang: nat[i].language }); if (nat[i].enabled) { audioId = `nat-${i}`; audioLabel = audioTracks[i].label; } }
      }
    }
    let behindLiveSec = 0;
    try { if (v.seekable.length) behindLiveSec = Math.max(0, v.seekable.end(v.seekable.length - 1) - (v.currentTime || 0)); } catch { /* noop */ }
    this.set({
      currentTime: v.currentTime || 0, duration: Number.isFinite(v.duration) ? v.duration : 0, live, seekable, behindLiveSec,
      muted: v.muted, volume: v.volume, rate: v.playbackRate, bufferedEnd, droppedFrames, totalFrames, subtitleTracks,
      audioTracks, audioLabel, audioId,
      resolution: v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : this.snap.resolution,
    });
  }

  private fail() {
    // <video> error events MSE adapters (HLS/Shaka/TS) ke teardown par bhi
    // fire hote hain. Unko yahan handle karna full-reload loop banata tha —
    // adapters apni errors khud report karte hain; yeh sirf native ke liye hai.
    if (this.destroyed || this.adapter !== 'native') return;
    const err = this.video.error;
    if (!err) return;
    if (this.retries < 1 && this.currentUrl) { this.retries++; void this.load(this.currentUrl, { resetRetry: false }); return; }
    this.set({ state: 'error', error: mapPlaybackError({ code: err.code, message: err.message, url: this.currentUrl }) });
  }

  async load(rawUrl: string, opts: LoadOptions & { resetRetry?: boolean } = {}): Promise<void> {
    const seq = ++this.loadSeq;
    if (opts.resetRetry !== false) this.retries = 0;
    this.teardownAdapter();
    if (!this.isCurrent(seq)) return;
    // Forced format ka matlab: user ne khud kaha hai ye .ts hai — Xtream
    // .ts->.m3u8 rewrite yahan URL kharab kar deta tha, is liye skip.
    const url = opts.forcedFormat && opts.forcedFormat !== 'auto' ? rawUrl : normalizeStreamUrl(rawUrl);
    this.currentUrl = url;
    const format: StreamFormat = formatOf(url, opts.forcedFormat);
    this.adapter = format === 'hls' ? 'hls' : format === 'dash' ? 'shaka' : format === 'mpegts' || format === 'flv' ? 'ts' : 'native';
    this.set({ state: 'loading', error: null, engine: format.toUpperCase(), format, qualities: [], qualityId: 'auto', currentQualityLabel: 'Auto', audioTracks: [], audioId: '', audioLabel: 'Default', subtitleTracks: [{ id: 'off', label: 'Off' }], subtitleId: 'off', currentTime: 0, duration: 0, resolution: '—', bitrateKbps: 0 });
    if (format === 'unsupported') { this.set({ state: 'error', error: mapPlaybackError({ url, format }) }); return; }
    try {
      const nativeHls = format === 'hls' && this.video.canPlayType('application/vnd.apple.mpegurl') !== '';
      if (format === 'hls' && !nativeHls) await this.loadHls(url, seq);
      else if (format === 'dash') await this.loadDash(url, opts, seq);
      else if (format === 'mpegts' || format === 'flv') await this.loadTs(url, format, seq);
      else {
        this.set({ engine: nativeHls ? 'Native (Safari)' : 'Native' });
        this.video.preload = 'auto'; this.video.src = url; this.video.load();
      }
    } catch (e) {
      if (!this.isCurrent(seq)) return; // purana load — naya channel chal raha hai, iski error mat dikhao
      const errObj = e as { code?: number; message?: string } | null;
      const shakaCode = typeof errObj?.code === 'number' ? errObj.code : undefined;
      this.set({ state: 'error', error: mapPlaybackError({ shakaCode, message: e instanceof Error ? e.message : errObj?.message, url }) });
    }
  }

  private async loadHls(url: string, seq: number): Promise<void> {
    const mod = await import('hls.js');
    if (!this.isCurrent(seq)) return;
    const HlsCtor = mod.default;
    if (!HlsCtor.isSupported()) { this.set({ state: 'error', error: mapPlaybackError({ message: 'format not supported', url }) }); return; }
    const hls = new HlsCtor({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 30, maxMaxBufferLength: 60, fragLoadingMaxRetry: 4, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 4 });
    this.hls = hls;
    this.set({ engine: 'HLS.js' });
    const syncTracks = () => {
      if (!this.isCurrent(seq) || this.hls !== hls) return;
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
      if (!this.isCurrent(seq)) return;
      const lvl = hls.levels[data.level];
      // Agar hls.js ne manual quality par error ke baad khud Auto par wapas
      // kar diya ho, to UI bhi sach bole (label Auto, lock hata).
      const fellBackToAuto = hls.manualLevel === -1 && this.snap.qualityId !== 'auto';
      this.set({
        bitrateKbps: lvl?.bitrate ? Math.round(lvl.bitrate / 1000) : this.snap.bitrateKbps,
        ...(fellBackToAuto ? { qualityId: 'auto', currentQualityLabel: `Auto${lvl?.height ? ` · ${lvl.height}p` : ''}` } : { currentQualityLabel: this.snap.qualityId === 'auto' ? `Auto${lvl?.height ? ` · ${lvl.height}p` : ''}` : this.snap.currentQualityLabel }),
      });
    });
    hls.on(HlsCtor.Events.AUDIO_TRACK_SWITCHED, (_e, data) => { if (!this.isCurrent(seq)) return; const t = (hls.audioTracks ?? [])[data.id]; this.set({ audioId: String(data.id), audioLabel: t?.name || t?.lang || `Audio ${data.id + 1}` }); });
    let networkRecoveries = 0; let mediaRecoveries = 0;
    hls.on(HlsCtor.Events.ERROR, (_e, data) => {
      if (!this.isCurrent(seq)) return;
      if (!data.fatal) { if (data.details === HlsCtor.ErrorDetails.BUFFER_STALLED_ERROR && mediaRecoveries < 2) { mediaRecoveries++; hls.recoverMediaError(); } return; }
      if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && networkRecoveries < 2) { networkRecoveries++; hls.startLoad(); return; }
      if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) { mediaRecoveries++; hls.recoverMediaError(); return; }
      this.set({ state: 'error', error: mapPlaybackError({ message: data.details, url, detailCode: `HLS ${data.type}: ${data.details}` }) });
    });
    hls.attachMedia(this.video);
    hls.on(HlsCtor.Events.MEDIA_ATTACHED, () => { if (this.isCurrent(seq) && this.hls === hls) hls.loadSource(url); });
  }

  private async loadDash(url: string, opts: LoadOptions, seq: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('shaka-player/dist/shaka-player.compiled');
    if (!this.isCurrent(seq)) return;
    const shaka = mod.default ?? mod;
    shaka.polyfill.installAll();
    if (!shaka.isBrowserSupported()) { this.set({ state: 'error', error: mapPlaybackError({ message: 'format not supported', url }) }); return; }
    const player = new shaka.Player();
    this.shakaPlayer = player;
    await player.attach(this.video);
    if (!this.isCurrent(seq)) { try { await player.destroy(); } catch { /* noop */ } return; }
    this.set({ engine: 'Shaka' });
    player.configure({ streaming: { bufferingGoal: 24, rebufferingGoal: 2, lowLatencyMode: true }, abr: { enabled: true } });
    // Legitimate, user-supplied DRM configuration (provider-issued keys/licence server).
    if (opts.clearKeys && Object.keys(opts.clearKeys).length) player.configure({ drm: { clearKeys: opts.clearKeys } });
    if (opts.licenseUrl) player.configure({ drm: { servers: { 'com.widevine.alpha': opts.licenseUrl } } });
    const syncDash = () => {
      if (!this.isCurrent(seq) || this.shakaPlayer !== player) return;
      try {
        const variants = (player.getVariantTracks() as { id: number; height?: number; bandwidth?: number; active: boolean; audioLanguage?: string; audioRoles?: string[] }[]) ?? [];
        const seen = new Set<number>();
        const qualities: QualityOption[] = [{ id: 'auto', label: 'Auto' }];
        for (const v of variants) { if (v.height && !seen.has(v.height)) { seen.add(v.height); qualities.push({ id: `h-${v.height}`, label: `${v.height}p${v.bandwidth ? ` · ${Math.round(v.bandwidth / 1000)}k` : ''}`, height: v.height, bitrate: v.bandwidth }); } }
        qualities.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
        // Audio: language + role — aik hi language ke kai roles ho sakte hain,
        // id mein role bhi hai taake selectAudioLanguage durust variant chune.
        const langs = (player.getAudioLanguagesAndRoles?.() as { language: string; role?: string }[]) ?? [];
        const audioTracks: TrackOption[] = [];
        const seenAud = new Set<string>();
        for (const l of langs) { const id = `${l.language}|${l.role ?? ''}`; if (!seenAud.has(id)) { seenAud.add(id); audioTracks.push({ id, label: l.role ? `${l.language} · ${l.role}` : l.language, lang: l.language }); } }
        // Subtitles: Shaka text tracks video.textTracks mein select hone se
        // pehle nazar nahi aate — panel ke liye yehi asal source hai.
        const textTracks = (player.getTextTracks?.() as { id: number; language?: string; label?: string; kind?: string }[]) ?? [];
        const subtitleTracks: TrackOption[] = [{ id: 'off', label: 'Off' }, ...textTracks.filter((t) => t.kind !== 'forced').map((t) => ({ id: `shaka-${t.id}`, label: t.label || t.language || 'Subtitle', lang: t.language }))];
        const active = variants.find((v) => v.active);
        const activeAud = active ? audioTracks.find((t) => t.lang === active.audioLanguage) : undefined;
        const stats = player.getStats?.() as { streamBandwidth?: number } | undefined;
        this.set({
          qualities, audioTracks, subtitleTracks,
          audioId: activeAud?.id ?? this.snap.audioId,
          audioLabel: activeAud?.label ?? active?.audioLanguage ?? this.snap.audioLabel,
          bitrateKbps: stats?.streamBandwidth ? Math.round(stats.streamBandwidth / 1000) : active?.bandwidth ? Math.round(active.bandwidth / 1000) : this.snap.bitrateKbps,
          currentQualityLabel: this.snap.qualityId === 'auto' ? `Auto${active?.height ? ` · ${active.height}p` : ''}` : this.snap.currentQualityLabel,
        });
      } catch { /* tearing down */ }
    };
    player.addEventListener('variantchanged', syncDash);
    player.addEventListener('trackschanged', syncDash);
    player.addEventListener('adaptation', syncDash);
    player.addEventListener('texttrackvisibility', syncDash);
    player.addEventListener('error', (ev: Event) => {
      if (!this.isCurrent(seq)) return;
      const detail = (ev as CustomEvent<{ code?: number; message?: string; severity?: number }>).detail;
      // Shaka RECOVERABLE errors khud retry karta hai — un par error screen
      // kholna "har cheez error hai" wali shikayat ki asal wajah thi.
      if (!isShakaCritical(detail)) return;
      const code = typeof detail?.code === 'number' ? detail.code : undefined;
      this.set({ state: 'error', error: mapPlaybackError({ shakaCode: code, message: detail?.message, url }) });
    });
    await player.load(url);
    if (!this.isCurrent(seq)) return;
    syncDash();
  }

  /** MPEG-TS / FLV via mpegts.js — yehi woh engine hai jo .ts live channels browser mein chalata hai. */
  private async loadTs(url: string, format: 'mpegts' | 'flv', seq: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('mpegts.js');
    if (!this.isCurrent(seq)) return;
    const Mpegts = mod.default ?? mod;
    if (!Mpegts.isSupported()) { this.set({ state: 'error', error: mapPlaybackError({ message: 'format not supported', url }) }); return; }
    const player = Mpegts.createPlayer({ type: format === 'flv' ? 'flv' : 'mpegts', isLive: true, url }, { enableWorker: true, enableStashBuffer: false, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 8, liveBufferLatencyMinRemain: 2 });
    this.tsPlayer = player;
    player.on(Mpegts.Events.ERROR, () => {
      if (!this.isCurrent(seq)) return;
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
    if (this.hls) {
      // hls.js: currentLevel = manualLevel (ABR band). Auto par -1 wapas.
      this.hls.currentLevel = id === 'auto' ? -1 : Number(id);
      if (id === 'auto') this.hls.nextLevel = -1;
      return;
    }
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
    if (this.shakaPlayer) {
      try { const [lang, role] = id.split('|'); this.shakaPlayer.selectAudioLanguage(lang, role || undefined); } catch { /* noop */ }
      return;
    }
    const native = (this.video as unknown as { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }).audioTracks;
    if (native) { const want = id.replace('nat-', ''); for (let i = 0; i < native.length; i++) native[i].enabled = String(i) === want; }
    this.emit();
  }

  private disableExternalTracks(except = -1): void {
    const ext = this.externalTrackIndices();
    for (let i = 0; i < this.video.textTracks.length; i++) if (ext.has(i) && i !== except) this.video.textTracks[i].mode = 'disabled';
  }

  /**
   * Subtitle selection — SIRF active engine handle karta hai. Pehle teeno
   * handlers aik saath chalte thay aur textTracks wala loop HLS/Shaka ke
   * select kiye hue track ko foran disable kar deta tha (subs kabhi on hi
   * nahi hote thay).
   */
  setSubtitle(id: string): void {
    this.set({ subtitleId: id });
    if (id.startsWith('ext:')) { this.showExternalSubtitle(Number(id.slice(4))); return; }
    this.disableExternalTracks();
    if (this.adapter === 'hls' && this.hls) { this.hls.subtitleTrack = id === 'off' ? -1 : Number(id.replace('hls-', '')); return; }
    if (this.adapter === 'shaka' && this.shakaPlayer) {
      try {
        if (id === 'off') this.shakaPlayer.setTextTrackVisibility(false);
        else {
          const tracks = (this.shakaPlayer.getTextTracks() as { id: number }[]) ?? [];
          const match = tracks.find((t) => `shaka-${t.id}` === id);
          if (match) { this.shakaPlayer.selectTextTrack(match); this.shakaPlayer.setTextTrackVisibility(true); }
        }
      } catch { /* noop */ }
      return;
    }
    for (let i = 0; i < this.video.textTracks.length; i++) this.video.textTracks[i].mode = id === String(i) ? 'showing' : 'disabled';
    this.emit();
  }

  /** PlayerShell ki load ki hui .srt/.vtt file ko dikhao (engine subs band karke). */
  showExternalSubtitle(index: number): void {
    if (this.adapter === 'hls' && this.hls) this.hls.subtitleTrack = -1;
    if (this.adapter === 'shaka' && this.shakaPlayer) { try { this.shakaPlayer.setTextTrackVisibility(false); } catch { /* noop */ } }
    for (let i = 0; i < this.video.textTracks.length; i++) this.video.textTracks[i].mode = i === index ? 'showing' : 'disabled';
    this.set({ subtitleId: `ext:${index}` });
    this.emit();
  }

  retry(): void { if (this.currentUrl) void this.load(this.currentUrl); }
  private teardownAdapter() {
    try { this.hls?.destroy(); } catch { /* noop */ } this.hls = null;
    if (this.shakaPlayer) { const p = this.shakaPlayer; this.shakaPlayer = null; void Promise.resolve(p.destroy?.()).catch(() => undefined); }
    if (this.tsPlayer) { try { this.tsPlayer.destroy(); } catch { /* noop */ } this.tsPlayer = null; }
    if (this.video.getAttribute('src')) { this.video.removeAttribute('src'); try { this.video.load(); } catch { /* noop */ } }
  }
  destroy(): void { this.destroyed = true; this.loadSeq++; this.teardownAdapter(); this.bound.forEach(([n, f]) => this.video.removeEventListener(n, f)); this.bound = []; this.listeners.clear(); }
}
