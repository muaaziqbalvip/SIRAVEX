import type { StreamFormat } from '@/playback/capabilities/capabilities';

export interface SourceCandidate {
  url: string;
  format: StreamFormat;
  via: 'direct' | 'relay';
  label: string;
}

export interface RelayExtraOpts {
  userAgent?: string;
  mac?: string;
}

/** Relay (/api/relay) URL — optional Referer + `&seg=1` fast-path + custom User-Agent / Stalker MAC headers. */
export function relayUrlFor(raw: string, referrer?: string, seg = false, extra?: RelayExtraOpts): string {
  const ref = referrer && /^https?:\/\//i.test(referrer) ? `&ref=${encodeURIComponent(referrer)}` : '';
  const segParam = seg ? '&seg=1' : '';
  let hdrParams = '';
  if (extra?.mac) {
    hdrParams += `&ua=mag&mac=${encodeURIComponent(extra.mac)}`;
  } else if (extra?.userAgent) {
    hdrParams += `&uac=${encodeURIComponent(extra.userAgent)}`;
  }
  return `/api/relay?u=${encodeURIComponent(raw)}${ref}${segParam}${hdrParams}`;
}

const XTREAM_DEEP = /\/(live|movie|series)\/[^/]+\/[^/]+\/[^/]+/i;
const XTREAM_SHORT_LIVE = /^\/([^/]+)\/([^/]+\/\d+)$/;
const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;

export interface CandidateOptions {
  forced?: string;
  relay?: boolean;
  /** True jab page HTTPS par ho: http:// stream direct Mixed-Content block hota hai, is liye Edge Relay pehle aata hai. */
  httpsPage?: boolean;
  referrer?: string;
  userAgent?: string;
  mac?: string;
}

