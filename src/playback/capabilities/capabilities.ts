export interface Capabilities {
  hlsNative: boolean; hlsJs: boolean; dash: boolean; mse: boolean;
  mp4: boolean; webm: boolean; pip: boolean; fullscreen: boolean;
  serviceWorker: boolean; indexedDB: boolean; online: boolean;
}
export function detectCapabilities(): Capabilities {
  const video = document.createElement('video');
  let hlsJs = false;
  try { hlsJs = typeof MediaSource !== 'undefined'; } catch { hlsJs = false; }
  return {
    hlsNative: video.canPlayType('application/vnd.apple.mpegurl') !== '',
    hlsJs,
    dash: typeof MediaSource !== 'undefined',
    mse: typeof MediaSource !== 'undefined',
    mp4: video.canPlayType('video/mp4') !== '',
    webm: video.canPlayType('video/webm') !== '',
    pip: 'pictureInPictureEnabled' in document,
    fullscreen: 'requestFullscreen' in document.documentElement,
    serviceWorker: 'serviceWorker' in navigator,
    indexedDB: 'indexedDB' in window,
    online: navigator.onLine,
  };
}
export function formatOf(url: string): 'hls' | 'dash' | 'native' | 'unsupported' {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.m3u8')) return 'hls';
  if (clean.endsWith('.mpd')) return 'dash';
  if (/^(rtsp|rtmp):\/\//i.test(url) || clean.endsWith('.ts')) return 'unsupported';
  return 'native';
}
