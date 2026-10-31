/**
 * SIRAVEX Universal HTTP->HTTPS Relay Helpers (100% Web-Standard / Edge V8 Compatible — zero Node Buffer dependency):
 *  - Only http(s), GET/HEAD/OPTIONS. Private/loopback/link-local hosts always blocked (SSRF guard).
 *  - Rewrites HLS (.m3u8) & DASH (.mpd) manifests so ALL nested HTTP playlists, AES keys, init maps,
 *    and .ts/.m4s media segments tunnel cleanly over HTTPS `/api/relay`.
 */
const PRIVATE_V4 = [
  /^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

const PRIVATE_V6_MAPPED = [
  /^::ffff:(?:7f|0?a[0-9a-f]{2}:|c0a8:|a9fe:|0+:)/i,
  /^::ffff:ac1[0-9a-f]:/i,
];

const BINARY_SEG_EXT = /\.(ts|m2ts|mts|m4s|cmfv|cmfa|mp4|m4v|m4a|mkv|webm|flv|aac|mp3|ac3|ec3|vtt|webvtt|key|jpg|jpeg|png|webp)$/i;

export function blockedHost(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return 'invalid URL'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'only http(s) allowed';
  const rawHost = u.hostname.toLowerCase();
  const host = rawHost.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return 'local host blocked';
  if (PRIVATE_V4.some((re) => re.test(host))) return 'private IP blocked';
  if (
    host === '::1' ||
    host === '::' ||
    host === '0:0:0:0:0:0:0:1' ||
    host === '0:0:0:0:0:0:0:0' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    PRIVATE_V6_MAPPED.some((re) => re.test(host))
  ) {
    return 'private IPv6 blocked';
  }
  const v4Mapped = host.startsWith('::ffff:') ? host.slice(7) : '';
  if (v4Mapped && PRIVATE_V4.some((re) => re.test(v4Mapped))) return 'private IPv6 blocked';
  return null;
}

export function relayLink(absUrl, base = '', ref = '', seg = false) {
  const refSuffix = ref ? `&ref=${encodeURIComponent(ref)}` : '';
  const segSuffix = seg ? '&seg=1' : '';
  return `${base}/api/relay?u=${encodeURIComponent(absUrl)}${refSuffix}${segSuffix}`;
}

function isBinarySegmentUrl(absUrl) {
  try {
    return BINARY_SEG_EXT.test(new URL(absUrl).pathname);
  } catch {
    return BINARY_SEG_EXT.test(String(absUrl).split('?')[0]);
  }
}

/** Rewrites every segment, AES key, init map, and nested variant playlist inside an HLS manifest through `/api/relay`. */
export function rewriteHlsManifest(text, manifestUrl, base = '', ref = '') {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        const isBinaryTag = /^#EXT-X-(KEY|MAP|PART|PRELOAD-HINT)\b/i.test(trimmed);
        return trimmed.replace(/URI=(["'])([^"']+)\1/gi, (full, quote, uri) => {
          try {
            const abs = new URL(uri, manifestUrl).toString();
            return `URI=${quote}${relayLink(abs, base, ref, isBinaryTag || isBinarySegmentUrl(abs))}${quote}`;
          } catch {
            return full;
          }
        });
      }
      try {
        const abs = new URL(trimmed, manifestUrl).toString();
        return relayLink(abs, base, ref, isBinarySegmentUrl(abs));
      } catch {
        return line;
      }
    })
    .join('\n');
}

/**
 * DASH MPD rewrite: routes BaseURL and SegmentTemplate media/initialization URLs through `/api/relay`
 * while keeping `$Number$` / `$RepresentationID$` tokens intact for Shaka substitution.
 */
export function rewriteDashMpd(text, mpdUrl, base = '', ref = '') {
  const refSuffix = ref ? `&ref=${encodeURIComponent(ref)}` : '';
  const shield = (s) => {
    const tokens = [];
    const safe = String(s).replace(/\$([A-Za-z0-9_%]+)\$/g, (_, inner) => { tokens.push(inner); return `__DT${tokens.length - 1}__`; });
    return { safe, tokens };
  };
  const segLink = (rawUri) => {
    if (!rawUri || rawUri.startsWith('data:') || rawUri.includes('/api/relay?')) return rawUri;
    const { safe, tokens } = shield(rawUri);
    if (tokens.length) {
      let enc = encodeURIComponent(safe);
      tokens.forEach((inner, i) => { enc = enc.replace(new RegExp(`__DT${i}__`, 'g'), `$${inner}$`); });
      const baseTok = encodeURIComponent(mpdUrl);
      return `${base}/api/relay?seg=1&u=${baseTok}&tpl=${enc}${refSuffix}`;
    }
    try { return `${relayLink(new URL(rawUri, mpdUrl).toString(), base, ref, true)}`; } catch { return rawUri; }
  };
  let out = String(text || '');
  out = out.replace(/(<BaseURL>)([^<]+)(<\/BaseURL>)/gi, (_, a, uri, c) => {
    try { return `${a}${relayLink(new URL(uri.trim(), mpdUrl).toString(), base, ref)}${c}`; } catch { return _; }
  });
  out = out.replace(/(\bmedia=")([^"]+)(")/gi, (_, a, uri, c) => `${a}${segLink(uri)}${c}`);
  out = out.replace(/(\binitialization=")([^"]+)(")/gi, (_, a, uri, c) => `${a}${segLink(uri)}${c}`);
  out = out.replace(/(\bsourceURL=")([^"]+)(")/gi, (_, a, uri, c) => `${a}${segLink(uri)}${c}`);
  return out;
}
