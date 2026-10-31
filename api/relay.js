import { blockedHost, rewriteDashMpd, rewriteHlsManifest } from './_relay-lib.js';

/**
 * SIRAVEX Universal HTTP+HTTPS Streaming Bridge (`/api/relay?u=<url>`)
 * Runs on Vercel EDGE Runtime (`runtime: 'edge'`) + Vite local dev middleware:
 *  - Bridges ANY `http://` or CORS-restricted `https://` stream (HLS `.m3u8`, Live `.ts`,
 *    extensionless Xtream `/user/pass/id`, DASH `.mpd`, FLV, MP4/MKV VOD, M3U/XMLTV, & HTTP logos)
 *    cleanly over HTTPS with ZERO Mixed-Content errors!
 *  - Unlimited streaming response size (eliminates Vercel Node's 4.5 MB cap & 10s kill!).
 *  - Smart Dual User-Agent negotiation: automatically retries once with IPTV Player UA <-> Chrome UA
 *    if an Xtream panel blocks browser UAs or Cloudflare WAF blocks VLC UAs!
 *  - 80ms First-Chunk Sniffing (`expect=hls`): instantly detects raw `0x47` MPEG-TS streams.
 */
export const config = {
  runtime: 'edge',
};

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 9500;

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const IPTV_UA = 'IPTVSmartersPlayer/4.0 (VLC/3.0.20 LibVLC/3.0.20)';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Accept, Content-Type',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Content-Type, Accept-Ranges, X-Siravex-Detected',
};

function looksLikeIptvPanel(rawUrl) {
  return /:(8080|8880|25461|2095|2082|2086|2052|5789)\b|\/(live|movie|series|player_api\.php|get\.php|xmltv\.php)\b/i.test(
    rawUrl,
  );
}

function sniffManifestKind(firstChunk) {
  if (!firstChunk || firstChunk.byteLength === 0) return 'none';
  // MPEG-TS packets start with 0x47 sync byte (repeating every 188 bytes)
  if (firstChunk[0] === 0x47 && (firstChunk.byteLength < 189 || firstChunk[188] === 0x47)) {
    return 'mpegts';
  }
  const head = new TextDecoder('utf-8')
    .decode(firstChunk.subarray(0, Math.min(firstChunk.byteLength, 256)))
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (head.startsWith('#EXTM3U')) return 'hls';
  if (/^(<\?xml[\s\S]*?<MPD|<MPD\b)/i.test(head)) return 'dash';
  return 'binary';
}

