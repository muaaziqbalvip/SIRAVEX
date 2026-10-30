import { blockedHost, rewriteDashMpd, rewriteHlsManifest } from './_relay-lib.js';

/**
 * SIRAVEX HyperSpeed Media Relay (/api/relay?u=<url>) — Vercel serverless + Vite middleware.
 * Upgrades:
 *  - Root-relative manifest URLs (`base = ''`) so HTTPS reverse proxies never leak `http://` Mixed-Content URLs.
 *  - First-chunk smart sniffing:
 *      1) Detects `#EXTM3U` / `<MPD` even on extensionless URLs with `text/plain` or `application/octet-stream`.
 *      2) When `expect=hls` is passed by HLS.js and upstream returns raw binary MPEG-TS (`0x47`), aborts in ~80ms
 *         with HTTP 415 + `X-Siravex-Detected: mpegts` instead of streaming binary video into XHR for 6 seconds!
 *  - Zero-buffering binary pipe (`X-Accel-Buffering: no`, `flushHeaders`, `drain` backpressure).
 */
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 9000;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Content-Type');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Content-Type, Accept-Ranges, X-Siravex-Detected',
  );
}

async function writeChunkWithBackpressure(res, chunk) {
  if (res.writableEnded || res.destroyed) return false;
  const ok = res.write(chunk);
  if (!ok) {
    await new Promise((resolve) => {
      const done = () => {
        res.off('drain', done);
        res.off('close', done);
        resolve();
      };
      res.once('drain', done);
      res.once('close', done);
    });
  }
  return !res.writableEnded && !res.destroyed;
}

async function pipeStreamToRes(req, res, reader, firstChunk) {
  let active = true;
  const cancelUpstream = () => {
    active = false;
    try { reader.cancel(); } catch { /* ignore */ }
  };
  req.once('close', cancelUpstream);
  res.once('close', cancelUpstream);
  try {
    if (firstChunk && firstChunk.byteLength > 0) {
      const ok = await writeChunkWithBackpressure(res, firstChunk);
      if (!ok) return;
    }
    while (active) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const ok = await writeChunkWithBackpressure(res, value);
      if (!ok) break;
    }
  } catch {
    /* client switched channel or upstream closed mid-segment */
  } finally {
    req.off('close', cancelUpstream);
    res.off('close', cancelUpstream);
    if (!res.writableEnded) res.end();
  }
}

async function readRemainingBytes(reader, firstChunk, maxBytes) {
  const chunks = [];
  let total = 0;
  if (firstChunk && firstChunk.byteLength > 0) {
    chunks.push(Buffer.from(firstChunk.buffer, firstChunk.byteOffset, firstChunk.byteLength));
    total += firstChunk.byteLength;
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      return null;
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total);
}

