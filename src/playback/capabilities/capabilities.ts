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
  // Extension-less endpoints: sirf WAZEH DASH hint par dash. Pehle har
  // /stream, /live, /playlist wale URL ko DASH guess kiya jata tha — ghalat
  // engine matlab guaranteed error screen. Baqi native attempt karega aur
  // user Play Stream se format force kar sakta hai.
  if (/[?&](format|type)=(mpd|dash)/.test(url) || /(^|\/)render(\.|$)/.test(clean)) return 'dash';
  if (/\.ism(\/|$)/.test(clean) || /manifest\(format=m3u8/.test(url.toLowerCase())) return 'hls';
  return 'unknown';
}