function concatUint8(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function readAllBounded(reader, firstChunk, maxBytes) {
  const chunks = [];
  let total = 0;
  if (firstChunk && firstChunk.byteLength > 0) {
    chunks.push(firstChunk);
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
    chunks.push(value);
  }
  return concatUint8(chunks, total);
}

function buildStreamBody(reader, firstChunk, reqSignal) {
  const onAbort = () => {
    try { reader.cancel(); } catch { /* ignore */ }
  };
  if (reqSignal) {
    if (reqSignal.aborted) onAbort();
    else reqSignal.addEventListener('abort', onAbort, { once: true });
  }
  let sentFirst = false;
  return new ReadableStream({
    async pull(controller) {
      try {
        if (!sentFirst) {
          sentFirst = true;
          if (firstChunk && firstChunk.byteLength > 0) {
            controller.enqueue(firstChunk);
            return;
          }
        }
        const { done, value } = await reader.read();
        if (done || !value) {
          if (reqSignal) reqSignal.removeEventListener('abort', onAbort);
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch {
        if (reqSignal) reqSignal.removeEventListener('abort', onAbort);
        try { controller.close(); } catch { /* ignore */ }
      }
    },
    cancel() {
      if (reqSignal) reqSignal.removeEventListener('abort', onAbort);
      onAbort();
    },
  });
}

async function fetchWithUa(target, method, ua, ref, rangeHeader) {
  const headers = new Headers({
    'User-Agent': ua,
    Accept: '*/*',
  });
  if (ref && /^https?:\/\//i.test(ref)) headers.set('Referer', ref);
  if (rangeHeader) headers.set('Range', rangeHeader);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      method,
      headers,
      redirect: 'follow',
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Dual-UA smart fetch:
 * - Xtream/IPTV ports try IPTVSmarters/VLC UA first (bypasses browser-UA blocks on XUI panels);
 *   if rejected with 401/403/458/503 (e.g. Cloudflare WAF), immediately retries with Chrome UA!
 * - Standard CDN URLs try Chrome UA first, and retry with IPTVSmarters/VLC UA on 401/403/458!
 */
async function fetchUpstreamSmart(target, method, ref, rangeHeader) {
  const iptvFirst = looksLikeIptvPanel(target);
  const primaryUa = iptvFirst ? IPTV_UA : CHROME_UA;
  const secondaryUa = iptvFirst ? CHROME_UA : IPTV_UA;

  const first = await fetchWithUa(target, method, primaryUa, ref, rangeHeader);
  if (first.ok || first.status === 206 || ![400, 401, 403, 458, 503].includes(first.status)) {
    return first;
  }
  try { await first.body?.cancel(); } catch { /* ignore */ }
  try {
    return await fetchWithUa(target, method, secondaryUa, ref, rangeHeader);
  } catch {
    return first;
  }
}

function textResponse(status, bodyText, extraHeaders = {}) {
  return new Response(bodyText, {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return textResponse(405, 'GET only');
  }

  const reqUrl = new URL(req.url, 'http://localhost');
  const q = reqUrl.searchParams;
  let target = String(q.get('u') || '').trim();
  const tpl = q.get('tpl');
  const ref = String(q.get('ref') || '').trim();
  const expectFmt = String(q.get('expect') || '').trim().toLowerCase();

  if (tpl && target) {
    try {
      target = new URL(tpl, target).toString();
    } catch {
      return textResponse(400, 'bad template');
    }
  }
  if (!target) return textResponse(400, 'missing u');

  const blockReason = blockedHost(target);
  if (blockReason) return textResponse(403, `blocked: ${blockReason}`);

  const rangeHeader = req.headers.get('range') || '';
  let upstream;
  try {
    upstream = await fetchUpstreamSmart(target, req.method, ref, rangeHeader);
  } catch {
    return textResponse(502, 'upstream unreachable');
  }

  const finalUrl = upstream.url || target;
  const finalBlock = blockedHost(finalUrl);
  if (finalBlock) {
    try { await upstream.body?.cancel(); } catch { /* ignore */ }
    return textResponse(403, `blocked redirect: ${finalBlock}`);
  }
  if (!upstream.ok && upstream.status !== 206) {
    try { await upstream.body?.cancel(); } catch { /* ignore */ }
    return textResponse(upstream.status || 502, `upstream ${upstream.status}`);
  }

  const ctype = (upstream.headers.get('content-type') || '').toLowerCase();
  if (req.method === 'HEAD') {
    const h = { ...CORS_HEADERS };
    if (ctype) h['Content-Type'] = ctype;
    return new Response(null, { status: upstream.status, headers: h });
  }

  if (!upstream.body) {
    return new Response(null, { status: upstream.status, headers: CORS_HEADERS });
  }

  const isRaw = q.get('raw') === '1';
  const isSeg = q.get('seg') === '1' || isRaw;
  const reader = upstream.body.getReader();

  const buildPassthroughHeaders = (overrideType, cacheHeader) => {
    const h = {
      ...CORS_HEADERS,
      'Content-Type': overrideType || ctype || 'application/octet-stream',
      'Cache-Control': cacheHeader,
      'X-Accel-Buffering': 'no',
    };
    const len = upstream.headers.get('content-length');
    if (len) h['Content-Length'] = len;
    const cr = upstream.headers.get('content-range');
    if (cr) h['Content-Range'] = cr;
    const ar = upstream.headers.get('accept-ranges');
    if (ar) h['Accept-Ranges'] = ar;
    return h;
  };

  // Fast-path for media segments (.ts, .m4s, .mp4, .mkv), HTTP logos, & raw M3U/JSON API calls
  if (isSeg) {
    return new Response(buildStreamBody(reader, null, req.signal), {
      status: upstream.status,
      headers: buildPassthroughHeaders('', isRaw ? 'no-store' : 'public, max-age=15'),
    });
  }

  // Peek at first non-empty chunk (~0ms) to classify HLS/DASH text manifests vs raw MPEG-TS/MP4 binary!
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
    return textResponse(502, 'upstream read error');
  }

  if (!firstChunk) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const sniffed = sniffManifestKind(firstChunk);
  const pathPart = finalUrl.split('?')[0].toLowerCase();
  const looksHls =
    sniffed === 'hls' || (sniffed !== 'mpegts' && (ctype.includes('mpegurl') || pathPart.endsWith('.m3u8')));
  const looksDash =
    sniffed === 'dash' || (sniffed !== 'mpegts' && (ctype.includes('dash+xml') || pathPart.endsWith('.mpd')));

  // Fast-fail when HLS.js probes a raw binary MPEG-TS stream (`expect=hls`) -> switch to mpegts.js in ~80ms!
  if (expectFmt === 'hls' && !looksHls) {
    try { await reader.cancel(); } catch { /* ignore */ }
    return textResponse(415, `not hls (${sniffed})`, {
      'X-Siravex-Detected': looksDash ? 'dash' : sniffed,
      'Cache-Control': 'no-store',
    });
  }

  if (looksHls || looksDash) {
    const allBytes = await readAllBounded(reader, firstChunk, MAX_MANIFEST_BYTES);
    if (!allBytes) return textResponse(413, 'manifest too large');
    const text = new TextDecoder('utf-8').decode(allBytes);
    if (text.includes('#EXTM3U') || looksHls) {
      return textResponse(200, rewriteHlsManifest(text, finalUrl, '', ref), {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    }
    if (text.includes('<MPD') || looksDash) {
      return textResponse(200, rewriteDashMpd(text, finalUrl, '', ref), {
        'Content-Type': 'application/dash+xml; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    }
    return new Response(allBytes, {
      status: 200,
      headers: buildPassthroughHeaders('', 'no-store'),
    });
  }

  // Binary live stream (MPEG-TS / FLV / MP4): stream continuously with zero buffering!
  return new Response(buildStreamBody(reader, firstChunk, req.signal), {
    status: upstream.status,
    headers: buildPassthroughHeaders(sniffed === 'mpegts' ? 'video/mp2t' : '', 'no-store'),
  });
}
