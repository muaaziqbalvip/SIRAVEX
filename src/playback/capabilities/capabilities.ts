export interface Capabilities {
  hlsNative: boolean; hlsJs: boolean; dash: boolean; mse: boolean; mpegts: boolean;
  mp4: boolean; webm: boolean; pip: boolean; fullscreen: boolean;
  serviceWorker: boolean; indexedDB: boolean; online: boolean;
}
export function detectCapabilities(): Capabilities {
  const video = document.createElement('video');
  const win = typeof window !== 'undefined' ? (window as unknown as { ManagedMediaSource?: unknown }) : {};
  const mse = typeof MediaSource !== 'undefined' || typeof win.ManagedMediaSource !== 'undefined';
  return {
    hlsNative: video.canPlayType('application/vnd.apple.mpegurl') !== '',
    hlsJs: mse,
    dash: mse,
    mse,
    mpegts: mse,
    mp4: video.canPlayType('video/mp4') !== '',
    webm: video.canPlayType('video/webm') !== '',
    pip: 'pictureInPictureEnabled' in document,
    fullscreen: 'requestFullscreen' in document.documentElement,
    serviceWorker: 'serviceWorker' in navigator,
    indexedDB: 'indexedDB' in window,
    online: navigator.onLine,
  };
}

export type StreamFormat = 'hls' | 'dash' | 'mpegts' | 'flv' | 'native' | 'unsupported' | 'unknown';

/**
 * Format detection from the URL PATHNAME (+ explicit query hints) — query strings
 * (auth tokens, ?q=auto, channel_id) never break detection. Also unwraps /api/relay?u=…
 * so relayed streams preserve their true upstream format.
 */
export function formatOf(url: string, forced?: string): StreamFormat {
  if (forced && forced !== 'auto') {
    const f = forced.toLowerCase().trim();
    if (['hls', 'dash', 'mpegts', 'flv', 'native'].includes(f)) return f as StreamFormat;
    if (f === 'm3u8' || f === 'ism') return 'hls';
    if (f === 'mpd') return 'dash';
    if (f === 'ts' || f === 'm2ts') return 'mpegts';
    if (f === 'mp4' || f === 'webm' || f === 'mkv') return 'native';
  }
  let target = (url || '').trim();
  if (target.includes('/api/relay?')) {
    try {
      const inner = new URL(target, 'http://localhost').searchParams.get('u');
      if (inner) target = inner;
    } catch { /* keep target */ }
  }
  if (/^(rtsp|rtmp|rtmps|udp|rtp|mms|mmsh):\/\//i.test(target)) return 'unsupported';
  let path = target;
  let search = '';
  try {
    const parsed = new URL(target);
    path = parsed.pathname;
    search = parsed.search.toLowerCase();
  } catch {
    const qIdx = target.indexOf('?');
    path = qIdx >= 0 ? target.slice(0, qIdx) : target;
    search = qIdx >= 0 ? target.slice(qIdx).toLowerCase() : '';
  }
  const clean = path.toLowerCase();
  if (clean.endsWith('.m3u8') || clean.endsWith('.m3u') || clean.includes('.m3u8/')) return 'hls';
  if (clean.endsWith('.mpd') || clean.includes('.mpd/')) return 'dash';
  if (clean.endsWith('.ts') || clean.endsWith('.m2ts')) return 'mpegts';
  if (clean.endsWith('.flv')) return 'flv';
  if (/\.(mp4|m4v|mov|webm|mkv|ogv|mp3|aac|m4a|ogg|opus|flac|wav)$/.test(clean)) return 'native';
  if (/[?&](format|type|output|manifest)=(m3u8|hls)\b/.test(search) || /manifest\(format=m3u8/i.test(target)) return 'hls';
  if (/[?&](format|type|output|manifest)=(mpd|dash)\b/.test(search) || /(^|\/)render(\.|$)/.test(clean) || /\.ism\/manifest/i.test(clean)) return 'dash';
  if (/[?&](format|type|output)=(ts|mpegts)\b/.test(search)) return 'mpegts';
  if (/[?&](format|type|output)=flv\b/.test(search)) return 'flv';
  return 'unknown';
}
