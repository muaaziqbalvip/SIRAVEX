import type { StreamFormat } from '@/playback/capabilities/capabilities';

export interface SourceCandidate { url: string; format: StreamFormat; via: 'direct' | 'relay'; label: string }

/** Relay (api/relay) ka URL — sirf production build mein istemal hota hai jahan Vercel function mojood hai. */
export function relayUrlFor(raw: string): string {
  return `/api/relay?u=${encodeURIComponent(raw)}`;
}

const XTREAM_DEEP = /\/(live|movie|series)\/[^/]+\/[^/]+\/[^/]+/i;

/**
 * Failover ladder — BarakatWave-style magar mehfooz hudood ke saath:
 *  1) Asal format direct
 *  2) Xtream gehri path (/live/user/pass/id) par usi server ka doosra variant (.m3u8 <-> .ts)
 *  3) Extension-less par HLS -> MPEG-TS -> Native chain
 *  4) Aakhri umeed: apna guarded server relay (CORS/custom-port wale servers ke liye)
 * Relay kabhi pehla candidate nahi banta — direct hamesha pehle try hota hai.
 */
export function buildCandidates(url: string, format: StreamFormat, opts: { forced?: string; relay?: boolean } = {}): SourceCandidate[] {
  const forced = !!opts.forced && opts.forced !== 'auto';
  let path = url;
  try { path = new URL(url).pathname.toLowerCase(); } catch { path = url.split('?')[0].toLowerCase(); }
  const list: SourceCandidate[] = [{ url, format, via: 'direct', label: format.toUpperCase() }];
  if (!forced) {
    if (format === 'hls' && XTREAM_DEEP.test(path) && path.endsWith('.m3u8')) {
      list.push({ url: url.replace(/\.m3u8(?=(\?|#|$))/i, '.ts'), format: 'mpegts', via: 'direct', label: 'MPEG-TS (same server)' });
    } else if (format === 'mpegts' && XTREAM_DEEP.test(path) && path.endsWith('.ts')) {
      list.push({ url: url.replace(/\.ts(?=(\?|#|$))/i, '.m3u8'), format: 'hls', via: 'direct', label: 'HLS (same server)' });
    } else if (format === 'unknown') {
      list.splice(0, list.length,
        { url, format: 'hls', via: 'direct', label: 'HLS' },
        { url, format: 'mpegts', via: 'direct', label: 'MPEG-TS' },
        { url, format: 'native', via: 'direct', label: 'Native' });
    }
  }
  if (opts.relay && /^https?:\/\//i.test(url) && ['hls', 'dash', 'mpegts', 'flv'].includes(format)) {
    list.push({ url: relayUrlFor(url), format, via: 'relay', label: `${format.toUpperCase()} · Relay` });
  } else if (opts.relay && /^https?:\/\//i.test(url) && format === 'unknown') {
    list.push({ url: relayUrlFor(url), format: 'hls', via: 'relay', label: 'HLS · Relay' });
  }
  return list;
}
