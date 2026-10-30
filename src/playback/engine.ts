import type Hls from 'hls.js';
import { formatOf, type StreamFormat } from './capabilities/capabilities';
import { isShakaCritical, mapPlaybackError, type PlaybackErrorInfo } from './errors/mapper';
import { normalizeStreamUrl } from '@/lib/security';
import { parseClearKeys } from '@/lib/clearkey';
import { buildCandidates, type SourceCandidate } from '@/lib/candidates';
import {
  buildDashAudioOptions,
  buildDashQualityOptions,
  buildHlsAudioOptions,
  buildHlsQualityOptions,
  humanLanguageName,
  isAudioCodecSupported,
  languageMatches,
  type QualityOption,
  type RawHlsAudioTrack,
  type RawShakaAudioTrack,
  type RawShakaVariant,
  type RawShakaVideoTrack,
  type TrackOption,
} from './tracks';

export type { TrackOption, QualityOption };

export interface LoadOptions {
  forcedFormat?: string;
  clearKeys?: Record<string, string>;
  licenseUrl?: string;
  referrer?: string;
  autoplay?: boolean;
  isLiveHint?: boolean;
  preferredAudioLang?: string;
  preferredSubtitleLang?: string;
}

export interface PlayerSnapshot {
  state: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';
  currentTime: number; duration: number; seekable: boolean; live: boolean;
  muted: boolean; autoplayMuted: boolean; volume: number; rate: number; bufferedEnd: number;
  qualities: QualityOption[]; qualityId: string; currentQualityLabel: string;
  audioTracks: TrackOption[]; audioId: string; audioLabel: string;
  subtitleTracks: TrackOption[]; subtitleId: string;
  resolution: string; bitrateKbps: number; droppedFrames: number; totalFrames: number; behindLiveSec: number;
  error: PlaybackErrorInfo | null; engine: string; format: string;
  attempt: number; attempts: number;
  reconnecting: boolean; reconnectAttempt: number; maxReconnects: number;
  notice: string;
}

type Listener = (s: PlayerSnapshot) => void;
type HlsInstance = InstanceType<typeof Hls>;
type AdapterKind = 'none' | 'hls' | 'shaka' | 'ts' | 'native';

const MAX_AUTO_RECONNECTS = 4;
const RECONNECT_DELAYS_MS = [1000, 2200, 4500, 8000];

/**
 * Per-host route memory: remembers whether an IPTV host succeeded via `direct` or `relay`
 * (and which container format won) so channel #2, #3, #4… on the same server connect on
 * Attempt #1 in ~300ms with zero wasted CORS retries.
 */
interface HostRouteHint {
  via: 'direct' | 'relay';
  format: StreamFormat;
  at: number;
}
const HOST_HINT_TTL_MS = 45 * 60_000;
const hostRouteMemory = new Map<string, HostRouteHint>();

function hostKeyOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).origin.toLowerCase();
  } catch {
    return '';
  }
}

export function prioritizeCandidatesForHost(rawUrl: string, list: SourceCandidate[]): SourceCandidate[] {
  if (list.length <= 1) return list;
  const key = hostKeyOf(rawUrl);
  if (!key) return list;
  const hint = hostRouteMemory.get(key);
  if (!hint || Date.now() - hint.at > HOST_HINT_TTL_MS) return list;
  const exactIdx = list.findIndex((c) => c.via === hint.via && c.format === hint.format);
  const viaIdx = exactIdx >= 0 ? exactIdx : list.findIndex((c) => c.via === hint.via);
  if (viaIdx <= 0) return list;
  const copy = [...list];
  const [winner] = copy.splice(viaIdx, 1);
  return [winner, ...copy];
}

export function clearHostRouteMemory(): void {
  hostRouteMemory.clear();
}

let hlsModulePromise: Promise<typeof import('hls.js')> | null = null;
let mpegtsModulePromise: Promise<unknown> | null = null;

function getHlsModule(): Promise<typeof import('hls.js')> {
  if (!hlsModulePromise) {
    hlsModulePromise = import('hls.js').catch((err) => {
      hlsModulePromise = null;
      throw err;
    });
  }
  return hlsModulePromise;
}

function getMpegtsModule(): Promise<unknown> {
  if (!mpegtsModulePromise) {
    mpegtsModulePromise = import('mpegts.js').catch((err) => {
      mpegtsModulePromise = null;
      throw err;
    });
  }
  return mpegtsModulePromise;
}

let warmedEngines = false;
/** Pre-loads HLS.js & mpegts.js in background idle time so channel clicks have 0ms bundle delay. */
export function warmPlaybackEngines(): void {
  if (warmedEngines || typeof window === 'undefined') return;
  warmedEngines = true;
  const run = () => {
    void getHlsModule().catch(() => undefined);
    window.setTimeout(() => {
      void getMpegtsModule().catch(() => undefined);
    }, 500);
  };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (typeof ric === 'function') ric(run, { timeout: 1200 });
  else window.setTimeout(run, 150);
}

export const INITIAL_SNAPSHOT: PlayerSnapshot = {
  state: 'idle', currentTime: 0, duration: 0, seekable: false, live: false,
  muted: false, autoplayMuted: false, volume: 1, rate: 1, bufferedEnd: 0,
  qualities: [], qualityId: 'auto', currentQualityLabel: 'Auto',
  audioTracks: [], audioId: '', audioLabel: 'Default',
  subtitleTracks: [{ id: 'off', label: 'Off' }], subtitleId: 'off',
  resolution: '—', bitrateKbps: 0, droppedFrames: 0, totalFrames: 0, behindLiveSec: 0,
  error: null, engine: 'none', format: 'none',
  attempt: 1, attempts: 1,
  reconnecting: false, reconnectAttempt: 0, maxReconnects: MAX_AUTO_RECONNECTS,
  notice: '',
};

/**
 * PlaybackEngine v6 ("HyperSpeed") — Zero-Glitch Broadcast & VOD Media Engine:
 *  - Instant-Start HLS.js (`testBandwidth: false`, `startFragPrefetch: true`, `lowLatencyMode: false`,
 *    2.5 Mbps initial ABR estimate, zero destructive `recoverMediaError()` on transient stalls).
 *  - Smart Direct->Relay CORS Jump + `/api/relay?...&expect=hls` 80ms binary TS detection.
 *  - Silky 64 KB Stash-Buffered MPEG-TS / FLV (`mpegts.js` MSE worker).
 *  - Shaka 4.12 DASH with independent `selectVideoTrack()` / `selectAudioTrack()`.
 *  - 250ms UI emit throttling during `timeupdate`/`progress` to keep main thread 100% free for video decode.
 */
