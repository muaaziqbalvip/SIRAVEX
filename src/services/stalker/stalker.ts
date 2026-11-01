import type { MediaItem } from '@/types/models';
import { sanitizeUrl } from '@/lib/security';

/**
 * Stalker / Ministra / MAG STB (`00:1A:79:...`) Portal Client (HTTP + HTTPS).
 *
 * Uses `/api/relay` with `&ua=mag&mac=<MAC>&stoken=<Bearer>` so browser `Cookie` and
 * `User-Agent` header restrictions never block Stalker portals on either `http://` or `https://`.
 */

export interface StalkerCreds {
  portal: string;
  mac: string;
}

export interface StalkerConnectResult {
  items: Omit<MediaItem, 'id' | 'playlistId'>[];
  warnings: string[];
  accountNote: string;
  normalizedPortal: string;
  normalizedMac: string;
}

interface CachedStalkerSession {
  endpoint: string;
  referer: string;
  origin: string;
  token: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 12 * 60_000;
const sessionCache = new Map<string, CachedStalkerSession>();

/** Validates & normalizes any MAC string (`001a79abcdef`, `00-1A-79-...`, `00:1A:79:...`) -> `00:1A:79:AB:CD:EF`. */
export function normalizeMac(raw: string): string | null {
  const hex = (raw || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g)!.join(':');
}

/** Auto-formats partial MAC input in UI (`001a79` -> `00:1A:79`). */
export function formatMacInput(raw: string): string {
  const hex = (raw || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase().slice(0, 12);
  return (hex.match(/.{1,2}/g) ?? []).join(':');
}

/** Normalizes portal input (`portal.tv:8080/c/` or `http://portal.tv/stalker_portal/c/index.html`). */
export function normalizePortalUrl(raw: string): string | null {
  let v = (raw || '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) {
    if (/^[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(v) && (v.includes('.') || v.includes(':'))) {
      v = `http://${v}`;
    }
  }
  const clean = sanitizeUrl(v);
  if (!clean) return null;
  try {
    const u = new URL(clean);
    u.pathname = u.pathname
      .replace(/\/index\.html?$/i, '')
      .replace(/\/(portal|load)\.php$/i, '')
      .replace(/\/+$/, '');
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Candidate Stalker PHP endpoints in priority order for a given portal base URL. */
export function candidateStalkerEndpoints(portalBase: string): { endpoint: string; referer: string; origin: string }[] {
  const u = new URL(portalBase);
  const origin = u.origin;
  const path = u.pathname.replace(/\/+$/, '');
  const referer = path.endsWith('/c') ? `${origin}${path}/` : `${origin}${path || '/c'}/`;

  const rawList: string[] = [];
  if (path.endsWith('/c')) {
    const parent = path.slice(0, -2);
    rawList.push(
      `${origin}${parent}/portal.php`,
      `${origin}${parent}/server/load.php`,
      `${origin}/portal.php`,
      `${origin}/stalker_portal/server/load.php`,
      `${origin}/server/load.php`,
    );
  } else if (path) {
    rawList.push(
      `${origin}${path}/portal.php`,
      `${origin}${path}/server/load.php`,
      `${origin}${path}/stalker_portal/server/load.php`,
      `${origin}/portal.php`,
      `${origin}/stalker_portal/server/load.php`,
    );
  } else {
    rawList.push(
      `${origin}/portal.php`,
      `${origin}/stalker_portal/server/load.php`,
      `${origin}/server/load.php`,
      `${origin}/c/portal.php`,
    );
  }

  const seen = new Set<string>();
  const out: { endpoint: string; referer: string; origin: string }[] = [];
  for (const ep of rawList) {
    if (!seen.has(ep)) {
      seen.add(ep);
      out.push({ endpoint: ep, referer, origin });
    }
  }
  return out;
}

/** Deterministic MAG250 serial & device IDs derived from MAC so portals with device-ID lock stay consistent. */
function deriveStbIdentity(mac: string): { sn: string; deviceId: string } {
  const clean = mac.replace(/:/g, '').toUpperCase();
  let hash = 2166136261;
  for (let i = 0; i < clean.length; i++) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const sn = `${hash.toString(16).toUpperCase().padStart(8, '0')}${clean.slice(-5)}`.slice(0, 13);
  const dev = Array.from({ length: 8 }, (_, idx) => ((hash >>> (idx % 4)) ^ (idx * 0x5bd1e995)) >>> 0)
    .map((n) => n.toString(16).toUpperCase().padStart(8, '0'))
    .join('')
    .slice(0, 64);
  return { sn, deviceId: dev };
}

/** Strips Stalker command prefixes (`ffmpeg `, `ffrt `, `auto `, etc.) and extracts the stream URL. */
export function unwrapStalkerCmd(rawCmd: string, portalOrigin?: string): string | null {
  let s = (rawCmd || '').trim();
  if (!s) return null;
  s = s.replace(/^(ffmpeg|ffrt\d*|auto|solution|rtp)\s+/i, '').trim();
  const spaceIdx = s.indexOf(' ');
  if (spaceIdx > 0 && /^https?:\/\//i.test(s.slice(0, spaceIdx))) {
    s = s.slice(0, spaceIdx).trim();
  }
  if (/^https?:\/\//i.test(s)) return sanitizeUrl(s);
  if (s.startsWith('/') && portalOrigin) {
    return sanitizeUrl(`${portalOrigin}${s}`);
  }
  return null;
}

function isLocalPlaceholderUrl(url: string | null): boolean {
  if (!url) return true;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
  } catch {
    return true;
  }
}

async function stalkerApiCall<T>(
  endpoint: string,
  mac: string,
  referer: string,
  params: Record<string, string>,
  token = '',
  timeoutMs = 18000,
): Promise<T> {
  const u = new URL(endpoint);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!u.searchParams.has('JsHttpRequest')) u.searchParams.set('JsHttpRequest', '1-xml');

  const relayParts = [
    `u=${encodeURIComponent(u.toString())}`,
    'raw=1',
    'ua=mag',
    `mac=${encodeURIComponent(mac)}`,
    `ref=${encodeURIComponent(referer)}`,
  ];
  if (token) relayParts.push(`stoken=${encodeURIComponent(token)}`);
  const relayUrl = `/api/relay?${relayParts.join('&')}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(relayUrl, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).replace(/^\uFEFF/, '').trim();
    if (!text) throw new Error('Empty portal response');
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureStalkerSession(portalBase: string, mac: string, forceRefresh = false): Promise<CachedStalkerSession> {
  const cacheKey = `${portalBase.toLowerCase()}|${mac}`;
  const existing = sessionCache.get(cacheKey);
  if (!forceRefresh && existing && existing.expiresAt > Date.now()) {
    return existing;
  }

  const candidates = candidateStalkerEndpoints(portalBase);
  let lastError = 'Portal did not respond to Stalker handshake.';

  for (const cand of candidates) {
    try {
      const hs = await stalkerApiCall<{ js?: { token?: string } }>(
        cand.endpoint,
        mac,
        cand.referer,
        { type: 'stb', action: 'handshake', token: '', prehash: '0' },
        '',
        12000,
      );
      const token = hs?.js?.token?.trim();
      if (!token) continue;

      const { sn, deviceId } = deriveStbIdentity(mac);
      // Activate STB session profile (non-fatal if custom portal omits fields)
      await stalkerApiCall(
        cand.endpoint,
        mac,
        cand.referer,
        {
          type: 'stb',
          action: 'get_profile',
          hd: '1',
          stb_type: 'MAG250',
          sn,
          device_id: deviceId,
          device_id2: deviceId,
          auth_second_step: '0',
          num_banks: '2',
        },
        token,
        12000,
      ).catch(() => undefined);

      const session: CachedStalkerSession = {
        endpoint: cand.endpoint,
        referer: cand.referer,
        origin: cand.origin,
        token,
        expiresAt: Date.now() + SESSION_TTL_MS,
      };
      sessionCache.set(cacheKey, session);
      return session;
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Handshake failed';
    }
  }

  throw new Error(`Could not connect to MAC / Stalker Portal (${lastError}). Check portal URL and MAC address.`);
}

interface StalkerGenre {
  id: string | number;
  title?: string;
}
interface StalkerChannel {
  id: string | number;
  name?: string;
  cmd?: string;
  logo?: string;
  tv_genre_id?: string | number;
  xmltv_id?: string;
}
interface StalkerVodItem {
  id: string | number;
  name?: string;
  o_name?: string;
  cmd?: string;
  screenshot_uri?: string;
  category_id?: string | number;
  year?: string;
  description?: string;
  rating_imdb?: string;
}

function resolvePortalLogo(raw: string | undefined, origin: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  if (/^https?:\/\//i.test(t)) return sanitizeUrl(t) ?? undefined;
  if (t.startsWith('/')) return sanitizeUrl(`${origin}${t}`) ?? undefined;
  return sanitizeUrl(`${origin}/stalker_portal/misc/logos/320/${t}`) ?? undefined;
}

/** Connects to a Stalker / MAG MAC Portal (`http://` or `https://`) and imports Live TV + initial VOD. */
export async function connectStalker(creds: StalkerCreds): Promise<StalkerConnectResult> {
  const normalizedPortal = normalizePortalUrl(creds.portal);
  if (!normalizedPortal) {
    throw new Error('Enter a valid Portal URL, e.g. http://portal.example:8080/c/');
  }
  const normalizedMac = normalizeMac(creds.mac);
  if (!normalizedMac) {
    throw new Error('Enter a valid 12-hex MAC address, e.g. 00:1A:79:AB:CD:EF');
  }

  const warnings: string[] = [];
  const session = await ensureStalkerSession(normalizedPortal, normalizedMac, true);

  // Account expiry check (optional across Ministra versions)
  let accountNote = `MAC ${normalizedMac} connected`;
  try {
    const acc = await stalkerApiCall<{ js?: { phone?: string; end_date?: string } }>(
      session.endpoint,
      normalizedMac,
      session.referer,
      { type: 'account_info', action: 'get_main_info' },
      session.token,
      10000,
    );
    const exp = acc?.js?.end_date || acc?.js?.phone;
    if (exp) accountNote = `MAC ${normalizedMac} · ${exp}`;
  } catch { /* optional */ }

  // 1. Live TV genres
  const genreMap = new Map<string, string>();
  try {
    const genresRes = await stalkerApiCall<{ js?: StalkerGenre[] }>(
      session.endpoint,
      normalizedMac,
      session.referer,
      { type: 'itv', action: 'get_genres' },
      session.token,
      14000,
    );
    for (const g of Array.isArray(genresRes?.js) ? genresRes.js : []) {
      if (g?.id != null && g.title && g.title !== '*') genreMap.set(String(g.id), g.title.trim());
    }
  } catch { /* fallback group */ }

  // 2. Live TV channels (`get_all_channels`, fallback to paginated `get_ordered_list`)
  let channels: StalkerChannel[] = [];
  try {
    const allRes = await stalkerApiCall<{ js?: { data?: StalkerChannel[] } | StalkerChannel[] }>(
      session.endpoint,
      normalizedMac,
      session.referer,
      { type: 'itv', action: 'get_all_channels', force_ch_link_check: '0' },
      session.token,
      24000,
    );
    const rawJs = allRes?.js;
    if (Array.isArray(rawJs)) channels = rawJs;
    else if (rawJs && Array.isArray(rawJs.data)) channels = rawJs.data;
  } catch (e) {
    warnings.push(`get_all_channels fallback: ${e instanceof Error ? e.message : 'retrying ordered list'}`);
  }

  if (channels.length === 0) {
    for (let page = 1; page <= 5; page++) {
      try {
        const pageRes = await stalkerApiCall<{ js?: { data?: StalkerChannel[] } }>(
          session.endpoint,
          normalizedMac,
          session.referer,
          { type: 'itv', action: 'get_ordered_list', genre: '*', p: String(page), sortby: 'number' },
          session.token,
          15000,
        );
        const batch = pageRes?.js?.data ?? [];
        if (batch.length === 0) break;
        channels.push(...batch);
      } catch {
        break;
      }
    }
  }

  const items: Omit<MediaItem, 'id' | 'playlistId'>[] = [];
  for (const ch of channels) {
    const rawCmd = (ch.cmd || '').trim();
    if (!rawCmd) continue;
    const unwrapped = unwrapStalkerCmd(rawCmd, session.origin);
    // Even if `cmd` uses a `localhost` placeholder, provide a valid portal URL placeholder; PlaybackEngine resolves `create_link` dynamically!
    const fallbackUrl = !isLocalPlaceholderUrl(unwrapped) && unwrapped ? unwrapped : `${session.origin}/stalker-live/${encodeURIComponent(String(ch.id))}.ts`;
    items.push({
      kind: 'live',
      title: ch.name?.trim() || `Channel ${ch.id}`,
      url: fallbackUrl,
      logo: resolvePortalLogo(ch.logo, session.origin),
      group: genreMap.get(String(ch.tv_genre_id ?? '')) || 'Live TV',
      tvgId: ch.xmltv_id || undefined,
      streamId: String(ch.id),
      referrer: session.referer,
      stalkerPortal: normalizedPortal,
      stalkerMac: normalizedMac,
      stalkerCmd: rawCmd,
      stalkerKind: 'itv',
    });
  }

  // 3. Initial VOD Movies catalog (first 3 pages cleanly so connect stays <4s)
  try {
    const vodCatsRes = await stalkerApiCall<{ js?: StalkerGenre[] }>(
      session.endpoint,
      normalizedMac,
      session.referer,
      { type: 'vod', action: 'get_categories' },
      session.token,
      10000,
    ).catch(() => ({ js: [] as StalkerGenre[] }));
    const vodCatMap = new Map<string, string>();
    for (const c of Array.isArray(vodCatsRes?.js) ? vodCatsRes.js : []) {
      if (c?.id != null && c.title && c.title !== '*') vodCatMap.set(String(c.id), c.title.trim());
    }

    for (let page = 1; page <= 3; page++) {
      const vodPage = await stalkerApiCall<{ js?: { data?: StalkerVodItem[] } }>(
        session.endpoint,
        normalizedMac,
        session.referer,
        { type: 'vod', action: 'get_ordered_list', category: '*', p: String(page), sortby: 'added' },
        session.token,
        12000,
      );
      const list = vodPage?.js?.data ?? [];
      if (list.length === 0) break;
      for (const v of list) {
        const rawCmd = (v.cmd || `movie_${v.id}`).trim();
        const unwrapped = unwrapStalkerCmd(rawCmd, session.origin);
        const fallbackUrl = !isLocalPlaceholderUrl(unwrapped) && unwrapped ? unwrapped : `${session.origin}/stalker-vod/${encodeURIComponent(String(v.id))}.mp4`;
        const poster = resolvePortalLogo(v.screenshot_uri, session.origin);
        const yr = v.year ? Number((v.year.match(/(19|20)\d{2}/) ?? [])[0]) || undefined : undefined;
        items.push({
          kind: 'movie',
          title: (v.name || v.o_name || `Movie ${v.id}`).trim(),
          url: fallbackUrl,
          poster,
          logo: poster,
          group: vodCatMap.get(String(v.category_id ?? '')) || 'Movies',
          year: yr,
          rating: v.rating_imdb ? Number(v.rating_imdb) || undefined : undefined,
          description: v.description || undefined,
          referrer: session.referer,
          stalkerPortal: normalizedPortal,
          stalkerMac: normalizedMac,
          stalkerCmd: rawCmd,
          stalkerKind: 'vod',
        });
      }
    }
  } catch { /* VOD optional on Live-only MAC accounts */ }

  if (items.length === 0) {
    throw new Error('MAC handshake succeeded, but the portal returned 0 channels. Check if this MAC address is active or IP-locked.');
  }

  return { items, warnings, accountNote, normalizedPortal, normalizedMac };
}

/**
 * Resolves a fresh playable stream URL right before playback via Stalker `create_link`
 * (uses cached handshake token so channel zapping takes ~120ms; auto-refreshes token on expiry).
 */
export async function resolveStalkerStreamUrl(opts: {
  portal: string;
  mac: string;
  cmd: string;
  kind?: 'itv' | 'vod';
}): Promise<{ url: string; referrer: string; mac: string }> {
  const portalBase = normalizePortalUrl(opts.portal);
  const mac = normalizeMac(opts.mac);
  if (!portalBase || !mac) throw new Error('Invalid Stalker portal or MAC address.');

  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await ensureStalkerSession(portalBase, mac, attempt > 0);
    try {
      const res = await stalkerApiCall<{ js?: { cmd?: string } }>(
        session.endpoint,
        mac,
        session.referer,
        {
          type: opts.kind === 'vod' ? 'vod' : 'itv',
          action: 'create_link',
          cmd: opts.cmd,
          series: '',
          forced_storage: '0',
          disable_ad: '0',
          download: '0',
          force_ch_link_check: '0',
        },
        session.token,
        10000,
      );
      const resolved = unwrapStalkerCmd(res?.js?.cmd || '', session.origin);
      if (resolved && !isLocalPlaceholderUrl(resolved)) {
        return { url: resolved, referrer: session.referer, mac };
      }
    } catch {
      if (attempt === 1) break;
    }
  }

  // Fallback: if portal does not use `create_link` and `cmd` itself already holds a real public stream URL
  const direct = unwrapStalkerCmd(opts.cmd);
  if (direct && !isLocalPlaceholderUrl(direct)) {
    return { url: direct, referrer: `${portalBase}/`, mac };
  }
  throw new Error('Stalker portal refused stream link creation (check MAC subscription / active connection limit).');
}
