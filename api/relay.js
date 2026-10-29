import { blockedHost, rewriteDashMpd, rewriteHlsManifest } from './_relay-lib.js';

/**
 * SIRAVEX media relay (/api/relay?u=<url>) — Vercel serverless function.
 * Kaam: CORS/custom-port (:5789 waghera) wale authorized streams ko browser
 * tak pohanchana. Direct playback hamesha pehle try hota hai (client ladder);
 * ye sirf aakhri candidate hai.
 * Hudood: GET only · http(s) only · private/loopback hosts blocked ·
 * manifests <= 2 MB · 15s upstream timeout · koi cookies/headers forward nahi.
 */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET') { res.statusCode = 405; return res.end('GET only'); }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const base = `${proto}://${host}`;
  const q = new URL(req.url, base).searchParams;

  let target = String(q.get('u') || '').trim();
  const tpl = q.get('tpl');
  if (tpl && target) {
    try { target = new URL(tpl, target).toString(); } catch { res.statusCode = 400; return res.end('bad template'); }
  }
  if (!target) { res.statusCode = 400; return res.end('missing u'); }
  const blockReason = blockedHost(target);
  if (blockReason) { res.statusCode = 403; return res.end(`blocked: ${blockReason}`); }

  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' };
  if (q.get('ref')) headers.Referer = String(q.get('ref'));
  if (req.headers.range) headers.Range = req.headers.range;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let upstream;
  try {
    upstream = await fetch(target, { headers, redirect: 'follow', signal: ctrl.signal });
  } catch {
    clearTimeout(timer);
    res.statusCode = 502; return res.end('upstream unreachable');
  }
  clearTimeout(timer);
  if (!upstream.ok && upstream.status !== 206) { res.statusCode = upstream.status || 502; return res.end(`upstream ${upstream.status}`); }

  const finalUrl = upstream.url || target;
  const ctype = (upstream.headers.get('content-type') || '').toLowerCase();
  const pathPart = finalUrl.split('?')[0].toLowerCase();
  const isManifestPath = pathPart.endsWith('.m3u8') || pathPart.endsWith('.m3u') || pathPart.endsWith('.mpd');

  if (isManifestPath || ctype.includes('mpegurl') || ctype.includes('dash+xml')) {
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.byteLength > 2 * 1024 * 1024) { res.statusCode = 413; return res.end('manifest too large'); }
    const text = buf.toString('utf8');
    if (text.includes('#EXTM3U') || ctype.includes('mpegurl')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(rewriteHlsManifest(text, finalUrl, base));
    }
    if (text.includes('<MPD') || ctype.includes('dash+xml')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/dash+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(rewriteDashMpd(text, finalUrl, base));
    }
    // Manifest path par binary (kabhi kabhi TS seedha) — pipe kar do
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
  if (!upstream.body) return res.end();
  const reader = upstream.body.getReader();
  req.on('close', () => { try { reader.cancel(); } catch { /* ignore */ } });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  return res.end();
}
