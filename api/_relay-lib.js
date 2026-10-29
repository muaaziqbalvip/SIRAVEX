/**
 * SIRAVEX relay helpers — mehfooz hudood:
 *  - Sirf http(s), GET. Private/loopback/link-local hosts hamesha blocked (SSRF guard).
 *  - Sirf media: HLS/DASH manifests rewrite hote hain, segments binary pipe hote hain.
 *  - Koi header/cookie forward nahi hota. Referer/User-Agent sirf jab client bheje.
 * Note: DNS-rebinding ke khilaf mukammal hifazat ke liye production mein
 * apne domain ki allowlist behtar hai; yahan hostname/IP-level guard hai.
 */
const PRIVATE_V4 = [
  /^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export function blockedHost(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return 'invalid URL'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'only http(s) allowed';
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return 'local host blocked';
  if (PRIVATE_V4.some((re) => re.test(host))) return 'private IP blocked';
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return 'private IPv6 blocked';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) === false && host.includes(':')) return null; // hostname, allow
  return null;
}

export function relayLink(absUrl, base) {
  return `${base}/api/relay?u=${encodeURIComponent(absUrl)}`;
}

/** HLS manifest ki har segment/key/sub-playlist line ko relay se guzaro. */
export function rewriteHlsManifest(text, manifestUrl, base) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return trimmed.replace(/URI="([^"]+)"/gi, (_, uri) => {
          try { return `URI="${relayLink(new URL(uri, manifestUrl).toString(), base)}"`; } catch { return _; }
        });
      }
      try { return relayLink(new URL(trimmed, manifestUrl).toString(), base); } catch { return line; }
    })
    .join('\n');
}

/**
 * DASH MPD rewrite: BaseURL aur SegmentTemplate ke media/initialization
 * URLs relay se. $Number$ jese templates byte-identical rehte hain —
 * Shaka unhein request se pehle khud substitute karta hai; server
 * `tpl` ko base directory ke against resolve karta hai, badalta nahi.
 */
export function rewriteDashMpd(text, mpdUrl, base) {
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
      return `${base}/api/relay?seg=1&u=${baseTok}&tpl=${enc}`;
    }
    try { return `${relayLink(new URL(rawUri, mpdUrl).toString(), base)}&seg=1`; } catch { return rawUri; }
  };
  let out = String(text || '');
  out = out.replace(/(<BaseURL>)([^<]+)(<\/BaseURL>)/gi, (_, a, uri, c) => {
    try { return `${a}${relayLink(new URL(uri.trim(), mpdUrl).toString(), base)}${c}`; } catch { return _; }
  });
  out = out.replace(/(\bmedia=")([^"]+)(")/gi, (_, a, uri, c) => `${a}${segLink(uri)}${c}`);
  out = out.replace(/(\binitialization=")([^"]+)(")/gi, (_, a, uri, c) => `${a}${segLink(uri)}${c}`);
  out = out.replace(/(\bsourceURL=")([^"]+)(")/gi, (_, a, uri, c) => `${a}${segLink(uri)}${c}`);
  return out;
}