function sniffManifestKind(firstChunk) {
  if (!firstChunk || firstChunk.byteLength === 0) return 'none';
  // MPEG-TS packets always start with 0x47 sync byte (and at offset 188 if >= 189 bytes)
  if (firstChunk[0] === 0x47 && (firstChunk.byteLength < 189 || firstChunk[188] === 0x47)) {
    return 'mpegts';
  }
  const head = Buffer.from(
    firstChunk.buffer,
    firstChunk.byteOffset,
    Math.min(firstChunk.byteLength, 256),
  )
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (head.startsWith('#EXTM3U')) return 'hls';
  if (/^(<\?xml[\s\S]*?<MPD|<MPD\b)/i.test(head)) return 'dash';
  return 'binary';
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end('GET only'); }

  const q = new URL(req.url, 'http://localhost').searchParams;
  let target = String(q.get('u') || '').trim();
  const tpl = q.get('tpl');
  const ref = String(q.get('ref') || '').trim();
  const expectFmt = String(q.get('expect') || '').trim().toLowerCase();

  if (tpl && target) {
    try { target = new URL(tpl, target).toString(); } catch { res.statusCode = 400; return res.end('bad template'); }
  }
  if (!target) { res.statusCode = 400; return res.end('missing u'); }
  const blockReason = blockedHost(target);
  if (blockReason) { res.statusCode = 403; return res.end(`blocked: ${blockReason}`); }

  const headers = {
    'User-Agent': 'VLC/3.0.20 LibVLC/3.0.20 (SIRAVEX/4.2; Mozilla/5.0 Chrome/126)',
    Accept: '*/*',
    Connection: 'keep-alive',
  };
  if (ref && /^https?:\/\//i.test(ref)) headers.Referer = ref;
  if (req.headers.range) headers.Range = req.headers.range;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(target, { method: req.method, headers, redirect: 'follow', signal: ctrl.signal });
  } catch {
    clearTimeout(timer);
    res.statusCode = 502;
    return res.end('upstream unreachable');
  }
  clearTimeout(timer);

  const finalUrl = upstream.url || target;
  const finalBlock = blockedHost(finalUrl);
  if (finalBlock) {
    try { await upstream.body?.cancel(); } catch { /* ignore */ }
    res.statusCode = 403;
    return res.end(`blocked redirect: ${finalBlock}`);
  }
  if (!upstream.ok && upstream.status !== 206) {
    try { await upstream.body?.cancel(); } catch { /* ignore */ }
    res.statusCode = upstream.status || 502;
    return res.end(`upstream ${upstream.status}`);
  }

  const ctype = (upstream.headers.get('content-type') || '').toLowerCase();
  if (req.method === 'HEAD') {
    res.statusCode = upstream.status;
    if (ctype) res.setHeader('Content-Type', ctype);
    return res.end();
  }

  if (!upstream.body) {
    res.statusCode = upstream.status;
    return res.end();
  }

  const isRaw = q.get('raw') === '1';
  const isSeg = q.get('seg') === '1' || isRaw;
  const reader = upstream.body.getReader();

  // Fast path: known media segment or raw Xtream JSON fetch — zero manifest inspection!
  if (isSeg) {
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', ctype || 'application/octet-stream');
    res.setHeader('Cache-Control', isRaw ? 'no-store' : 'public, max-age=15');
    res.setHeader('X-Accel-Buffering', 'no');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    const range = upstream.headers.get('content-range');
    if (range) res.setHeader('Content-Range', range);
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
    res.flushHeaders?.();
    return pipeStreamToRes(req, res, reader, null);
  }

  // Peek at the very first chunk (~0ms) to distinguish HLS/DASH text manifests from live MPEG-TS/MP4 binary!
  let firstChunk = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        firstChunk = value;
        break;
      }
    }
  } catch {
    res.statusCode = 502;
    return res.end('upstream read error');
  }

  if (!firstChunk) {
    res.statusCode = 204;
    return res.end();
  }

  const sniffed = sniffManifestKind(firstChunk);
  const pathPart = finalUrl.split('?')[0].toLowerCase();
  const looksHls = sniffed === 'hls' || (sniffed !== 'mpegts' && (ctype.includes('mpegurl') || pathPart.endsWith('.m3u8')));
  const looksDash = sniffed === 'dash' || (sniffed !== 'mpegts' && (ctype.includes('dash+xml') || pathPart.endsWith('.mpd')));

  // CRITICAL FAST-FAIL: If HLS.js requested a manifest (`expect=hls`), do NOT stream infinite binary TS into XHR!
  if (expectFmt === 'hls' && !looksHls) {
    try { await reader.cancel(); } catch { /* ignore */ }
    res.statusCode = 415;
    res.setHeader('X-Siravex-Detected', looksDash ? 'dash' : sniffed);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(`not hls (${sniffed})`);
  }

  if (looksHls || looksDash) {
    const buf = await readRemainingBytes(reader, firstChunk, MAX_MANIFEST_BYTES);
    if (!buf) { res.statusCode = 413; return res.end('manifest too large'); }
    const text = buf.toString('utf8');
    if (text.includes('#EXTM3U') || looksHls) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      // Pass base='' so rewritten URLs are root-relative `/api/relay?...` (immune to proxy http/https mismatch!)
      return res.end(rewriteHlsManifest(text, finalUrl, '', ref));
    }
    if (text.includes('<MPD') || looksDash) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/dash+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(rewriteDashMpd(text, finalUrl, '', ref));
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', ctype || 'application/octet-stream');
    return res.end(buf);
  }

  // Binary live stream (MPEG-TS / FLV / MP4): pipe immediately with zero buffering!
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', sniffed === 'mpegts' ? 'video/mp2t' : ctype || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  const len = upstream.headers.get('content-length');
  if (len) res.setHeader('Content-Length', len);
  const range = upstream.headers.get('content-range');
  if (range) res.setHeader('Content-Range', range);
  const acceptRanges = upstream.headers.get('accept-ranges');
  if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
  res.flushHeaders?.();
  return pipeStreamToRes(req, res, reader, firstChunk);
}
