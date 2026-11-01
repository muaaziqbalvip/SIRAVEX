import { blockedHost, hasPlayableHlsEntries, rewriteDashMpd, rewriteHlsManifest } from './_relay-lib.js';

/**
 * SIRAVEX OmniStream Universal IPTV Bridge (`/api/relay?u=<url>`)
 * Runs on Vercel EDGE Runtime (`runtime: 'edge'`) + Vite local dev middleware:
 *  - Bridges ALL `http://` and `https://` IPTV services cleanly over HTTPS:
 *      * Xtream Codes / XUI.one (`player_api.php`, `get.php`, `xmltv.php`, `/live/`, `/movie/`, `/series/`, Load-Balancer `302`s)
 *      * Stalker / Ministra / MAG Portals (`portal.php`, `server/load.php` with `Cookie: mac=...` + `X-User-Agent: Model: MAG250` + `Bearer` token)
 *      * SIPTV / M3U / M3U_PLUS / DASH `.mpd` / HLS `.m3u8` / Continuous MPEG-TS `.ts` / FLV / MP4 / MKV / HTTP Logos
 *  - Sticky User-Agent + Session Cookie Continuity: child `.ts`/`.m4s` segments inherit the EXACT User-Agent (`&ua=`)
 *    and session cookie (`&ck=`) that generated the parent `.m3u8` token — eliminating XUI Load-Balancer `403` errors!
 */
export const config = {
  runtime: 'edge',
};

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const STREAM_TIMEOUT_MS = 12000;
const API_RAW_TIMEOUT_MS = 25000;

const UA_PROFILES = {
  vlc: 'VLC/3.0.20 LibVLC/3.0.20',
  iptv: 'IPTVSmartersPro/4.0 (Linux; Android 13)',
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  mag: 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
  lavf: 'Lavf/60.16.100',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Accept, Content-Type',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Content-Type, Accept-Ranges, X-Siravex-Detected, X-Siravex-UA',
};

function looksLikeIptvPanel(rawUrl) {
  return /:(8080|8880|25461|2095|2082|2086|2052|5789|8000|8081|8443|25462|25463)\b|\/(live|movie|series|hlsr?|play|streaming|stalker_portal|player_api\.php|get\.php|xmltv\.php|portal\.php|load\.php)\b/i.test(
    rawUrl,
  );
}

function isXtreamHlsPath(rawUrl) {
  try {
    const p = new URL(rawUrl).pathname.toLowerCase();
    return /^\/(live\/)?[^/]+\/[^/]+\/\d+\.m3u8$/.test(p);
  } catch {
    return false;
  }
}

