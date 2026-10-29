import { urlHost } from '@/lib/security';
export type PlaybackCategory = 'network' | 'auth' | 'cors' | 'unsupported-format' | 'unsupported-codec' | 'decode' | 'offline' | 'unknown';
export interface PlaybackErrorInfo { category: PlaybackCategory; message: string; retryable: boolean; action: string }

const UNSUPPORTED_MSG = 'This source uses a format or transport (for example RTSP, RTMP or raw MPEG-TS) that browsers cannot play directly. It needs a browser-compatible format (HLS/DASH) or an authorized gateway/transcoder from your provider.';

export function mapPlaybackError(input: { code?: number; message?: string; url?: string; format?: string }): PlaybackErrorInfo {
  const msg = (input.message || '').toLowerCase();
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { category: 'offline', message: 'You appear to be offline. Live streams need an internet connection.', retryable: true, action: 'Check your connection, then retry.' };
  if (input.format === 'unsupported' || /rtsp|rtmp|\.ts(\?|$)/.test(input.url || '')) return { category: 'unsupported-format', message: UNSUPPORTED_MSG, retryable: false, action: 'Ask your provider for an HLS (.m3u8) or DASH (.mpd) version of this channel.' };
  if (/401|403|unauthor|forbidden|expired/.test(msg)) return { category: 'auth', message: 'The source refused access. Your provider session may have expired or the maximum connections may be reached.', retryable: true, action: 'Reconnect or refresh your playlist, then try again.' };
  if (/cors|access-control|failed to fetch|networkerror|load failed/.test(msg)) return { category: 'cors', message: `The stream server at ${input.url ? urlHost(input.url) : 'the source'} did not allow browser playback (often a CORS or provider restriction), or it could not be reached.`, retryable: true, action: 'Try the source provider app, or ask the provider to allow web playback. Importing the playlist file locally does not bypass stream CORS.' };
  if (/decode|demux|codec|not supported|src not supported|format/.test(msg) || input.code === 4) return { category: 'unsupported-codec', message: 'The browser cannot decode this stream. The codec or container is not supported in this browser.', retryable: false, action: 'Try a different browser, or ask your provider for H.264/AAC in HLS or DASH.' };
  if (input.code === 2 || /network|timeout|aborted|empty/.test(msg)) return { category: 'network', message: 'The stream could not be loaded. The source may be offline or the network was interrupted.', retryable: true, action: 'Retry, or choose another channel from the same playlist.' };
  if (input.code === 3) return { category: 'decode', message: 'Playback was interrupted by a decoding error.', retryable: true, action: 'Retry playback. If it keeps failing, the stream itself may be damaged.' };
  return { category: 'unknown', message: 'Playback failed for an unknown reason.', retryable: true, action: 'Retry playback. Check Diagnostics for the sanitized error history.' };
}