export class PlaybackEngine {
  private video: HTMLVideoElement;
  private hls: HlsInstance | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private shakaPlayer: any = null;
  private shakaVideoList: RawShakaVideoTrack[] = [];
  private shakaAudioList: RawShakaAudioTrack[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private tsPlayer: any = null;
  private listeners = new Set<Listener>();
  private bound: [string, EventListener][] = [];
  private winBound: [string, EventListener][] = [];
  private nativeAudioCleanup: (() => void) | null = null;
  private destroyed = false;
  private loadSeq = 0;
  private adapter: AdapterKind = 'none';
  private candidates: SourceCandidate[] = [];
  private triedIndices = new Set<number>();
  private candIdx = 0;
  private candOk = false;
  private winningCandIdx = 0;
  private watchdog: number | null = null;
  private reconnectTimer: number | null = null;
  private stallTimer: number | null = null;
  private emitTimer: number | null = null;
  private lastEmitAt = 0;
  private reconnectCount = 0;
  private lastMediaTime = -1;
  private lastMediaAdvanceAt = 0;
  private healthySince = 0;
  private wantPlay = true;
  private desiredVolume = 0.8;
  private nativeAudioPrefApplied = false;
  private lastOpts: LoadOptions = {};
  private primaryUrl = '';
  snap: PlayerSnapshot = { ...INITIAL_SNAPSHOT };
  currentUrl = '';

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.desiredVolume = video.volume || 0.8;
    const on = (name: string, fn: () => void) => {
      const f = fn as EventListener;
      video.addEventListener(name, f);
      this.bound.push([name, f]);
    };
    on('play', () => this.set({ state: 'playing' }));
    on('playing', () => {
      this.markCandidateOk();
      this.lastMediaAdvanceAt = Date.now();
      if (!this.healthySince) this.healthySince = Date.now();
      this.set({ state: 'playing', reconnecting: false });
      this.emit();
    });
    on('pause', () => {
      if (!this.snap.reconnecting && this.snap.state !== 'ended' && this.snap.state !== 'error') {
        this.set({ state: 'paused' });
      }
    });
    on('waiting', () => {
      if (this.snap.state !== 'error' && this.snap.state !== 'loading') {
        this.set({ state: 'buffering' });
      }
    });
    on('ended', () => {
      if (this.isLiveStream() && this.wantPlay && this.candOk) {
        this.scheduleLiveReconnect('Live stream interrupted — reconnecting…', this.loadSeq);
        return;
      }
      this.set({ state: 'ended' });
    });
    on('canplay', () => {
      this.markCandidateOk();
      if (this.snap.state === 'loading') this.set({ state: 'ready' });
      if (this.wantPlay && this.video.paused) this.safePlay();
      this.emit();
    });
    on('loadedmetadata', () => {
      if (this.wantPlay && this.adapter === 'native' && this.video.paused) this.safePlay();
      this.emit();
    });
    on('resize', () => this.emit());
    on('timeupdate', () => {
      const t = this.video.currentTime || 0;
      if (Math.abs(t - this.lastMediaTime) > 0.04) {
        this.lastMediaTime = t;
        this.lastMediaAdvanceAt = Date.now();
        if (this.healthySince && Date.now() - this.healthySince > 15000 && this.reconnectCount > 0) {
          this.reconnectCount = 0;
          if (this.snap.reconnectAttempt !== 0) this.set({ reconnectAttempt: 0 });
        }
      }
      this.emitThrottled();
    });
    on('durationchange', () => this.emit());
    on('volumechange', () => this.emit());
    on('ratechange', () => this.emit());
    on('progress', () => this.emitThrottled());
    on('error', () => this.fail());

    if (typeof window !== 'undefined') {
      const onOnline = () => {
        if (this.destroyed || !this.primaryUrl) return;
        if (this.snap.reconnecting || (this.snap.state === 'error' && this.snap.error?.retryable !== false)) {
          this.clearReconnectTimer();
          this.reconnectCount = 0;
          this.wantPlay = true;
          this.set({ notice: 'Connection restored — reconnecting stream…', reconnecting: true, reconnectAttempt: 1, error: null });
          void this.reconnectNow();
        }
      };
      window.addEventListener('online', onOnline);
      this.winBound.push(['online', onOnline]);
    }
    this.startStallGuardian();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  private set(p: Partial<PlayerSnapshot>) {
    if (this.destroyed) return;
    this.snap = { ...this.snap, ...p };
    this.listeners.forEach((f) => f(this.snap));
  }

  /** Throttles high-frequency timeupdate/progress UI snapshots to max 4/sec so video decode stays silky smooth. */
  private emitThrottled(): void {
    if (this.destroyed) return;
    const now = Date.now();
    const elapsed = now - this.lastEmitAt;
    if (elapsed >= 250) {
      if (this.emitTimer) { window.clearTimeout(this.emitTimer); this.emitTimer = null; }
      this.emit();
      return;
    }
    if (!this.emitTimer && typeof window !== 'undefined') {
      this.emitTimer = window.setTimeout(() => {
        this.emitTimer = null;
        if (!this.destroyed) this.emit();
      }, 250 - elapsed);
    }
  }

  private isCurrent(seq: number): boolean { return !this.destroyed && seq === this.loadSeq; }
  private isLiveStream(): boolean { return this.snap.live || Boolean(this.lastOpts.isLiveHint) || this.adapter === 'ts'; }

  private clearWatchdog(): void { if (this.watchdog) { window.clearTimeout(this.watchdog); this.watchdog = null; } }
  private clearReconnectTimer(): void { if (this.reconnectTimer) { window.clearTimeout(this.reconnectTimer); this.reconnectTimer = null; } }

  /**
   * Non-destructive live stall guardian:
   * - At 12s stall: nudges network loader (`hls.startLoad()`) or steps over tiny buffered gap WITHOUT destroying MediaSource!
   * - At 24s complete freeze: triggers clean auto-reconnect.
   */
  private startStallGuardian(): void {
    if (typeof window === 'undefined') return;
    this.stallTimer = window.setInterval(() => {
      if (this.destroyed || !this.wantPlay || !this.candOk || !this.isLiveStream()) return;
      if (this.video.paused || this.snap.state === 'error' || this.snap.reconnecting) return;
      if (!this.lastMediaAdvanceAt) return;
      const stalledMs = Date.now() - this.lastMediaAdvanceAt;
      if (stalledMs >= 24000) {
        this.lastMediaAdvanceAt = Date.now();
        this.scheduleLiveReconnect('Stream froze — auto-reconnecting…', this.loadSeq);
      } else if (stalledMs >= 12000) {
        if (this.hls) {
          try {
            this.hls.startLoad();
            const v = this.video;
            for (let i = 0; i < v.buffered.length; i++) {
              if (v.buffered.start(i) > v.currentTime + 0.1 && v.buffered.start(i) - v.currentTime < 6) {
                v.currentTime = v.buffered.start(i) + 0.05;
                break;
              }
            }
          } catch { /* noop */ }
        } else if (this.snap.behindLiveSec > 10) {
          this.goLive();
        }
      }
    }, 3000);
  }

  private markCandidateOk(): void {
    const cand = this.candidates[this.candIdx];
    if (!this.candOk) {
      this.candOk = true;
      this.winningCandIdx = this.candIdx;
      this.healthySince = Date.now();
      this.lastMediaAdvanceAt = Date.now();
      if (cand && this.primaryUrl) {
        const key = hostKeyOf(this.primaryUrl);
        if (key) hostRouteMemory.set(key, { via: cand.via, format: cand.format, at: Date.now() });
      }
    }
    this.clearWatchdog();
    if (cand?.via === 'relay' && !this.snap.engine.includes('Relay')) {
      this.set({ engine: `${this.snap.engine} · Relay` });
    }
  }

  /** Safe autoplay: tries unmuted play first; if browser blocks sound autoplay, starts muted + sets autoplayMuted banner. */
  private safePlay(): void {
    if (this.destroyed) return;
    const p = this.video.play();
    if (p && typeof p.catch === 'function') {
      p.catch((err: unknown) => {
        if (this.destroyed || !this.wantPlay) return;
        const name = (err as { name?: string } | null)?.name || '';
        if (name === 'AbortError') return;
        if (!this.video.muted) {
          this.desiredVolume = this.video.volume > 0 ? this.video.volume : this.desiredVolume || 0.8;
          this.video.muted = true;
          this.set({ muted: true, autoplayMuted: true });
          this.video.play().catch(() => { /* user tap will start */ });
        }
      });
    }
  }

  private scheduleLiveReconnect(reason: string, seq: number): boolean {
    if (!this.isCurrent(seq)) return false;
    if (this.reconnectCount >= MAX_AUTO_RECONNECTS) return false;
    this.clearWatchdog();
    this.clearReconnectTimer();
    this.reconnectCount++;
    const attempt = this.reconnectCount;
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)];
    this.healthySince = 0;
    this.set({
      state: 'buffering',
      reconnecting: true,
      reconnectAttempt: attempt,
      error: null,
      notice: `${reason} (attempt ${attempt}/${MAX_AUTO_RECONNECTS})`,
    });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isCurrent(seq)) return;
      this.triedIndices.clear();
      this.candIdx = attempt === 1 && this.winningCandIdx < this.candidates.length ? this.winningCandIdx : 0;
      void this.startCandidate(seq);
    }, delay);
    return true;
  }

  /**
   * Smart Candidate Failover:
   * - If a `direct` candidate fails (e.g. CORS blocked or custom port unreachable), jumps IMMEDIATELY
   *   to the first untried `relay` candidate instead of wasting time trying other `direct` formats
   *   on the exact same CORS-blocked origin!
   * - If `/api/relay` detected `mpegts` via 80ms first-chunk sniff, jumps straight to the `mpegts` candidate!
   */
  private candidateFailed(info: PlaybackErrorInfo, seq: number, preferFormat?: StreamFormat): void {
    if (!this.isCurrent(seq)) return;
    this.clearWatchdog();
    this.triedIndices.add(this.candIdx);

    if (!this.candOk) {
      const failedCand = this.candidates[this.candIdx];
      let nextIdx = -1;

      if (preferFormat) {
        nextIdx = this.candidates.findIndex((c, idx) => !this.triedIndices.has(idx) && c.format === preferFormat);
      }
      if (nextIdx < 0 && failedCand?.via === 'direct') {
        // Direct failed (almost always CORS on IPTV servers) -> jump straight to Relay!
        nextIdx = this.candidates.findIndex((c, idx) => !this.triedIndices.has(idx) && c.via === 'relay');
      }
      if (nextIdx < 0) {
        nextIdx = this.candidates.findIndex((_c, idx) => !this.triedIndices.has(idx));
      }

      if (nextIdx >= 0) {
        this.candIdx = nextIdx;
        void this.startCandidate(seq);
        return;
      }
    }

    const canAutoReconnect =
      this.candOk &&
      this.isLiveStream() &&
      this.wantPlay &&
      info.category !== 'drm' &&
      info.category !== 'unsupported-format';
    if (canAutoReconnect && this.scheduleLiveReconnect('Stream dropped — auto-reconnecting…', seq)) {
      return;
    }
    this.set({ state: 'error', reconnecting: false, error: info });
  }

  private externalTrackIndices(): Set<number> {
    const out = new Set<number>();
    const extEls = this.video.querySelectorAll('track[data-siravex-ext]');
    if (extEls.length === 0) return out;
    const tracks = this.video.textTracks;
    extEls.forEach((el) => {
      const tt = (el as HTMLTrackElement).track;
      for (let i = 0; i < tracks.length; i++) if (tracks[i] === tt) out.add(i);
    });
    return out;
  }

  private syncNativeAudioTracks(): { audioTracks: TrackOption[]; audioId: string; audioLabel: string } {
    let audioTracks = this.snap.audioTracks;
    let audioLabel = this.snap.audioLabel;
    let audioId = this.snap.audioId;
    if (this.adapter !== 'native') return { audioTracks, audioId, audioLabel };
    const nat = (this.video as unknown as {
      audioTracks?: { length: number; [i: number]: { label?: string; language?: string; kind?: string; enabled: boolean } };
    }).audioTracks;
    if (nat && nat.length > 0) {
      audioTracks = [];
      for (let i = 0; i < nat.length; i++) {
        const tr = nat[i];
        const langFull = humanLanguageName(tr.language);
        const rawLbl = (tr.label || '').trim();
        const label = rawLbl ? (langFull && !rawLbl.toLowerCase().includes(langFull.toLowerCase()) ? `${rawLbl} (${langFull})` : rawLbl) : langFull || `Audio ${i + 1}`;
        audioTracks.push({ id: `nat-${i}`, label, sub: langFull || undefined, lang: tr.language, supported: true });
        if (tr.enabled) { audioId = `nat-${i}`; audioLabel = label; }
      }
      if (!this.nativeAudioPrefApplied && this.lastOpts.preferredAudioLang && audioTracks.length > 1) {
        this.nativeAudioPrefApplied = true;
        const matchIdx = audioTracks.findIndex((t) => languageMatches(t, this.lastOpts.preferredAudioLang));
        if (matchIdx >= 0) {
          for (let i = 0; i < nat.length; i++) nat[i].enabled = i === matchIdx;
          audioId = audioTracks[matchIdx].id;
          audioLabel = audioTracks[matchIdx].label;
        }
      }
    }
    return { audioTracks, audioId, audioLabel };
  }

  private emit() {
    this.lastEmitAt = Date.now();
    const v = this.video;
    const live = v.duration === Infinity || (this.adapter === 'ts' && !Number.isFinite(v.duration));
    let seekable = false;
    try { seekable = v.seekable.length > 0 && v.seekable.end(v.seekable.length - 1) - v.seekable.start(0) > 1; } catch { seekable = false; }
    let bufferedEnd = 0;
    try { if (v.buffered.length) bufferedEnd = v.buffered.end(v.buffered.length - 1); } catch { /* noop */ }
    let droppedFrames = this.snap.droppedFrames;
    let totalFrames = this.snap.totalFrames;
    try {
      const q = (v as HTMLVideoElement & { getVideoPlaybackQuality?: () => { droppedVideoFrames: number; totalVideoFrames: number } }).getVideoPlaybackQuality?.();
      if (q) { droppedFrames = q.droppedVideoFrames; totalFrames = q.totalVideoFrames; }
    } catch { /* noop */ }

    const extIdx = this.externalTrackIndices();
    let subtitleTracks = this.snap.subtitleTracks;
    if (this.adapter === 'hls' || this.adapter === 'shaka') {
      if (extIdx.size > 0 || subtitleTracks.some((t) => t.id.startsWith('ext:'))) {
        const base = subtitleTracks.filter((t) => !t.id.startsWith('ext:'));
        const ext: TrackOption[] = [];
        for (let i = 0; i < v.textTracks.length; i++) {
          if (extIdx.has(i)) ext.push({ id: `ext:${i}`, label: v.textTracks[i].label || 'Subtitle file', lang: v.textTracks[i].language });
        }
        subtitleTracks = [...base, ...ext];
        if (!subtitleTracks.some((t) => t.id === 'off')) subtitleTracks = [{ id: 'off', label: 'Off' }, ...subtitleTracks];
      }
    } else if (v.textTracks.length > 0 || subtitleTracks.length > 1) {
      const subs: TrackOption[] = [{ id: 'off', label: 'Off' }];
      const seen = new Set<string>();
      for (let i = 0; i < v.textTracks.length; i++) {
        const t = v.textTracks[i];
        if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
        const label = t.label || humanLanguageName(t.language) || t.language || `Subtitle ${i + 1}`;
        if (seen.has(label)) continue;
        seen.add(label);
        subs.push({ id: extIdx.has(i) ? `ext:${i}` : String(i), label, lang: t.language });
      }
      subtitleTracks = subs;
    }

    const { audioTracks, audioId, audioLabel } = this.syncNativeAudioTracks();

    let behindLiveSec = 0;
    try { if (v.seekable.length) behindLiveSec = Math.max(0, v.seekable.end(v.seekable.length - 1) - (v.currentTime || 0)); } catch { /* noop */ }

    const resolution = v.videoWidth && v.videoHeight ? `${v.videoWidth}×${v.videoHeight}` : this.snap.resolution;
    let currentQualityLabel = this.snap.currentQualityLabel;
    if (this.snap.qualityId === 'auto' && v.videoHeight > 0 && (currentQualityLabel === 'Auto' || this.adapter === 'native' || this.adapter === 'ts')) {
      currentQualityLabel = `Auto · ${v.videoHeight}p`;
    }

    this.set({
      currentTime: v.currentTime || 0,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
      live,
      seekable,
      behindLiveSec,
      muted: v.muted,
      autoplayMuted: v.muted ? this.snap.autoplayMuted : false,
      volume: v.volume,
      rate: v.playbackRate,
      bufferedEnd,
      droppedFrames,
      totalFrames,
      subtitleTracks,
      audioTracks,
      audioLabel,
      audioId,
      resolution,
      currentQualityLabel,
    });
  }

  private fail() {
    if (this.destroyed || this.adapter !== 'native') return;
    const err = this.video.error;
    if (!err) return;
    this.candidateFailed(mapPlaybackError({ code: err.code, message: err.message, url: this.currentUrl }), this.loadSeq);
  }

  async load(rawUrl: string, opts: LoadOptions & { resetRetry?: boolean } = {}): Promise<void> {
    const seq = ++this.loadSeq;
    let effectiveOpts: LoadOptions = { ...opts };
    if (!effectiveOpts.clearKeys) {
      try {
        const ckParam = new URL(rawUrl, 'http://localhost').searchParams.get('ck');
        if (ckParam) {
          const parsedCk = parseClearKeys(ckParam);
          if (parsedCk) effectiveOpts = { ...effectiveOpts, clearKeys: parsedCk };
        }
      } catch { /* ignore */ }
    }
    this.lastOpts = effectiveOpts;
    this.wantPlay = effectiveOpts.autoplay !== false;
    this.reconnectCount = 0;
    this.winningCandIdx = 0;
    this.healthySince = 0;
    this.triedIndices.clear();
    this.clearWatchdog();
    this.clearReconnectTimer();
    if (!this.isCurrent(seq)) return;

    const url = effectiveOpts.forcedFormat && effectiveOpts.forcedFormat !== 'auto' ? rawUrl : normalizeStreamUrl(rawUrl);
    this.primaryUrl = url;
    const format: StreamFormat = formatOf(url, effectiveOpts.forcedFormat);
    if (format === 'unsupported') {
      this.teardownAdapter();
      this.set({ state: 'error', reconnecting: false, error: mapPlaybackError({ url, format }) });
      return;
    }

    const httpsPage = typeof window !== 'undefined' && window.location?.protocol === 'https:';
    const rawCandidates = buildCandidates(url, format, {
      forced: effectiveOpts.forcedFormat,
      relay: true,
      httpsPage,
      referrer: effectiveOpts.referrer,
    });
    this.candidates = effectiveOpts.forcedFormat && effectiveOpts.forcedFormat !== 'auto'
      ? rawCandidates
      : prioritizeCandidatesForHost(url, rawCandidates);
    this.candIdx = 0;
    await this.startCandidate(seq);
  }

  private async startCandidate(seq: number): Promise<void> {
    const cand = this.candidates[this.candIdx];
    if (!cand) return;
    this.teardownAdapter();
    if (!this.isCurrent(seq)) return;
    this.candOk = false;
    this.nativeAudioPrefApplied = false;
    this.lastMediaTime = -1;
    this.lastMediaAdvanceAt = Date.now();
    this.currentUrl = cand.url;
    this.adapter = cand.format === 'hls' ? 'hls' : cand.format === 'dash' ? 'shaka' : cand.format === 'mpegts' || cand.format === 'flv' ? 'ts' : 'native';

    this.set({
      state: this.snap.reconnecting ? 'buffering' : 'loading',
      error: null,
      engine: cand.format.toUpperCase(),
      format: cand.format,
      attempt: this.triedIndices.size + 1,
      attempts: this.candidates.length,
      qualities: [],
      qualityId: 'auto',
      currentQualityLabel: 'Auto',
      audioTracks: [],
      audioId: '',
      audioLabel: 'Default',
      subtitleTracks: [{ id: 'off', label: 'Off' }],
      subtitleId: 'off',
      resolution: '—',
      bitrateKbps: 0,
      ...(this.snap.reconnecting ? {} : { notice: '' }),
    });

    this.clearWatchdog();
    const hasMore = this.triedIndices.size < this.candidates.length - 1;
    const timeoutMs = cand.via === 'relay' ? (hasMore ? 8500 : 12000) : (hasMore ? 5000 : 9000);
    this.watchdog = window.setTimeout(() => {
      if (this.isCurrent(seq) && !this.candOk) {
        this.candidateFailed(mapPlaybackError({ message: 'timeout', url: cand.url }), seq);
      }
    }, timeoutMs);

    try {
      if (cand.format === 'hls') await this.loadHls(cand.url, seq);
      else if (cand.format === 'dash') await this.loadDash(cand.url, this.lastOpts, seq);
      else if (cand.format === 'mpegts' || cand.format === 'flv') await this.loadTs(cand.url, cand.format, seq);
      else this.loadNative(cand.url, false, seq);
    } catch (e) {
      if (!this.isCurrent(seq)) return;
      const errObj = e as { code?: number; message?: string } | null;
      const shakaCode = typeof errObj?.code === 'number' ? errObj.code : undefined;
      this.candidateFailed(mapPlaybackError({ shakaCode, message: e instanceof Error ? e.message : errObj?.message, url: cand.url }), seq);
    }
  }

  private loadNative(url: string, isSafariHls: boolean, seq: number): void {
    if (!this.isCurrent(seq)) return;
    this.adapter = 'native';
    this.set({ engine: isSafariHls ? 'Native HLS (Safari)' : 'Native HTML5' });
    const nat = (this.video as unknown as {
      audioTracks?: { addEventListener?: (t: string, fn: () => void) => void; removeEventListener?: (t: string, fn: () => void) => void };
    }).audioTracks;
    if (nat && typeof nat.addEventListener === 'function') {
      const onTrackEvt = () => { if (this.isCurrent(seq)) this.emit(); };
      nat.addEventListener('addtrack', onTrackEvt);
      nat.addEventListener('removetrack', onTrackEvt);
      nat.addEventListener('change', onTrackEvt);
      this.nativeAudioCleanup = () => {
        try {
          nat.removeEventListener?.('addtrack', onTrackEvt);
          nat.removeEventListener?.('removetrack', onTrackEvt);
          nat.removeEventListener?.('change', onTrackEvt);
        } catch { /* ignore */ }
      };
    }
    this.video.preload = 'auto';
    this.video.src = url;
    this.video.load();
    if (this.wantPlay) this.safePlay();
  }

  private async loadHls(url: string, seq: number): Promise<void> {
    const mod = await getHlsModule();
    if (!this.isCurrent(seq)) return;
    const HlsCtor = mod.default;
    const canNativeHls = this.video.canPlayType('application/vnd.apple.mpegurl') !== '';
    if (!HlsCtor.isSupported()) {
      if (canNativeHls) { this.loadNative(url, true, seq); return; }
      this.candidateFailed(mapPlaybackError({ message: 'format not supported', url }), seq);
      return;
    }

    const prefLang = this.lastOpts.preferredAudioLang;
    const hasFallback = this.triedIndices.size < this.candidates.length - 1;
    const hls = new HlsCtor({
      enableWorker: true,
      // Standard HLS mode: rock-solid 1.0x speed, zero LL-HLS part stalls on IPTV panels!
      lowLatencyMode: false,
      startFragPrefetch: true,
      // CRITICAL SPEED BOOST: Disable throwaway bandwidth-probe fragment download on startup!
      testBandwidth: false,
      abrEwmaDefaultEstimate: 2_500_000,
      startLevel: -1,
      capLevelToPlayerSize: false,
      backBufferLength: 20,
      maxBufferLength: 18,
      maxMaxBufferLength: 40,
      maxBufferSize: 35 * 1000 * 1000,
      maxBufferHole: 0.5,
      nudgeOffset: 0.15,
      nudgeMaxRetry: 5,
      maxStarvationDelay: 2,
      maxLoadingDelay: 2,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 8,
      manifestLoadingTimeOut: 5500,
      manifestLoadingMaxRetry: hasFallback ? 0 : 2,
      levelLoadingTimeOut: 6000,
      levelLoadingMaxRetry: hasFallback ? 1 : 2,
      fragLoadingTimeOut: 9500,
      fragLoadingMaxRetry: 3,
      ...(prefLang ? { audioPreference: { lang: prefLang } } : {}),
    });
    this.hls = hls;
    this.set({ engine: 'HLS.js' });

    let audioPrefDone = false;
    let subPrefDone = false;
    let audioRecovery = 0;
    let firstFragReady = false;

    const getRawAudioList = (): RawHlsAudioTrack[] => {
      const inGroup = (hls.audioTracks ?? []) as unknown as RawHlsAudioTrack[];
      const all = ((hls as unknown as { allAudioTracks?: RawHlsAudioTrack[] }).allAudioTracks ?? []) as RawHlsAudioTrack[];
      return inGroup.length > 0 ? inGroup : all;
    };

    const applyHlsAudioIndex = (idx: number, rawTracks: RawHlsAudioTrack[]) => {
      const target = rawTracks[idx];
      if (!target) return;
      try {
        (hls as unknown as { setAudioOption?: (t: unknown) => void }).setAudioOption?.(target);
      } catch { /* fallback below */ }
      if (idx >= 0 && idx < (hls.audioTracks?.length ?? 0)) {
        hls.audioTrack = idx;
      }
    };

    const switchToSupportedAudio = (reason: string): boolean => {
      const raw = getRawAudioList();
      if (raw.length <= 1) return false;
      const cur = Math.max(0, hls.audioTrack);
      const alt = raw.findIndex((tr, i) => i !== cur && isAudioCodecSupported(tr.audioCodec || tr.attrs?.CODECS));
      const next = alt >= 0 ? alt : (cur + 1) % raw.length;
      if (next === cur) return false;
      const from = raw[cur];
      const to = raw[next];
      applyHlsAudioIndex(next, raw);
      this.set({
        notice: `${reason}: "${from?.name || humanLanguageName(from?.lang) || 'default'}" audio is browser par supported nahi — "${to?.name || humanLanguageName(to?.lang) || `Audio ${next + 1}`}" select kar diya gaya.`,
      });
      return true;
    };

    const syncTracks = () => {
      if (!this.isCurrent(seq) || this.hls !== hls) return;
      const qualities = buildHlsQualityOptions(hls.levels ?? []);
      const inGroup = (hls.audioTracks ?? []) as unknown as RawHlsAudioTrack[];
      const allAud = ((hls as unknown as { allAudioTracks?: RawHlsAudioTrack[] }).allAudioTracks ?? []) as RawHlsAudioTrack[];
      const audioTracks = buildHlsAudioOptions(inGroup, allAud);
      const rawSubs = hls.subtitleTracks ?? [];
      const subtitleTracks: TrackOption[] = [
        { id: 'off', label: 'Off' },
        ...rawSubs.map((t, i) => ({
          id: `hls-${i}`,
          label: t.name || humanLanguageName(t.lang) || t.lang || `Subtitle ${i + 1}`,
          sub: humanLanguageName(t.lang) || undefined,
          lang: t.lang,
        })),
      ];

      const raw = getRawAudioList();
      if (!audioPrefDone && raw.length > 0) {
        if (inGroup.length > 0 || hls.levels.length > 0) {
          audioPrefDone = true;
          const prefAudio = this.lastOpts.preferredAudioLang;
          const prefIdx = prefAudio ? audioTracks.findIndex((t) => t.supported !== false && languageMatches(t, prefAudio)) : -1;
          if (prefIdx >= 0 && prefIdx !== hls.audioTrack) {
            applyHlsAudioIndex(prefIdx, raw);
          } else {
            const curIdx = hls.audioTrack >= 0 ? hls.audioTrack : 0;
            const curRaw = raw[curIdx];
            if (curRaw && !isAudioCodecSupported(curRaw.audioCodec || curRaw.attrs?.CODECS)) {
              switchToSupportedAudio('Default audio codec');
            }
          }
        }
      }

      if (!subPrefDone && rawSubs.length > 0 && this.lastOpts.preferredSubtitleLang) {
        subPrefDone = true;
        const matchSub = rawSubs.findIndex((t) => languageMatches({ lang: t.lang, label: t.name }, this.lastOpts.preferredSubtitleLang));
        if (matchSub >= 0) {
          hls.subtitleTrack = matchSub;
          this.set({ subtitleId: `hls-${matchSub}` });
        }
      }

      const activeIdx = hls.audioTrack >= 0 ? hls.audioTrack : 0;
      const activeOpt = audioTracks[activeIdx];
      const curLvl = hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : undefined;
      const lockedOpt = this.snap.qualityId !== 'auto' ? qualities.find((q) => q.id === this.snap.qualityId) : undefined;
      const currentQualityLabel = lockedOpt
        ? lockedOpt.shortLabel
        : `Auto${curLvl?.height ? ` · ${curLvl.height}p` : this.video.videoHeight > 0 ? ` · ${this.video.videoHeight}p` : ''}`;

      this.set({
        qualities,
        currentQualityLabel,
        audioTracks,
        audioId: audioTracks.length > 0 ? String(Math.min(activeIdx, audioTracks.length - 1)) : '',
        audioLabel: activeOpt?.label ?? (audioTracks.length === 0 ? 'Embedded' : this.snap.audioLabel),
        subtitleTracks: subtitleTracks.length > 1 ? subtitleTracks : this.snap.subtitleTracks,
      });
    };

    hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
      if (!this.isCurrent(seq) || this.hls !== hls) return;
      syncTracks();
      if (this.wantPlay) this.safePlay();
    });
    hls.on(HlsCtor.Events.LEVEL_LOADED, () => {
      if (!this.isCurrent(seq) || this.hls !== hls) return;
      if (!this.candOk && this.watchdog) {
        this.clearWatchdog();
        this.watchdog = window.setTimeout(() => {
          if (this.isCurrent(seq) && !this.candOk) {
            this.candidateFailed(mapPlaybackError({ message: 'timeout', url }), seq);
          }
        }, 12000);
      }
    });
    hls.on(HlsCtor.Events.FRAG_BUFFERED, () => {
      if (firstFragReady || !this.isCurrent(seq) || this.hls !== hls) return;
      firstFragReady = true;
      this.markCandidateOk();
      if (this.wantPlay && this.video.paused) this.safePlay();
    });
    hls.on(HlsCtor.Events.AUDIO_TRACKS_UPDATED, syncTracks);
    hls.on(HlsCtor.Events.SUBTITLE_TRACKS_UPDATED, syncTracks);
    hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_e, data) => {
      if (!this.isCurrent(seq) || this.hls !== hls) return;
      const lvl = hls.levels[data.level];
      const fellBackToAuto = hls.manualLevel === -1 && this.snap.qualityId !== 'auto';
      const nextQualityId = fellBackToAuto ? 'auto' : this.snap.qualityId;
      const lockedOpt = nextQualityId !== 'auto' ? this.snap.qualities.find((q) => q.id === nextQualityId) : undefined;
      this.set({
        qualityId: nextQualityId,
        bitrateKbps: lvl?.bitrate ? Math.round(lvl.bitrate / 1000) : this.snap.bitrateKbps,
        resolution: lvl?.width && lvl?.height ? `${lvl.width}×${lvl.height}` : this.snap.resolution,
        currentQualityLabel: lockedOpt
          ? lockedOpt.shortLabel
          : `Auto${lvl?.height ? ` · ${lvl.height}p` : ''}`,
      });
      syncTracks();
    });
    hls.on(HlsCtor.Events.AUDIO_TRACK_SWITCHED, (_e, data) => {
      if (!this.isCurrent(seq) || this.hls !== hls) return;
      const activeIdx = hls.audioTrack >= 0 ? hls.audioTrack : data.id;
      const opt = this.snap.audioTracks[activeIdx];
      this.set({
        audioId: String(activeIdx),
        audioLabel: opt?.label || data.name || humanLanguageName(data.lang) || `Audio ${activeIdx + 1}`,
      });
    });

    let networkRecoveries = 0;
    let mediaRecoveries = 0;
    hls.on(HlsCtor.Events.ERROR, (_e, data) => {
      if (!this.isCurrent(seq) || this.hls !== hls) return;
      // CRITICAL: Never call recoverMediaError() on non-fatal errors — HLS.js gap-controller handles them cleanly!
      if (!data.fatal) return;

      const isCodecErr =
        data.details === HlsCtor.ErrorDetails.BUFFER_ADD_CODEC_ERROR ||
        data.details === HlsCtor.ErrorDetails.BUFFER_APPENDING_ERROR ||
        data.details === HlsCtor.ErrorDetails.BUFFER_APPEND_ERROR;
      const isAudioLoadErr = /audio/i.test(String(data.details)) && data.type === HlsCtor.ErrorTypes.NETWORK_ERROR;
      if ((isCodecErr || isAudioLoadErr) && audioRecovery < 3 && switchToSupportedAudio('Audio codec recovery')) {
        audioRecovery++;
        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else hls.startLoad();
        return;
      }

      const httpCode = (data.response as { code?: number } | undefined)?.code;
      const isManifestFail =
        data.details === HlsCtor.ErrorDetails.MANIFEST_LOAD_ERROR ||
        data.details === HlsCtor.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
        data.details === HlsCtor.ErrorDetails.MANIFEST_PARSING_ERROR;

      // If /api/relay returned 415 (detected raw MPEG-TS on extensionless stream), jump straight to mpegts.js!
      if (!this.candOk && httpCode === 415) {
        this.candidateFailed(
          mapPlaybackError({ message: data.details, url, detailCode: 'Relay detected raw MPEG-TS stream' }),
          seq,
          'mpegts',
        );
        return;
      }

      // Fast-fail to next candidate (/api/relay or .ts) immediately when initial manifest is CORS-blocked/unreachable
      if (!this.candOk && isManifestFail && this.triedIndices.size < this.candidates.length - 1) {
        this.candidateFailed(mapPlaybackError({ message: data.details, url, detailCode: `HLS ${data.type}: ${data.details}` }), seq);
        return;
      }

      if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR && networkRecoveries < 2) {
        networkRecoveries++;
        hls.startLoad();
        return;
      }
      if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
        mediaRecoveries++;
        if (mediaRecoveries === 2) hls.swapAudioCodec();
        hls.recoverMediaError();
        return;
      }
      if (!this.candOk && canNativeHls) {
        try { hls.destroy(); } catch { /* noop */ }
        this.hls = null;
        this.loadNative(url, true, seq);
        return;
      }
      this.candidateFailed(mapPlaybackError({ message: data.details, url, detailCode: `HLS ${data.type}: ${data.details}` }), seq);
    });

    // When loading via SIRAVEX Relay, attach `&expect=hls` so binary TS streams return 415 in ~80ms instead of hanging 6s!
    const sourceUrl = url.startsWith('/api/relay?') && !url.includes('&expect=') ? `${url}&expect=hls` : url;
    hls.attachMedia(this.video);
    hls.on(HlsCtor.Events.MEDIA_ATTACHED, () => {
      if (this.isCurrent(seq) && this.hls === hls) hls.loadSource(sourceUrl);
    });
  }

  private async loadDash(url: string, opts: LoadOptions, seq: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('shaka-player/dist/shaka-player.compiled');
    if (!this.isCurrent(seq)) return;
    const shaka = mod.default ?? mod;
    try { shaka.polyfill.installAll(); } catch { /* ignore */ }
    if (!shaka.Player.isBrowserSupported?.() && !shaka.isBrowserSupported?.()) {
      this.candidateFailed(mapPlaybackError({ message: 'format not supported', url }), seq);
      return;
    }
    const player = new shaka.Player();
    this.shakaPlayer = player;
    await player.attach(this.video);
    if (!this.isCurrent(seq)) { try { await player.destroy(); } catch { /* noop */ } return; }
    this.set({ engine: 'Shaka DASH' });

    const hasFallback = this.triedIndices.size < this.candidates.length - 1;
    player.configure({
      streaming: {
        bufferingGoal: 16,
        rebufferingGoal: 1.5,
        bufferBehind: 20,
        lowLatencyMode: false,
        ignoreTextStreamFailures: true,
        alwaysStreamText: false,
        retryParameters: { maxAttempts: hasFallback ? 1 : 3, baseDelay: 400, backoffFactor: 1.6, timeout: 8000 },
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: 2_500_000,
      },
      ...(opts.preferredAudioLang ? { preferredAudioLanguage: opts.preferredAudioLang } : {}),
      ...(opts.preferredSubtitleLang ? { preferredTextLanguage: opts.preferredSubtitleLang } : {}),
    });
    if (opts.clearKeys && Object.keys(opts.clearKeys).length) player.configure({ drm: { clearKeys: opts.clearKeys } });
    if (opts.licenseUrl) player.configure({ drm: { servers: { 'com.widevine.alpha': opts.licenseUrl } } });

    let dashAudioPrefDone = false;
    let dashSubPrefDone = false;

    const syncDash = () => {
      if (!this.isCurrent(seq) || this.shakaPlayer !== player) return;
      try {
        const variants = (player.getVariantTracks?.() as RawShakaVariant[]) ?? [];
        const videoTracks = (player.getVideoTracks?.() as RawShakaVideoTrack[]) ?? [];
        const audioRaw = (player.getAudioTracks?.() as RawShakaAudioTrack[]) ?? [];
        const fallbackLangs = (player.getAudioLanguagesAndRoles?.() as { language: string; role?: string }[]) ?? [];

        this.shakaVideoList = videoTracks;
        this.shakaAudioList = audioRaw;

        const qualities = buildDashQualityOptions(videoTracks, variants);
        const audResult = buildDashAudioOptions(audioRaw, fallbackLangs);

        if (!dashAudioPrefDone && (audioRaw.length > 1 || fallbackLangs.length > 1)) {
          dashAudioPrefDone = true;
          const prefAudio = opts.preferredAudioLang;
          if (prefAudio && audioRaw.length > 0) {
            const matchIdx = audResult.options.findIndex((t) => t.supported !== false && languageMatches(t, prefAudio));
            if (matchIdx >= 0 && !audioRaw[matchIdx].active) {
              player.selectAudioTrack?.(audioRaw[matchIdx]);
            }
          } else if (audioRaw.length > 0) {
            const curActiveIdx = audioRaw.findIndex((a) => a.active);
            if (curActiveIdx >= 0 && audResult.options[curActiveIdx]?.supported === false) {
              const supIdx = audResult.options.findIndex((o) => o.supported !== false);
              if (supIdx >= 0) player.selectAudioTrack?.(audioRaw[supIdx]);
            }
          }
        }

        const textTracks = (player.getTextTracks?.() as { id: number; language?: string; label?: string; kind?: string }[]) ?? [];
        const subtitleTracks: TrackOption[] = [
          { id: 'off', label: 'Off' },
          ...textTracks.filter((t) => t.kind !== 'forced').map((t) => ({
            id: `shaka-${t.id}`,
            label: t.label || humanLanguageName(t.language) || t.language || 'Subtitle',
            sub: humanLanguageName(t.language) || undefined,
            lang: t.language,
          })),
        ];

        if (!dashSubPrefDone && opts.preferredSubtitleLang && textTracks.length > 0) {
          dashSubPrefDone = true;
          const matchSub = textTracks.find((t) => t.kind !== 'forced' && languageMatches({ lang: t.language, label: t.label }, opts.preferredSubtitleLang));
          if (matchSub) {
            player.selectTextTrack?.(matchSub);
            player.setTextTrackVisibility?.(true);
            this.set({ subtitleId: `shaka-${matchSub.id}` });
          }
        }

        const activeVar = variants.find((v) => v.active);
        const activeVid = videoTracks.find((v) => v.active);
        const activeHeight = activeVid?.height || activeVar?.height || (this.video.videoHeight > 0 ? this.video.videoHeight : undefined);
        const activeWidth = activeVid?.width || activeVar?.width || (this.video.videoWidth > 0 ? this.video.videoWidth : undefined);
        const stats = player.getStats?.() as { streamBandwidth?: number; width?: number; height?: number } | undefined;
        const lockedOpt = this.snap.qualityId !== 'auto' ? qualities.find((q) => q.id === this.snap.qualityId) : undefined;

        this.set({
          qualities,
          audioTracks: audResult.options,
          subtitleTracks,
          audioId: audResult.activeId || this.snap.audioId,
          audioLabel: audResult.activeLabel || activeVar?.audioLanguage || this.snap.audioLabel,
          resolution: activeWidth && activeHeight ? `${activeWidth}×${activeHeight}` : this.snap.resolution,
          bitrateKbps: stats?.streamBandwidth
            ? Math.round(stats.streamBandwidth / 1000)
            : activeVid?.bandwidth
              ? Math.round(activeVid.bandwidth / 1000)
              : activeVar?.bandwidth
                ? Math.round(activeVar.bandwidth / 1000)
                : this.snap.bitrateKbps,
          currentQualityLabel: lockedOpt
            ? lockedOpt.shortLabel
            : `Auto${activeHeight ? ` · ${activeHeight}p` : ''}`,
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
      if (!isShakaCritical(detail)) return;
      const code = typeof detail?.code === 'number' ? detail.code : undefined;
      this.candidateFailed(mapPlaybackError({ shakaCode: code, message: detail?.message, url }), seq);
    });

    await player.load(url);
    if (!this.isCurrent(seq)) return;
    this.markCandidateOk();
    syncDash();
    if (this.wantPlay) this.safePlay();
  }

  private async loadTs(url: string, format: 'mpegts' | 'flv', seq: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await getMpegtsModule();
    if (!this.isCurrent(seq)) return;
    const Mpegts = mod.default ?? mod;
    if (!Mpegts.isSupported()) {
      this.candidateFailed(mapPlaybackError({ message: 'format not supported', url }), seq);
      return;
    }
    const player = Mpegts.createPlayer(
      { type: format === 'flv' ? 'flv' : 'mpegts', isLive: true, url, cors: true },
      {
        enableWorker: true,
        // 64 KB stash batches micro TCP chunks smoothly (~40ms) so MSE never crackles or stutters!
        enableStashBuffer: true,
        stashInitialSize: 64 * 1024,
        lazyLoad: false,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 6,
        liveBufferLatencyMinRemain: 1.5,
        liveBufferLatencyChasingOnPaused: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 24,
        autoCleanupMinBackwardDuration: 12,
      },
    );
    this.tsPlayer = player;
    player.on(Mpegts.Events.ERROR, (_errType: string, errDetail: string) => {
      if (!this.isCurrent(seq)) return;
      this.candidateFailed(mapPlaybackError({ message: errDetail || 'network', url, detailCode: `TS: ${errDetail || _errType}` }), seq);
    });
    player.on(Mpegts.Events.MEDIA_INFO, (info: { width?: number; height?: number; videoCodec?: string; audioCodec?: string }) => {
      if (!this.isCurrent(seq)) return;
      this.markCandidateOk();
      if (info?.width && info?.height) {
        this.set({
          resolution: `${info.width}×${info.height}`,
          currentQualityLabel: `Auto · ${info.height}p`,
        });
      }
      if (this.wantPlay && this.video.paused) this.safePlay();
    });
    player.attachMediaElement(this.video);
    player.load();
    this.set({
      engine: format === 'flv' ? 'FLV · mpegts.js' : 'MPEG-TS · mpegts.js',
      qualities: [{ id: 'auto', label: 'Auto (single rendition)', shortLabel: 'Auto' }],
      currentQualityLabel: 'Auto',
      audioLabel: 'Embedded',
    });
    if (this.wantPlay) this.safePlay();
  }

  play(): void {
    this.wantPlay = true;
    this.safePlay();
  }

  pause(): void {
    this.wantPlay = false;
    this.clearReconnectTimer();
    if (this.snap.reconnecting) this.set({ reconnecting: false });
    this.video.pause();
  }

  togglePlay(): void { this.video.paused ? this.play() : this.pause(); }

  unmuteAutoplay(defaultVol = 0.8): void {
    const vol = this.desiredVolume > 0 ? this.desiredVolume : defaultVol;
    this.video.muted = false;
    if (this.video.volume === 0) this.video.volume = Math.min(1, Math.max(0.1, vol));
    this.set({ muted: false, autoplayMuted: false });
    if (this.video.paused) this.safePlay();
    this.emit();
  }

  seek(t: number): void {
    if (this.snap.seekable) {
      try {
        const start = this.video.seekable.length ? this.video.seekable.start(0) : 0;
        const end = this.video.seekable.length ? this.video.seekable.end(this.video.seekable.length - 1) : t;
        this.video.currentTime = Math.min(end, Math.max(start, t));
      } catch { /* live edge */ }
    }
  }

  seekBy(delta: number): void {
    if (this.snap.seekable) this.seek(this.video.currentTime + delta);
    else if (this.tsPlayer) {
      try { this.video.currentTime = Math.max(0, this.video.currentTime + delta); } catch { /* live TS edge */ }
    }
  }

  goLive(): void {
    try {
      if (this.hls && typeof this.hls.liveSyncPosition === 'number' && this.hls.liveSyncPosition > 0) {
        this.video.currentTime = this.hls.liveSyncPosition;
        if (this.video.paused && this.wantPlay) this.safePlay();
        return;
      }
      if (this.shakaPlayer) {
        if (typeof this.shakaPlayer.goToLive === 'function') {
          this.shakaPlayer.goToLive();
          if (this.video.paused && this.wantPlay) this.safePlay();
          return;
        }
        const range = this.shakaPlayer.seekRange?.() as { start: number; end: number } | undefined;
        if (range && range.end > 0) {
          this.video.currentTime = Math.max(range.start, range.end - 1.5);
          return;
        }
      }
      const v = this.video;
      if (v.seekable.length) { v.currentTime = Math.max(0, v.seekable.end(v.seekable.length - 1) - 1); return; }
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

  setVolume(v: number): void {
    const clamped = Math.min(1, Math.max(0, v));
    this.video.volume = clamped;
    if (clamped > 0) {
      this.desiredVolume = clamped;
      this.video.muted = false;
      this.set({ autoplayMuted: false });
    }
    this.emit();
  }

  toggleMute(): void {
    const nextMuted = !this.video.muted;
    this.video.muted = nextMuted;
    if (!nextMuted) {
      if (this.video.volume === 0) this.video.volume = this.desiredVolume || 0.8;
      this.set({ autoplayMuted: false });
    }
    this.emit();
  }

  setRate(r: number): void { this.video.playbackRate = r; this.emit(); }

  setQuality(id: string): void {
    const picked = this.snap.qualities.find((q) => q.id === id);
    const activeH = this.video.videoHeight > 0 ? ` · ${this.video.videoHeight}p` : '';
    this.set({
      qualityId: id,
      currentQualityLabel: id === 'auto' ? `Auto${activeH}` : picked?.shortLabel ?? picked?.label ?? id,
    });

    if (this.hls) {
      if (id === 'auto') {
        this.hls.nextLevel = -1;
        this.hls.currentLevel = -1;
        this.hls.loadLevel = -1;
      } else {
        const lvl = Number(id);
        if (Number.isFinite(lvl) && lvl >= 0 && lvl < this.hls.levels.length) {
          if (this.video.paused || this.video.readyState < 2 || !this.snap.live) {
            this.hls.currentLevel = lvl;
          } else {
            this.hls.nextLevel = lvl;
          }
          const targetLvl = this.hls.levels[lvl];
          if (targetLvl?.width && targetLvl?.height) {
            this.set({
              resolution: `${targetLvl.width}×${targetLvl.height}`,
              bitrateKbps: targetLvl.bitrate ? Math.round(targetLvl.bitrate / 1000) : this.snap.bitrateKbps,
            });
          }
        }
      }
      return;
    }

    if (this.shakaPlayer) {
      try {
        if (id === 'auto') {
          this.shakaPlayer.configure({ abr: { enabled: true } });
          return;
        }
        this.shakaPlayer.configure({ abr: { enabled: false } });
        if (id.startsWith('vt-')) {
          const vtIdx = Number(id.slice(3));
          const vt = this.shakaVideoList[vtIdx];
          if (vt && typeof this.shakaPlayer.selectVideoTrack === 'function') {
            this.shakaPlayer.selectVideoTrack(vt, true, this.snap.live ? 2 : 0);
            if (vt.width && vt.height) this.set({ resolution: `${vt.width}×${vt.height}` });
            return;
          }
        }
        const variants = (this.shakaPlayer.getVariantTracks?.() as RawShakaVariant[]) ?? [];
        const activeVar = variants.find((v) => v.active);
        const wantHeight = picked?.height ?? Number(id.split('-')[1] || 0);
        const sameHeight = wantHeight > 0 ? variants.filter((v) => v.height === wantHeight) : variants.filter((v) => `var-${v.id}` === id);
        const matchingAudio = activeVar
          ? sameHeight.filter((v) => (activeVar.audioId != null && v.audioId === activeVar.audioId) || (activeVar.audioLanguage && v.audioLanguage === activeVar.audioLanguage))
          : [];
        const pool = matchingAudio.length > 0 ? matchingAudio : sameHeight;
        const best = pool.sort((a, b) => Math.abs((a.bandwidth ?? 0) - (picked?.bitrate ?? b.bandwidth ?? 0)) - Math.abs((b.bandwidth ?? 0) - (picked?.bitrate ?? a.bandwidth ?? 0)))[0];
        if (best) this.shakaPlayer.selectVariantTrack(best, true, this.snap.live ? 2 : 0);
      } catch { /* noop */ }
    }
  }

  setAudio(id: string): void {
    const picked = this.snap.audioTracks.find((t) => t.id === id);
    this.set({ audioId: id, audioLabel: picked?.label ?? this.snap.audioLabel });

    if (this.hls) {
      const idx = Number(id);
      if (!Number.isFinite(idx) || idx < 0) return;
      const inGroup = (this.hls.audioTracks ?? []) as unknown as RawHlsAudioTrack[];
      const all = ((this.hls as unknown as { allAudioTracks?: RawHlsAudioTrack[] }).allAudioTracks ?? []) as RawHlsAudioTrack[];
      const list = inGroup.length > 0 ? inGroup : all;
      const target = list[idx];
      if (target) {
        try {
          (this.hls as unknown as { setAudioOption?: (t: unknown) => void }).setAudioOption?.({
            name: target.name,
            lang: target.lang,
            groupId: target.groupId,
            audioCodec: target.audioCodec,
            flushImmediate: true,
          });
        } catch { /* fallback below */ }
      }
      if (idx < (this.hls.audioTracks?.length ?? 0)) {
        this.hls.audioTrack = idx;
      }
      return;
    }

    if (this.shakaPlayer) {
      try {
        if (id.startsWith('sa-')) {
          const aIdx = Number(id.slice(3));
          const audTrack = this.shakaAudioList[aIdx];
          if (audTrack && typeof this.shakaPlayer.selectAudioTrack === 'function') {
            this.shakaPlayer.selectAudioTrack(audTrack, this.snap.live ? 1 : 0);
            return;
          }
        }
        const [lang, role] = id.split('|');
        this.shakaPlayer.selectAudioLanguage?.(lang, role || undefined);
        if (this.snap.qualityId !== 'auto') {
          const variants = (this.shakaPlayer.getVariantTracks?.() as RawShakaVariant[]) ?? [];
          const activeVar = variants.find((v) => v.active);
          const match = variants
            .filter((v) => v.audioLanguage === lang && (!activeVar?.height || v.height === activeVar.height))
            .sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0];
          if (match) this.shakaPlayer.selectVariantTrack?.(match, true);
        }
      } catch { /* noop */ }
      return;
    }

    const native = (this.video as unknown as { audioTracks?: { length: number; [i: number]: { enabled: boolean } } }).audioTracks;
    if (native) {
      const want = id.replace('nat-', '');
      for (let i = 0; i < native.length; i++) native[i].enabled = String(i) === want;
    }
    this.emit();
  }

  private disableExternalTracks(except = -1): void {
    const ext = this.externalTrackIndices();
    for (let i = 0; i < this.video.textTracks.length; i++) if (ext.has(i) && i !== except) this.video.textTracks[i].mode = 'disabled';
  }

  setSubtitle(id: string): void {
    this.set({ subtitleId: id });
    if (id.startsWith('ext:')) { this.showExternalSubtitle(Number(id.slice(4))); return; }
    this.disableExternalTracks();
    if (this.adapter === 'hls' && this.hls) {
      this.hls.subtitleTrack = id === 'off' ? -1 : Number(id.replace('hls-', ''));
      if (this.hls.subtitleDisplay !== undefined) this.hls.subtitleDisplay = id !== 'off';
      return;
    }
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

  showExternalSubtitle(index: number): void {
    if (this.adapter === 'hls' && this.hls) this.hls.subtitleTrack = -1;
    if (this.adapter === 'shaka' && this.shakaPlayer) { try { this.shakaPlayer.setTextTrackVisibility(false); } catch { /* noop */ } }
    for (let i = 0; i < this.video.textTracks.length; i++) this.video.textTracks[i].mode = i === index ? 'showing' : 'disabled';
    this.set({ subtitleId: `ext:${index}` });
    this.emit();
  }

  async reconnectNow(): Promise<void> {
    if (!this.primaryUrl) return;
    this.clearReconnectTimer();
    this.set({ reconnecting: false, reconnectAttempt: 0 });
    await this.load(this.primaryUrl, { ...this.lastOpts, autoplay: true });
  }

  retry(): void { void this.reconnectNow(); }

  private teardownAdapter() {
    if (this.emitTimer) { window.clearTimeout(this.emitTimer); this.emitTimer = null; }
    if (!this.video.paused) {
      try { this.video.pause(); } catch { /* noop */ }
    }
    if (this.nativeAudioCleanup) { this.nativeAudioCleanup(); this.nativeAudioCleanup = null; }
    this.shakaVideoList = [];
    this.shakaAudioList = [];
    if (this.hls) {
      try { this.hls.destroy(); } catch { /* noop */ }
      this.hls = null;
    }
    if (this.shakaPlayer) {
      const p = this.shakaPlayer;
      this.shakaPlayer = null;
      void Promise.resolve(p.destroy?.()).catch(() => undefined);
    }
    if (this.tsPlayer) {
      try { this.tsPlayer.unload?.(); this.tsPlayer.detachMediaElement?.(); this.tsPlayer.destroy(); } catch { /* noop */ }
      this.tsPlayer = null;
    }
    if (this.video.getAttribute('src')) {
      this.video.removeAttribute('src');
      try { this.video.load(); } catch { /* noop */ }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.loadSeq++;
    this.clearWatchdog();
    this.clearReconnectTimer();
    if (this.emitTimer) { window.clearTimeout(this.emitTimer); this.emitTimer = null; }
    if (this.stallTimer) { window.clearInterval(this.stallTimer); this.stallTimer = null; }
    this.teardownAdapter();
    this.bound.forEach(([n, f]) => this.video.removeEventListener(n, f));
    this.bound = [];
    if (typeof window !== 'undefined') {
      this.winBound.forEach(([n, f]) => window.removeEventListener(n, f));
    }
    this.winBound = [];
    this.listeners.clear();
  }
}