function sniffManifestKind(firstChunk) {
  if (!firstChunk || firstChunk.byteLength === 0) return 'none';
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

function extractSessionCookie(resHeaders) {
  try {
    const raw =
      (typeof resHeaders.getSetCookie === 'function' ? resHeaders.getSetCookie()[0] : '') ||
      resHeaders.get('set-cookie') ||
      '';
    if (!raw) return '';
    const pair = raw.split(';')[0].trim();
    return pair.length > 0 && pair.length <= 240 ? pair : '';
  } catch {
    return '';
  }
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

async function fetchSingle(target, method, uaString, opts) {
  const headers = new Headers({
    'User-Agent': uaString,
    Accept: '*/*',
  });
  if (opts.ref && /^https?:\/\//i.test(opts.ref)) headers.set('Referer', opts.ref);
  if (opts.rangeHeader) headers.set('Range', opts.rangeHeader);
  if (opts.stoken) headers.set('Authorization', `Bearer ${opts.stoken}`);

  // Stalker / MAG STB Cookie + X-User-Agent + upstream session cookie support
  const cookieParts = [];
  if (opts.mac) {
    cookieParts.push(`mac=${encodeURIComponent(opts.mac)}`, 'stb_lang=en', 'timezone=UTC');
    headers.set('X-User-Agent', 'Model: MAG250; Link: WiFi');
  }
  if (opts.ck) cookieParts.push(opts.ck);
  if (cookieParts.length > 0) headers.set('Cookie', cookieParts.join('; '));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
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
 * Multi-UA Smart Negotiation:
 * - If explicit `&ua=vlc|iptv|chrome|mag|lavf` or custom `&uac=...` was locked from parent manifest,
 *   uses that EXACT User-Agent first so Load-Balancer `(IP + UA)` tokens NEVER break on segments!
 * - Otherwise negotiates across VLC -> Chrome -> IPTVSmarters when a panel/WAF returns 400/401/403/451/458/503!
 */
async function fetchUpstreamSmart(target, method, opts) {
  if (opts.customUa) {
    const res = await fetchSingle(target, method, opts.customUa, opts);
    return { res, uaKey: '', customUa: opts.customUa };
  }
  if (opts.mac && !opts.lockedUa) {
    opts.lockedUa = 'mag';
  }
  if (opts.lockedUa && UA_PROFILES[opts.lockedUa]) {
    const first = await fetchSingle(target, method, UA_PROFILES[opts.lockedUa], opts);
    if (first.ok || first.status === 206 || opts.isSeg || ![400, 401, 403, 458, 503].includes(first.status)) {
      return { res: first, uaKey: opts.lockedUa, customUa: '' };
    }
    try { await first.body?.cancel(); } catch { /* ignore */ }
  }

  const iptvFirst = looksLikeIptvPanel(target);
  const ladder = iptvFirst ? ['vlc', 'chrome', 'iptv'] : ['chrome', 'vlc'];
  let lastRes = null;
  let lastKey = ladder[0];

  for (let i = 0; i < ladder.length; i++) {
    const key = ladder[i];
    try {
      const res = await fetchSingle(target, method, UA_PROFILES[key], opts);
      lastRes = res;
      lastKey = key;
      if (res.ok || res.status === 206 || ![400, 401, 403, 451, 458, 503].includes(res.status)) {
        return { res, uaKey: key, customUa: '' };
      }
      if (i < ladder.length - 1) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
      }
    } catch (err) {
      if (i === ladder.length - 1 && !lastRes) throw err;
    }
  }
  return { res: lastRes, uaKey: lastKey, customUa: '' };
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
  const lockedUa = String(q.get('ua') || '').trim().toLowerCase();
  const customUa = String(q.get('uac') || '').trim().slice(0, 220);
  const mac = String(q.get('mac') || '').trim().slice(0, 32);
  const stoken = String(q.get('stoken') || '').trim().slice(0, 512);
  const incomingCk = String(q.get('ck') || '').trim().slice(0, 240);
  const isRaw = q.get('raw') === '1';
  const isSeg = q.get('seg') === '1' || isRaw;

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
  let wonUaKey = '';
  let wonCustomUa = '';
  try {
    const out = await fetchUpstreamSmart(target, req.method, {
      ref,
      rangeHeader,
      lockedUa,
      customUa,
      mac,
      stoken,
      ck: incomingCk,
      isSeg,
      timeoutMs: isRaw ? API_RAW_TIMEOUT_MS : STREAM_TIMEOUT_MS,
    });
    upstream = out.res;
    wonUaKey = out.uaKey;
    wonCustomUa = out.customUa;
  } catch {
    return textResponse(502, 'upstream unreachable');
  }

  if (!upstream) return textResponse(502, 'upstream unreachable');

  const finalUrl = upstream.url || target;
  const finalBlock = blockedHost(finalUrl);
  if (finalBlock) {
    try { await upstream.body?.cancel(); } catch { /* ignore */ }
    return textResponse(403, `blocked redirect: ${finalBlock}`);
  }

  // If HLS probe hits a `ts`-only Xtream panel where `.m3u8` returns 404/405/415/500, signal `mpegts` immediately!
  if (!upstream.ok && upstream.status !== 206) {
    try { await upstream.body?.cancel(); } catch { /* ignore */ }
    if (expectFmt === 'hls' && isXtreamHlsPath(target) && [400, 404, 405, 406, 415, 500, 501, 502].includes(upstream.status)) {
      return textResponse(415, `xtream hls unavailable (${upstream.status})`, {
        'X-Siravex-Detected': 'mpegts',
        'Cache-Control': 'no-store',
      });
    }
    return textResponse(upstream.status || 502, `upstream ${upstream.status}`);
  }

  const ctype = (upstream.headers.get('content-type') || '').toLowerCase();
  if (req.method === 'HEAD') {
    const h = { ...CORS_HEADERS };
    if (ctype) h['Content-Type'] = ctype;
    return new Response(null, { status: upstream.status, headers: h });
  }

  if (!upstream.body) {
    if (expectFmt === 'hls' && isXtreamHlsPath(target)) {
      return textResponse(415, 'empty hls response', { 'X-Siravex-Detected': 'mpegts', 'Cache-Control': 'no-store' });
    }
    return new Response(null, { status: upstream.status, headers: CORS_HEADERS });
  }

  const reader = upstream.body.getReader();

  const buildPassthroughHeaders = (overrideType, cacheHeader) => {
    const h = {
      ...CORS_HEADERS,
      'Content-Type': overrideType || ctype || 'application/octet-stream',
      'Cache-Control': cacheHeader,
      'X-Accel-Buffering': 'no',
    };
    if (wonUaKey) h['X-Siravex-UA'] = wonUaKey;
    const len = upstream.headers.get('content-length');
    if (len) h['Content-Length'] = len;
    const cr = upstream.headers.get('content-range');
    if (cr) h['Content-Range'] = cr;
    const ar = upstream.headers.get('accept-ranges');
    if (ar) h['Accept-Ranges'] = ar;
    return h;
  };

  // Fast-path for media segments (.ts, .m4s, .mp4, .mkv), HTTP logos, & raw M3U/JSON/Stalker API calls
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
    if (expectFmt === 'hls') {
      return textResponse(415, 'empty stream on hls probe', {
        'X-Siravex-Detected': 'mpegts',
        'Cache-Control': 'no-store',
      });
    }
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

  // Build sticky session query params (`&ua=...&ck=...&mac=...`) so EVERY child segment matches the parent token!
  const stickyParts = [];
  if (wonCustomUa) stickyParts.push(`uac=${encodeURIComponent(wonCustomUa)}`);
  else if (wonUaKey) stickyParts.push(`ua=${encodeURIComponent(wonUaKey)}`);
  if (mac) stickyParts.push(`mac=${encodeURIComponent(mac)}`);
  if (stoken) stickyParts.push(`stoken=${encodeURIComponent(stoken)}`);
  const setCk = extractSessionCookie(upstream.headers) || incomingCk;
  if (setCk) stickyParts.push(`ck=${encodeURIComponent(setCk)}`);
  const stickyQuery = stickyParts.join('&');

  if (looksHls || looksDash) {
    const allBytes = await readAllBounded(reader, firstChunk, MAX_MANIFEST_BYTES);
    if (!allBytes) return textResponse(413, 'manifest too large');
    const text = new TextDecoder('utf-8').decode(allBytes);
    if (text.includes('#EXTM3U') || looksHls) {
      // If an Xtream panel returned a dead/empty `#EXTM3U` with zero segments, switch immediately to `.ts`!
      if (expectFmt === 'hls' && !hasPlayableHlsEntries(text)) {
        return textResponse(415, 'empty hls manifest', {
          'X-Siravex-Detected': 'mpegts',
          'Cache-Control': 'no-store',
        });
      }
      return textResponse(200, rewriteHlsManifest(text, finalUrl, '', ref, stickyQuery), {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': 'no-store',
      });
    }
    if (text.includes('<MPD') || looksDash) {
      return textResponse(200, rewriteDashMpd(text, finalUrl, '', ref, stickyQuery), {
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
