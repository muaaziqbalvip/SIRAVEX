/**
 * ClearKey parsing — tamam aam IPTV formats jo providers dete hain:
 *  - "kidHex:keyHex" (aik ya zyada, comma/semicolon/space se alag)
 *  - '{"kidHex":"keyHex"}' JSON map
 *  - '{"keys":[{"kty":"oct","kid":"<base64url>","k":"<base64url>"}]}' JWK set
 * Sirf user ki di hui provider keys parse hoti hain — koi extraction/bypass nahi.
 */
function b64UrlToHex(b64u: string): string {
  try {
    const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    return Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}
const cleanHex = (s: string) => s.replace(/-/g, '').trim().toLowerCase();
const isHexKey = (s: string) => /^[0-9a-f]{16,64}$/.test(s);

export function parseClearKeys(raw: string): Record<string, string> | null {
  const str = (raw || '').trim();
  if (!str) return null;
  if (str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str) as { keys?: { kid?: string; k?: string }[] } & Record<string, unknown>;
      if (Array.isArray(parsed.keys)) {
        const out: Record<string, string> = {};
        for (const k of parsed.keys) {
          const kid = b64UrlToHex(k.kid ?? ''); const key = b64UrlToHex(k.k ?? '');
          if (kid && key) out[kid.toLowerCase()] = key.toLowerCase();
        }
        return Object.keys(out).length ? out : null;
      }
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') { const ck = cleanHex(k); const cv = cleanHex(v); if (isHexKey(ck) && isHexKey(cv)) out[ck] = cv; }
      return Object.keys(out).length ? out : null;
    } catch { /* neeche colon-format try hoga */ }
  }
  const out: Record<string, string> = {};
  for (const pair of str.split(/[,;\s]+/).filter(Boolean)) {
    const [kid, key] = pair.split(':');
    if (kid && key) { const ck = cleanHex(kid); const cv = cleanHex(key); if (isHexKey(ck) && isHexKey(cv)) out[ck] = cv; }
  }
  return Object.keys(out).length ? out : null;
}

/** Bitrate ko insani label: 4_200_000 -> "4.2 Mbps", 800_000 -> "800 kbps". */
export function formatBitrate(bps?: number): string {
  if (!bps || !Number.isFinite(bps) || bps <= 0) return '';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}
