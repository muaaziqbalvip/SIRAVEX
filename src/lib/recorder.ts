/**
 * Stream recorder — captureStream() + MediaRecorder se jo video chal raha
 * hai usi ko record karke file save karna. Sirf wahi content record karein
 * jis ke rights aap ke paas hon.
 *
 * Research notes (2025/26):
 * - Mime ladder: pehle MP4 (Safari + naye Chrome, sab jagah chalta hai),
 *   phir WebM VP9 -> VP8. Har candidate MediaRecorder.isTypeSupported se
 *   verify hota hai — kabhi assume nahi karte.
 * - captureStream() DRM (EME) video par black frames deta hai aur
 *   CORS-tainted media par SecurityError throw kar sakta hai — dono ko
 *   typed error bana kar user ko saaf wajah batate hain.
 * - Long recordings ke liye File System Access API (showSaveFilePicker)
 *   se direct disk par stream kar sakte hain taake RAM na bhare; warna
 *   memory chunks + MEMORY_WARN_BYTES par warning.
 */

export const REC_MIME_CANDIDATES = [
  'video/mp4;codecs="avc1.640028,mp4a.40.2"',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

export function pickRecordingMime(
  isSupported: (mime: string) => boolean = (m) =>
    typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? MediaRecorder.isTypeSupported(m)
      : false,
): string {
  for (const mime of REC_MIME_CANDIDATES) {
    try { if (isSupported(mime)) return mime; } catch { /* next */ }
  }
  return '';
}

export function recordingExt(mime: string): 'mp4' | 'webm' {
  return mime.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

export interface RecQuality { id: string; label: string; sub: string; videoBitsPerSecond: number }
export const REC_QUALITIES: RecQuality[] = [
  { id: 'high', label: 'High', sub: '8 Mbps — source jaisi quality, bari file', videoBitsPerSecond: 8_000_000 },
  { id: 'medium', label: 'Medium', sub: '4 Mbps — balance (recommended)', videoBitsPerSecond: 4_000_000 },
  { id: 'low', label: 'Low', sub: '1.5 Mbps — chhoti file, mobile ke liye', videoBitsPerSecond: 1_500_000 },
];

/** Memory-mode me is size ke baad user ko save karne ki warning. */
export const MEMORY_WARN_BYTES = 700 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatRecClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** File name ke liye safe base — private URL kabhi file name me nahi jata, sirf title. */
export function safeFileBase(title: string, now = new Date()): string {
  const slug = (title || 'stream')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'stream';
  const p = (v: number) => String(v).padStart(2, '0');
  return `siravex-${slug}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

export type RecorderErrorKind = 'unsupported' | 'blocked' | 'no-tracks' | 'failed';
export class RecorderError extends Error {
  kind: RecorderErrorKind;
  constructor(kind: RecorderErrorKind, message: string) { super(message); this.kind = kind; }
}

export interface WritableSink {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
  abort?: (reason?: unknown) => Promise<void>;
}

export interface RecordingResult {
  blob: Blob | null; // disk-streaming me null (file pehle se disk par hai)
  ext: 'mp4' | 'webm';
  mime: string;
  bytes: number;
  seconds: number;
  streamedToDisk: boolean;
}

type ProgressFn = (bytes: number, seconds: number) => void;

export class StreamRecorder {
  state: 'idle' | 'recording' | 'paused' = 'idle';
  bytes = 0;
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private sink: WritableSink | null = null;
  private sinkFailed = false;
  private mime = '';
  private startedAt = 0;
  private elapsedBase = 0; // pause se pehle jama shuda seconds
  private onProgress: ProgressFn | null = null;

  seconds(): number {
    if (!this.startedAt) return this.elapsedBase;
    if (this.state === 'paused') return this.elapsedBase;
    return this.elapsedBase + (Date.now() - this.startedAt) / 1000;
  }

  private emit() { this.onProgress?.(this.bytes, this.seconds()); }

  async start(video: HTMLVideoElement, opts: { videoBitsPerSecond: number; sink?: WritableSink | null; onProgress?: ProgressFn }): Promise<{ mime: string }> {
    if (this.state !== 'idle') throw new RecorderError('failed', 'Recording pehle se chal rahi hai.');
    if (typeof MediaRecorder === 'undefined') throw new RecorderError('unsupported', 'Is browser me MediaRecorder supported nahi hai (Chrome/Edge/Firefox/Safari ke naye version try karein).');
    const mime = pickRecordingMime();
    if (!mime) throw new RecorderError('unsupported', 'Is browser me koi recording format supported nahi mila.');
    const capture = (video as unknown as { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream });
    const fn = capture.captureStream ?? capture.mozCaptureStream;
    if (!fn) throw new RecorderError('unsupported', 'Is browser me video capture supported nahi hai.');
    let stream: MediaStream;
    try { stream = fn.call(video); }
    catch { throw new RecorderError('blocked', 'Recording blocked — ye stream cross-origin/protected hai is liye browser capture allow nahi karta.'); }
    if (!stream || stream.getVideoTracks().length === 0) {
      throw new RecorderError('no-tracks', 'Abhi video track available nahi — stream play hone ke baad Record dabayein.');
    }
    this.mime = mime; this.stream = stream; this.sink = opts.sink ?? null; this.sinkFailed = false;
    this.chunks = []; this.bytes = 0; this.elapsedBase = 0; this.onProgress = opts.onProgress ?? null;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.videoBitsPerSecond, audioBitsPerSecond: 160_000 });
    } catch {
      try { rec = new MediaRecorder(stream, { mimeType: mime }); }
      catch { throw new RecorderError('failed', 'Recorder start nahi ho saka for selected quality.'); }
    }
    this.rec = rec;
    rec.ondataavailable = (e: BlobEvent) => {
      if (!e.data || e.data.size === 0) return;
      this.bytes += e.data.size;
      if (this.sink && !this.sinkFailed) {
        // Disk write fail ho to memory fallback — recording nahi marti.
        this.sink.write(e.data).catch(() => { this.sinkFailed = true; this.chunks.push(e.data); });
      } else this.chunks.push(e.data);
      this.emit();
    };
    this.startedAt = Date.now();
    this.state = 'recording';
    rec.start(1000); // 1s timeslice — progress + crash-safety
    this.emit();
    return { mime };
  }

  pause(): void {
    if (this.state !== 'recording' || !this.rec) return;
    try { this.rec.pause(); } catch { return; }
    this.elapsedBase = this.seconds(); this.startedAt = 0; this.state = 'paused'; this.emit();
  }

  resume(): void {
    if (this.state !== 'paused' || !this.rec) return;
    try { this.rec.resume(); } catch { return; }
    this.startedAt = Date.now(); this.state = 'recording'; this.emit();
  }

  async stop(): Promise<RecordingResult> {
    const rec = this.rec;
    const seconds = this.seconds();
    if (!rec) throw new RecorderError('failed', 'Koi active recording nahi hai.');
    const done = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
    try { if (rec.state !== 'inactive') rec.stop(); } catch { /* already stopped */ }
    await done;
    this.stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    const bytes = this.bytes;
    const ext = recordingExt(this.mime);
    let blob: Blob | null = null; let streamedToDisk = false;
    if (this.sink && !this.sinkFailed) {
      try { await this.sink.close(); streamedToDisk = true; } catch { /* file may be partial */ }
    } else {
      if (this.sink?.abort) { try { await this.sink.abort(); } catch { /* ignore */ } }
      blob = new Blob(this.chunks, { type: this.mime.split(';')[0] || 'video/webm' });
    }
    this.rec = null; this.stream = null; this.chunks = []; this.sink = null;
    this.state = 'idle'; this.startedAt = 0; this.elapsedBase = 0;
    return { blob, ext, mime: this.mime, bytes, seconds, streamedToDisk };
  }
}

export function downloadRecording(blob: Blob, base: string, ext: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${base}.${ext}`;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
