import type { StreamFormat } from '@/playback/capabilities/capabilities';

export interface SourceCandidate { url: string; format: StreamFormat; via: 'direct' | 'relay'; label: string }

/** Relay (/api/relay) URL — optional Referer ke saath jab M3U #EXTVLCOPT de. */
export function relayUrlFor(raw: string, referrer?: string): string {
  const ref = referrer && /^https?:\/\//i.test(referrer) ? `&ref=${encodeURIComponent(referrer)}` : '';
  return `/api/relay?u=${encodeURIComponent(raw)}${ref}`;
}

const XTREAM_DEEP = /\/(live|movie|series)\/[^/]+\/[^/]+\/[^/]+/i;

export interface CandidateOptions {
  forced?: string;
  relay?: boolean;
  /** True jab page HTTPS par ho: http:// stream direct Mixed-Content block hota hai, is liye relay pehle aata hai. */
  httpsPage?: boolean;
  referrer?: string;
}

/**
 * Failover ladder — BarakatWave + SIRAVEX hybrid:
 *  1) Asal format direct (magar HTTPS page par HTTP link ho to Relay pehle taake Mixed-Content foran bypass ho)
 *  2) Xtream gehri path (/live/user/pass/id) par usi server ka doosra variant (.m3u8 <-> .ts)
 *  3) Extension-less par HLS -> MPEG-TS -> Native chain
 *  4) Guarded server relay (/api/relay) CORS / custom-port (:5789, :8080) wale servers ke liye
 */
export function buildCandidates(url: string, format: StreamFormat, opts: CandidateOptions = {}): SourceCandidate[] {
  const forced = !!opts.forced && opts.forced !== 'auto';
  const isRemoteHttp = /^https?:\/\//i.test(url);
  const mixedContentBlocked = Boolean(opts.httpsPage && opts.relay && /^http:\/\//i.test(url));
  let path = url;
  try { path = new URL(url).pathname.toLowerCase(); } catch { path = url.split('?')[0].toLowerCase(); }

  const directList: SourceCandidate[] = [{ url, format, via: 'direct', label: format.toUpperCase() }];
  let altVariantUrl = '';
  let altVariantFmt: StreamFormat | null = null;

  if (!forced) {
    if (format === 'hls' && XTREAM_DEEP.test(path) && path.endsWith('.m3u8')) {
      altVariantUrl = url.replace(/\.m3u8(?=(\?|#|$))/i, '.ts');
      altVariantFmt = 'mpegts';
      directList.push({ url: altVariantUrl, format: 'mpegts', via: 'direct', label: 'MPEG-TS (same server)' });
    } else if (format === 'mpegts' && XTREAM_DEEP.test(path) && path.endsWith('.ts')) {
      altVariantUrl = url.replace(/\.ts(?=(\?|#|$))/i, '.m3u8');
      altVariantFmt = 'hls';
      directList.push({ url: altVariantUrl, format: 'hls', via: 'direct', label: 'HLS (same server)' });
    } else if (format === 'unknown') {
      directList.splice(
        0,
        directList.length,
        { url, format: 'hls', via: 'direct', label: 'HLS' },
        { url, format: 'mpegts', via: 'direct', label: 'MPEG-TS' },
        { url, format: 'native', via: 'direct', label: 'Native' },
      );
    }
  }

  const relayList: SourceCandidate[] = [];
  if (opts.relay && isRemoteHttp) {
    if (['hls', 'dash', 'mpegts', 'flv'].includes(format)) {
      relayList.push({ url: relayUrlFor(url, opts.referrer), format, via: 'relay', label: `${format.toUpperCase()} · Relay` });
      if (altVariantUrl && altVariantFmt) {
        relayList.push({ url: relayUrlFor(altVariantUrl, opts.referrer), format: altVariantFmt, via: 'relay', label: `${altVariantFmt.toUpperCase()} · Relay` });
      }
    } else if (format === 'unknown') {
      relayList.push(
        { url: relayUrlFor(url, opts.referrer), format: 'hls', via: 'relay', label: 'HLS · Relay' },
        { url: relayUrlFor(url, opts.referrer), format: 'mpegts', via: 'relay', label: 'MPEG-TS · Relay' },
      );
    } else if (format === 'native' && mixedContentBlocked) {
      relayList.push({ url: relayUrlFor(url, opts.referrer), format: 'native', via: 'relay', label: 'MEDIA · Relay' });
    }
  }

  return mixedContentBlocked ? [...relayList, ...directList] : [...directList, ...relayList];
}
