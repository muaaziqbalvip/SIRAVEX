import { urlHost } from '@/lib/security';
export type PlaybackCategory = 'network' | 'auth' | 'cors' | 'drm' | 'unsupported-format' | 'unsupported-codec' | 'decode' | 'offline' | 'unknown';
export interface PlaybackErrorInfo { category: PlaybackCategory; message: string; retryable: boolean; action: string; codeLabel?: string }

const UNSUPPORTED_MSG = 'This source uses a transport (for example RTSP or RTMP) that browsers cannot play directly. It needs a browser-compatible format (HLS, DASH, MPEG-TS or FLV) or an authorized gateway/transcoder from your provider.';

/**
 * Shaka error codes (shaka.util.Error): 1xxx network/http, 4xxx manifest,
 * 6xxx DRM. Pehle ye codes phenk diye jate thay — is liye user ko sirf
 * "unknown" nazar aata tha. Ab har code ka matlab + code label milega.
 */
export function shakaCategory(code: number): { category: PlaybackCategory; message: string; action: string } | null {
  if (code >= 6000 && code < 7000) return { category: 'drm', message: 'This stream is DRM-protected and no working licence was configured for it.', action: 'Open it via Play Stream → Advanced and add the licence URL or ClearKey (kid:key) your provider issued — or use your provider’s own app. Keys are never bypassed or extracted.' };
  if (code === 1001) return { category: 'auth', message: 'The stream server returned an HTTP error (often 401/403/404). The link may have expired or the server refused the request.', action: 'Re-import/refresh the source or generate a fresh link from your provider, then retry.' };
  if (code >= 1000 && code < 2000) return { category: 'cors', message: 'The manifest or segments could not be downloaded (network/CORS). The server may not allow browser playback.', action: 'Retry once. If it persists, the provider must allow web playback (CORS) — try their app or ask for browser access.' };
  if (code >= 4000 && code < 5000) return { category: 'unsupported-format', message: 'The DASH manifest is invalid, empty or uses features this browser cannot play.', action: 'Try the HLS version of this channel if your provider offers one (Play Stream → format HLS).' };
  if (code >= 3000 && code < 4000) return { category: 'unsupported-codec', message: 'The media inside this stream could not be decoded by this browser.', action: 'Try Chrome/Edge, or ask your provider for H.264/AAC renditions.' };
  if (code >= 7000 && code < 8000) return { category: 'unsupported-format', message: 'Playback was restricted by the player (for example missing decryption keys for protected content).', action: 'If your provider issued licence keys, add them in Play Stream → Advanced; otherwise use the provider app.' };
  return null;
}

/**
 * Shaka apne RECOVERABLE errors (severity 1) khud retry karta hai — un par
 * error screen kholna ghalat hai. Sirf CRITICAL (severity 2) asal failure hai.
 * Detail ghair maujood ho to purani hifazat: critical samjho (error na chhupayein).
 */
export function isShakaCritical(detail?: { severity?: number } | null): boolean {
  if (!detail) return true;
  return detail.severity !== 1;
}

export function mapPlaybackError(input: { code?: number; shakaCode?: number; message?: string; url?: string; format?: string; detailCode?: string }): PlaybackErrorInfo {
  const msg = (input.message || '').toLowerCase();
  const codeLabel = input.detailCode ?? (input.shakaCode ? `DASH error ${input.shakaCode}` : input.code ? `Media error ${input.code}` : undefined);
  const withCode = (info: Omit<PlaybackErrorInfo, 'codeLabel'>): PlaybackErrorInfo => ({ ...info, codeLabel });
  if (typeof navigator !== 'undefined' && !navigator.onLine) return withCode({ category: 'offline', message: 'You appear to be offline. Live streams need an internet connection.', retryable: true, action: 'Check your connection, then retry.' });
  if (input.shakaCode) { const mapped = shakaCategory(input.shakaCode); if (mapped) return withCode({ ...mapped, retryable: mapped.category !== 'drm' }); }
  if (input.format === 'unsupported' || /rtsp|rtmp/.test(input.url || '')) return withCode({ category: 'unsupported-format', message: UNSUPPORTED_MSG, retryable: false, action: 'Ask your provider for an HLS (.m3u8), DASH (.mpd), MPEG-TS or FLV version of this channel.' });
  if (/drm|widevine|playready|licen[cs]e|decrypt|key system|eme/.test(msg)) return withCode({ category: 'drm', message: 'This stream is DRM-protected and no working licence was configured for it.', retryable: false, action: 'Add your provider-issued licence URL or ClearKey in Play Stream → Advanced, or use the provider’s own app.' });
  if (/401|403|unauthor|forbidden|expired/.test(msg)) return withCode({ category: 'auth', message: 'The source refused access. Your provider session may have expired or the maximum connections may be reached.', retryable: true, action: 'Reconnect or refresh your playlist, then try again.' });
  if (/cors|access-control|failed to fetch|networkerror|load failed/.test(msg)) return withCode({ category: 'cors', message: `The stream server at ${input.url ? urlHost(input.url) : 'the source'} did not allow browser playback (often a CORS or provider restriction), or it could not be reached.`, retryable: true, action: 'Try the source provider app, or ask the provider to allow web playback. Importing the playlist file locally does not bypass stream CORS.' });
  if (/decode|demux|codec|not supported|src not supported/.test(msg) || input.code === 4) return withCode({ category: 'unsupported-codec', message: 'The browser cannot decode this stream. The codec or container is not supported in this browser.', retryable: false, action: 'Try a different browser, or ask your provider for H.264/AAC in HLS or DASH.' });
  if (input.code === 2 || /network|timeout|aborted|empty/.test(msg)) return withCode({ category: 'network', message: 'The stream could not be loaded. The source may be offline or the network was interrupted.', retryable: true, action: 'Retry, or choose another channel from the same playlist.' });
  if (input.code === 3) return withCode({ category: 'decode', message: 'Playback was interrupted by a decoding error.', retryable: true, action: 'Retry playback. If it keeps failing, the stream itself may be damaged.' });
  if (input.detailCode) return withCode({ category: 'network', message: `The player reported “${input.detailCode}”. The stream could not be played in this browser session.`, retryable: true, action: 'Retry once. Still failing? Open Diagnostics — the code shown there (host only, no private link) identifies the exact cause.' });
  return withCode({ category: 'unknown', message: 'Playback failed, but the player gave no detailed reason.', retryable: true, action: 'Retry once. Still failing? Try Play Stream with a manual format, or check Diagnostics for the error history.' });
}
