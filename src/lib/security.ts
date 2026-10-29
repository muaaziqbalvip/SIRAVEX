/** Security helpers: validate, sanitize and redact. Never log raw private URLs. */
export function isHttpUrl(raw: string): boolean {
  try { const u = new URL(raw.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
}
export function sanitizeUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v || /^(javascript|data|vbscript|file):/i.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch { return null; }
}
/** Host-only display so credentials/query tokens never appear in UI or logs. */
export function redactUrl(raw: string): string {
  try { const u = new URL(raw); return `${u.protocol}//${u.host}`; } catch { return 'invalid-url'; }
}
export function urlHost(raw: string): string { try { return new URL(raw).host; } catch { return 'unknown'; } }
export function detectKindFromUrl(url: string): 'live' | 'movie' | 'series-episode' | 'unknown' {
  const u = url.toLowerCase();
  if (u.includes('/series/')) return 'series-episode';
  if (u.includes('/movie/')) return 'movie';
  if (u.includes('/live/')) return 'live';
  return 'unknown';
}
export const MAX_PLAYLIST_BYTES = 15 * 1024 * 1024;
export const MAX_EPG_BYTES = 25 * 1024 * 1024;
export function validatePlaylistFile(file: File): string | null {
  if (file.size === 0) return 'The selected file is empty.';
  if (file.size > MAX_PLAYLIST_BYTES) return `File is too large (${(file.size / 1048576).toFixed(1)} MB). Maximum is 15 MB.`;
  const name = file.name.toLowerCase();
  if (!/\.(m3u|m3u8|txt)$/.test(name)) return 'Unsupported file type. Choose an .m3u or .m3u8 playlist file.';
  return null;
}
/**
 * Xtream-style servers serve the SAME stream as .ts or .m3u8 — browsers need the HLS variant.
 * Rewriting `/live|movie|series/<user>/<pass>/<id>.ts` -> `.m3u8` is the provider's own
 * documented HLS output (what output=m3u8 does), not a bypass. Generic .ts stays unsupported.
 */
export function normalizeStreamUrl(raw: string): string {
  const clean = sanitizeUrl(raw);
  if (!clean) return raw;
  try {
    const u = new URL(clean);
    if (/\.ts$/i.test(u.pathname) && /^\/(live|movie|series)\//i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\.ts$/i, '.m3u8');
      return u.toString();
    }
  } catch { /* keep original */ }
  return clean;
}

export function classifyFormat(url: string): 'hls' | 'dash' | 'mpegts' | 'flv' | 'native' | 'unsupported' {
  let path = url;
  try { path = new URL(url).pathname; } catch { path = url.split('?')[0]; }
  const clean = path.toLowerCase();
  if (clean.endsWith('.m3u8')) return 'hls';
  if (clean.endsWith('.mpd')) return 'dash';
  if (clean.endsWith('.ts')) return 'mpegts';
  if (clean.endsWith('.flv')) return 'flv';
  if (/\.(mp4|webm|mov|m4v|mkv|mp3|aac|ogg|opus)$/.test(clean)) return 'native';
  if (/^(rtsp|rtmp|udp|mmsh?):\/\//i.test(url)) return 'unsupported';
  return 'native';
}
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
