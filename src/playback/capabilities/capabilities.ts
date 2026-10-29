export interface Capabilities {
  hlsNative: boolean; hlsJs: boolean; dash: boolean; mse: boolean; mpegts: boolean;
  mp4: boolean; webm: boolean; pip: boolean; fullscreen: boolean;
  serviceWorker: boolean; indexedDB: boolean; online: boolean;
}
export function detectCapabilities(): Capabilities {
  const video = document.createElement('video');
  const mse = typeof MediaSource !== 'undefined';
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
 * Format detection from the URL PATHNAME only — query strings (auth tokens,
 * ?q=auto, channel_id) must never break detection. This is what makes links like
 * `https://host/render.mpd?auth=...&channel_id=917&q=auto` detect as DASH.
 */
export function formatOf(url: string, forced?: string): StreamFormat {
  if (forced && forced !== 'auto') {
    const f = forced.toLowerCase();
    if (['hls', 'dash', 'mpegts', 'flv', 'native'].includes(f)) return f as StreamFormat;
    if (f === 'ts') return 'mpegts';
    if (f === 'mp4') return 'native';
  }
  let path = url;
  try { path = new URL(url).pathname; } catch { path = url.split('?')[0]; }
  const clean = path.toLowerCase();
  if (/^(rtsp|rtmp|udp):\/\//i.test(url)) return 'unsupported';
  if (clean.endsWith('.m3u8')) return 'hls';
  if (clean.endsWith('.mpd')) return 'dash';
  if (clean.endsWith('.ts')) return 'mpegts';
  if (clean.endsWith('.flv')) return 'flv';
  if (/\.(mp4|m4v|mov|webm|mkv|mp3|aac|ogg|opus|wav)$/.test(clean)) return 'native';
  // Extension-less endpoints: sniff well-known hints, else let the native element try.
  if (/(^|\/)(render|manifest|playlist|stream|live)(\.|$)/.test(clean) || /[?&](format|type)=(mpd|dash)/.test(url)) return 'dash';
  if (/\.ism(\/|$)/.test(clean)) return 'hls'; // Smooth Streaming .ism -> usually served as HLS via /manifest(format=m3u8-aapl)
  return 'unknown';
}