/** Builds `https://` upgraded URL(s) for domain-based `http://` links in case the origin also serves SSL (Cloudflare / Nginx 443). */
export function buildHttpsUpgradeUrls(rawHttpUrl: string): string[] {
  if (!/^http:\/\//i.test(rawHttpUrl)) return [];
  try {
    const u = new URL(rawHttpUrl);
    if (IPV4_HOST.test(u.hostname) || u.hostname === 'localhost') return [];
    const s = new URL(rawHttpUrl);
    s.protocol = 'https:';
    s.port = '';
    return [s.toString()];
  } catch {
    return [];
  }
}

/**
 * Universal HTTP + HTTPS + Xtream + Stalker MAC Failover Ladder:
 *  1) On HTTPS page with `http://` link OR Stalker MAC cookie stream: Edge Streaming Relay (`/api/relay`) comes FIRST!
 *  2) Xtream `/live/user/pass/id` automatic `.m3u8` <-> `.ts` sibling failover + short `/user/pass/id` -> `/live/...m3u8` bridge.
 *  3) Smart `https://` Direct Upgrade for domain-based `http://` links.
 *  4) Direct fallback (works natively on `https://` streams, `http://` localhost, or when browser Insecure Content is allowed).
 */
export function buildCandidates(url: string, format: StreamFormat, opts: CandidateOptions = {}): SourceCandidate[] {
  const forced = !!opts.forced && opts.forced !== 'auto';
  const isRemoteHttp = /^https?:\/\//i.test(url);
  const isPlainHttp = /^http:\/\//i.test(url);
  const needsRelayHeaders = Boolean(opts.mac);
  const relayFirst = Boolean(opts.relay && isRemoteHttp && ((opts.httpsPage && isPlainHttp) || needsRelayHeaders));
  const extraHdr: RelayExtraOpts | undefined = opts.mac || opts.userAgent ? { mac: opts.mac, userAgent: opts.userAgent } : undefined;

  let parsedUrl: URL | null = null;
  let path = url;
  try {
    parsedUrl = new URL(url);
    path = parsedUrl.pathname;
  } catch {
    path = url.split('?')[0];
  }
  const lowerPath = path.toLowerCase();

  const directList: SourceCandidate[] = [{ url, format, via: 'direct', label: format.toUpperCase() }];
  let altVariantUrl = '';
  let altVariantFmt: StreamFormat | null = null;

  if (!forced) {
    if (format === 'hls' && XTREAM_DEEP.test(lowerPath) && lowerPath.endsWith('.m3u8')) {
      altVariantUrl = url.replace(/\.m3u8(?=(\?|#|$))/i, '.ts');
      altVariantFmt = 'mpegts';
      directList.push({ url: altVariantUrl, format: 'mpegts', via: 'direct', label: 'MPEG-TS (same server)' });
    } else if (format === 'mpegts' && XTREAM_DEEP.test(lowerPath) && lowerPath.endsWith('.ts')) {
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
    const isBinaryPrimary = format === 'mpegts' || format === 'flv' || format === 'native';
    if (['hls', 'dash', 'mpegts', 'flv'].includes(format)) {
      relayList.push({
        url: relayUrlFor(url, opts.referrer, isBinaryPrimary, extraHdr),
        format,
        via: 'relay',
        label: `${format.toUpperCase()} · Relay`,
      });
      if (altVariantUrl && altVariantFmt) {
        const altBin = altVariantFmt === 'mpegts';
        relayList.push({
          url: relayUrlFor(altVariantUrl, opts.referrer, altBin, extraHdr),
          format: altVariantFmt,
          via: 'relay',
          label: `${altVariantFmt.toUpperCase()} · Relay`,
        });
      }
      // Stalker `/play/live.php?...&extension=ts` streams may also serve HLS or vice versa
      if (!altVariantUrl && !forced && format === 'mpegts' && /[?&]extension=ts\b/i.test(url)) {
        const hlsAlt = url.replace(/([?&]extension=)ts\b/i, '$1m3u8');
        relayList.push({
          url: relayUrlFor(hlsAlt, opts.referrer, false, extraHdr),
          format: 'hls',
          via: 'relay',
          label: 'HLS · Relay',
        });
      }
    } else if (format === 'unknown') {
      relayList.push(
        { url: relayUrlFor(url, opts.referrer, false, extraHdr), format: 'hls', via: 'relay', label: 'HLS · Relay' },
        { url: relayUrlFor(url, opts.referrer, true, extraHdr), format: 'mpegts', via: 'relay', label: 'MPEG-TS · Relay' },
      );
      // Classic extensionless Xtream `/user/pass/12345` -> also offer `/live/user/pass/12345.m3u8` via Relay (enables iOS Safari!)
      const shortMatch = parsedUrl ? XTREAM_SHORT_LIVE.exec(parsedUrl.pathname) : null;
      if (shortMatch && parsedUrl) {
        const hlsUpgrade = new URL(url);
        hlsUpgrade.pathname = `/live/${shortMatch[1]}/${shortMatch[2]}.m3u8`;
        relayList.push({
          url: relayUrlFor(hlsUpgrade.toString(), opts.referrer, false, extraHdr),
          format: 'hls',
          via: 'relay',
          label: 'Xtream HLS · Relay',
        });
      }
      if (relayFirst) {
        relayList.push({ url: relayUrlFor(url, opts.referrer, true, extraHdr), format: 'native', via: 'relay', label: 'MEDIA · Relay' });
      }
    } else if (format === 'native') {
      if (relayFirst || opts.userAgent) {
        relayList.push({ url: relayUrlFor(url, opts.referrer, true, extraHdr), format: 'native', via: 'relay', label: 'MEDIA · Relay' });
      }
    }
  }

  if (relayFirst) {
    const httpsUpgrades: SourceCandidate[] = [];
    if (!forced && isPlainHttp && !needsRelayHeaders) {
      const upgradedFmt: StreamFormat = format === 'unknown' ? 'hls' : format;
      for (const upUrl of buildHttpsUpgradeUrls(url)) {
        httpsUpgrades.push({ url: upUrl, format: upgradedFmt, via: 'direct', label: `${upgradedFmt.toUpperCase()} · HTTPS Upgrade` });
      }
    }
    return [...relayList, ...httpsUpgrades, ...directList];
  }

  return [...directList, ...relayList];
}
