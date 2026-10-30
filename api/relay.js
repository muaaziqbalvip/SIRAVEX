import { blockedHost, rewriteDashMpd, rewriteHlsManifest } from './_relay-lib.js';

/**
 * SIRAVEX media relay (/api/relay?u=<url>) — Vercel serverless function + Vite middleware.
 * Kaam: CORS/custom-port (:5789 waghera) aur HTTP-on-HTTPS mixed-content wale
 * authorized streams ko browser tak pohanchana.
 * Hudood: GET/HEAD/OPTIONS only · http(s) only · private/loopback hosts blocked ·
 * manifests <= 4 MB · 15s upstream timeout · koi cookies/auth headers forward nahi.
 */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, Accept-Ranges');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end('GET only'); }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  const base = `${proto}://${host}`;
  const q = new URL(req.url, base).searchParams;

  let target = String(q.get('u') || '').trim();
  const tpl = q.get('tpl');
  const ref = String(q.get('ref') || '').trim();
  if (tpl && target) {
    try { target = new URL(tpl, target).toString(); } catch { res.statusCode = 400; return res.end('bad template'); }
  }
  if (!target) { res.statusCode = 400; return res.end('missing u'); }
  const blockReason = blockedHost(target);
  if (blockReason) { res.statusCode = 403; return res.end(`blocked: ${blockReason}`); }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    Accept: '*/*',
  };
  if (ref && /^https?:\/\//i.test(ref)) headers.Referer = ref;
  if (req.headers.range) headers.Range = req.headers.range;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let upstream;
  try {
    upstream = await fetch(target, { method: req.method, headers, redirect: 'follow', signal: ctrl.signal });
  } catch {
    clearTimeout(timer);
    res.statusCode = 502; return res.end('upstream unreachable');
  }
  clearTimeout(timer);

  const finalUrl = upstream.url || target;
  const finalBlock = blockedHost(finalUrl);
  if (finalBlock) { res.statusCode = 403; return res.end(`blocked redirect: ${finalBlock}`); }
  if (!upstream.ok && upstream.status !== 206) { res.statusCode = upstream.status || 502; return res.end(`upstream ${upstream.status}`); }

  if (req.method === 'HEAD') {
    res.statusCode = upstream.status;
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    return res.end();
  }

  const ctype = (upstream.headers.get('content-type') || '').toLowerCase();
  const pathPart = finalUrl.split('?')[0].toLowerCase();
  const isRaw = q.get('raw') === '1';
  const isSeg = q.get('seg') === '1' || isRaw;
  const isManifestPath = !isSeg && (pathPart.endsWith('.m3u8') || pathPart.endsWith('.m3u') || pathPart.endsWith('.mpd'));

  if (isManifestPath || (!isSeg && (ctype.includes('mpegurl') || ctype.includes('dash+xml')))) {
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > 4 * 1024 * 1024) { res.statusCode = 413; return res.end('manifest too large'); }
    const text = buf.toString('utf8');
    if (text.includes('#EXTM3U') || ctype.includes('mpegurl')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(rewriteHlsManifest(text, finalUrl, base, ref));
    }
    if (text.includes('<MPD') || ctype.includes('dash+xml')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/dash+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(rewriteDashMpd(text, finalUrl, base, ref));
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', ctype || 'video/mp2t');
    return res.end(buf);
  }

  // Binary segments / media: stream pipe, Range mehfooz
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', ctype || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=10');
  const len = upstream.headers.get('content-length');
  if (len) res.setHeader('Content-Length', len);
  const range = upstream.headers.get('content-range');
  if (range) res.setHeader('Content-Range', range);
  const acceptRanges = upstream.headers.get('accept-ranges');
  if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
  if (!upstream.body) return res.end();
  const reader = upstream.body.getReader();
  req.on('close', () => { try { reader.cancel(); } catch { /* ignore */ } });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } catch { /* client disconnected mid-segment */ }
  return res.end();
}
