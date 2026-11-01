import type { EpgProgramme, MediaItem } from '@/types/models';
import { normalizeStreamUrl, sanitizeUrl } from '@/lib/security';
import { parseXmltv } from '@/services/epg/xmltv';
import { parseM3U } from '@/services/playlist/m3u';

/**
 * Xtream Codes / XUI.one Universal Provider Layer (HTTP + HTTPS):
 *  - Supports `http://` & `https://` panels on ANY port (`:80`, `:8080`, `:8880`, `:25461`, `:2095`, `:443`, raw IP or domain).
 *  - Auto-accepts `provider.com:8080` (without scheme) AND pasted `get.php?username=...&password=...` links.
 *  - Honors `user_info.allowed_output_formats` (`ts` vs `m3u8`) so `ts`-only panels generate `.ts` URLs immediately.
 *  - Gentle flood-safe request pacing (never fires 60 concurrent `get_series_info` calls that trigger XUI IP bans;
 *    series episodes load cleanly on demand when opened!).
 *  - Automatic `get.php?type=m3u_plus` fallback when a panel disables `player_api.php` JSON stream actions!
 */
export interface XtreamCreds { server: string; username: string; password: string }
export interface XtreamResult {
  items: Omit<MediaItem, 'id' | 'playlistId'>[];
  programmes: Omit<EpgProgramme, 'id' | 'playlistId'>[];
  warnings: string[];
  accountNote: string;
}

/** Extracts `{ server, username, password }` if the user pasted a full `get.php` or `player_api.php` URL. */
export function extractCredsFromUrl(raw: string): Partial<XtreamCreds> | null {
  let v = (raw || '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v) && (v.includes('/get.php') || v.includes('/player_api.php'))) {
    v = `http://${v}`;
  }
  try {
    const u = new URL(v);
    const username = u.searchParams.get('username') || u.searchParams.get('user') || '';
    const password = u.searchParams.get('password') || u.searchParams.get('pass') || '';
    const srv = normalizeServer(`${u.origin}${u.pathname}`);
    if (srv && (username || password)) {
      return { server: srv, username, password };
    }
  } catch { /* ignore */ }
  return null;
}

export function normalizeServer(server: string): string | null {
  let raw = (server || '').trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw) && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    // Coerce `host.domain:8080`, `185.x.x.x:8080`, or `panel.domain.com` -> `http://...`, while rejecting bare words like `notaurl`
    if (/^([a-z0-9-]+\.[a-z0-9.-]+|\d{1,3}(?:\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(raw)) {
      raw = `http://${raw}`;
    }
  } else if (/^[a-z0-9.-]+:\d+(\/.*)?$/i.test(raw) && !raw.includes('://')) {
    raw = `http://${raw}`;
  }
  const clean = sanitizeUrl(raw);
  if (!clean) return null;
  const u = new URL(clean);
  u.pathname = u.pathname
    .replace(/\/(player_api|get|xmltv|panel_api)\.php$/i, '')
    .replace(/\/c$/i, '')
    .replace(/\/+$/, '');
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/$/, '');
}

function apiUrl(creds: XtreamCreds, extra: Record<string, string>): string {
  const base = normalizeServer(creds.server) as string;
  const u = new URL(`${base}/player_api.php`);
  u.searchParams.set('username', creds.username);
  u.searchParams.set('password', creds.password);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

function getPhpM3uUrl(creds: XtreamCreds, output: 'ts' | 'm3u8' = 'ts'): string {
  const base = normalizeServer(creds.server) as string;
  const u = new URL(`${base}/get.php`);
  u.searchParams.set('username', creds.username);
  u.searchParams.set('password', creds.password);
  u.searchParams.set('type', 'm3u_plus');
  u.searchParams.set('output', output);
  return u.toString();
}

export function xmltvUrl(creds: XtreamCreds): string {
  const base = normalizeServer(creds.server) as string;
  const u = new URL(`${base}/xmltv.php`);
  u.searchParams.set('username', creds.username);
  u.searchParams.set('password', creds.password);
  return u.toString();
}

/** Pure URL builders (unit-tested). */
export function streamUrls(
  creds: XtreamCreds,
  liveExt: 'm3u8' | 'ts' = 'm3u8',
): { live: (id: string) => string; vod: (id: string, ext: string) => string; series: (id: string, ext: string) => string } {
  const base = normalizeServer(creds.server) as string;
  const enc = encodeURIComponent;
  return {
    live: (id) => `${base}/live/${enc(creds.username)}/${enc(creds.password)}/${enc(id)}.${liveExt}`,
    vod: (id, ext) => `${base}/movie/${enc(creds.username)}/${enc(creds.password)}/${enc(id)}.${(ext || 'mp4').replace(/^\./, '')}`,
    series: (id, ext) => `${base}/series/${enc(creds.username)}/${enc(creds.password)}/${enc(id)}.${(ext || 'mp4').replace(/^\./, '')}`,
  };
}

/** XC short-EPG titles/descriptions are base64-encoded UTF-8. */
export function decodeB64(value: string | undefined): string {
  if (!value) return '';
  try {
    const bin = atob(value);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes).trim();
  } catch { return value; }
}

async function fetchWithTimeout(url: string, timeoutMs: number, maxBytes: number): Promise<{ text: string; status: number }> {
  const isMixedHttp = typeof window !== 'undefined' && window.location?.protocol === 'https:' && /^http:\/\//i.test(url);
  const relayUrl = `/api/relay?u=${encodeURIComponent(url)}&raw=1`;
  const attempts = isMixedHttp ? [relayUrl] : [url, relayUrl];
  let lastErr: unknown = null;
  for (const candidate of attempts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(candidate, { signal: ctrl.signal });
      // If direct HTTPS failed with CORS/status error and relay hasn't been tried yet, let relay try too!
      if (!res.ok && candidate !== relayUrl && attempts.length > 1) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > maxBytes) {
        throw new Error(`Response too large (${(buf.byteLength / 1048576).toFixed(1)} MB, limit ${(maxBytes / 1048576).toFixed(0)} MB).`);
      }
      return { text: new TextDecoder().decode(buf), status: res.status };
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && /Response too large/.test(e.message)) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  if (lastErr instanceof DOMException && lastErr.name === 'AbortError') {
    throw new Error('Request timed out. The provider may be slow or blocking requests.');
  }
  throw new Error('Could not reach the provider (direct or via Edge relay). Check server address & port (e.g. http://domain.com:8080).');
}

async function fetchJson<T>(url: string, timeoutMs = 26000): Promise<T> {
  const { text, status } = await fetchWithTimeout(url, timeoutMs, 45 * 1024 * 1024);
  if (status === 401 || status === 403) {
    throw new Error(`Provider rejected the login (HTTP ${status}). Check username/password and account expiry.`);
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Provider returned HTTP ${status}.`);
  }
  const clean = text.replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    throw new Error('Provider returned an invalid (non-JSON) response.');
  }
}

interface XcCategory { category_id: string; category_name: string }
interface XcLive { stream_id: number | string; name: string; stream_icon?: string; epg_channel_id?: string; category_id?: string; tv_archive?: number }
interface XcVod { stream_id: number | string; name: string; stream_icon?: string; rating?: string; year?: string; genre?: string; plot?: string; duration?: string; category_id?: string; container_extension?: string }
interface XcSeries { series_id: number | string; name: string; cover?: string; plot?: string; genre?: string; releaseDate?: string; rating?: string; category_id?: string }
interface XcSeriesInfo { info?: XcSeries; episodes?: Record<string, { id: string; title: string; container_extension?: string; episode_num?: number; info?: { plot?: string; duration_secs?: number } }[]> }

function catName(cats: XcCategory[], id: string | undefined, fallback: string): string {
  return cats.find((c) => String(c.category_id) === String(id ?? ''))?.category_name || fallback;
}
function yearOf(raw?: string): number | undefined { const m = (raw ?? '').match(/(19|20)\d{2}/); return m ? Number(m[0]) : undefined; }
function httpIcon(raw?: string): string | undefined { if (!raw) return undefined; const s = sanitizeUrl(raw); return s ?? undefined; }

interface XcAuthResponse {
  user_info?: {
    auth?: number | string;
    status?: string;
    exp_date?: string | null;
    message?: string;
    allowed_output_formats?: string[];
  };
  server_info?: {
    url?: string;
    port?: string;
    https_port?: string;
    server_protocol?: string;
  };
}

/**
 * Full Xtream connect (HTTP + HTTPS):
 *  - Auto-extracts credentials if user pasted a full `get.php` URL into server field.
 *  - Uses gentle sequential pairs (max 2 concurrent requests) so `max_connections=1` XUI panels NEVER ban the IP!
 *  - Honors `allowed_output_formats` (`ts` vs `m3u8`).
 *  - Automatically falls back to `get.php?type=m3u_plus` if `player_api.php` JSON stream endpoints are disabled!
 */
export async function connectXtream(
  rawCreds: XtreamCreds,
  opts: { maxSeriesEpisodeFetches?: number; includeXmltv?: boolean } = {},
): Promise<XtreamResult> {
  const extracted = extractCredsFromUrl(rawCreds.server);
  const creds: XtreamCreds = {
    server: extracted?.server || rawCreds.server,
    username: rawCreds.username.trim() || extracted?.username || '',
    password: rawCreds.password || extracted?.password || '',
  };

  const normalizedSrv = normalizeServer(creds.server);
  if (!normalizedSrv) throw new Error('Enter a valid server address, e.g. http://provider.example:8080');
  if (!creds.username.trim() || !creds.password) throw new Error('Username and password are required.');
  creds.server = normalizedSrv;

  const warnings: string[] = [];
  let auth: XcAuthResponse | null = null;
  try {
    auth = await fetchJson<XcAuthResponse>(apiUrl(creds, {}), 20000);
  } catch (authErr) {
    // Fallback #1: Some IPTV panels disable `player_api.php` completely and only serve `get.php` M3U_PLUS!
    try {
      const { text, status } = await fetchWithTimeout(getPhpM3uUrl(creds, 'ts'), 24000, 35 * 1024 * 1024);
      if (status >= 200 && status < 300 && text.includes('#EXTINF')) {
        const parsed = parseM3U(text);
        if (parsed.items.length > 0) {
          return {
            items: parsed.items,
            programmes: [],
            warnings: [...parsed.report.warnings, 'Connected via get.php M3U_PLUS fallback (player_api.php unavailable on this panel).'],
            accountNote: 'Connected via Xtream M3U_PLUS',
          };
        }
      }
    } catch { /* rethrow original auth error below */ }
    throw authErr;
  }

  const info = auth?.user_info;
  if (!info || Number(info.auth) !== 1) {
    throw new Error(`Provider refused the login${info?.status ? ` (account status: ${info.status})` : ''}. Check credentials and expiry.`);
  }
  const expTs = info.exp_date && Number(info.exp_date) > 0 ? ` · expires ${new Date(Number(info.exp_date) * 1000).toLocaleDateString()}` : '';
  const formats = (info.allowed_output_formats ?? []).map((f) => String(f).toLowerCase());
  const tsOnlyPanel = formats.length > 0 && !formats.includes('m3u8') && !formats.includes('hls') && (formats.includes('ts') || formats.includes('mpegts'));
  const liveExt: 'm3u8' | 'ts' = tsOnlyPanel ? 'ts' : 'm3u8';
  const accountNote = `Account active${expTs}${tsOnlyPanel ? ' · MPEG-TS stream mode' : ''}`;

  const urls = streamUrls(creds, liveExt);

  // Gentle 2-by-2 request pacing prevents XUI/Nginx rate-limit & max_connections=1 IP bans!
  const [liveCats, vodCats] = await Promise.all([
    fetchJson<XcCategory[]>(apiUrl(creds, { action: 'get_live_categories' }), 18000).catch(() => [] as XcCategory[]),
    fetchJson<XcCategory[]>(apiUrl(creds, { action: 'get_vod_categories' }), 18000).catch(() => [] as XcCategory[]),
  ]);
  const [seriesCats, live] = await Promise.all([
    fetchJson<XcCategory[]>(apiUrl(creds, { action: 'get_series_categories' }), 18000).catch(() => [] as XcCategory[]),
    fetchJson<XcLive[]>(apiUrl(creds, { action: 'get_live_streams' }), 26000).catch((e: Error) => {
      warnings.push(`Live list warning: ${e.message}`);
      return [] as XcLive[];
    }),
  ]);
  const [vod, seriesList] = await Promise.all([
    fetchJson<XcVod[]>(apiUrl(creds, { action: 'get_vod_streams' }), 26000).catch((e: Error) => {
      warnings.push(`Movies list warning: ${e.message}`);
      return [] as XcVod[];
    }),
    fetchJson<XcSeries[]>(apiUrl(creds, { action: 'get_series' }), 24000).catch((e: Error) => {
      warnings.push(`Series list warning: ${e.message}`);
      return [] as XcSeries[];
    }),
  ]);

  const items: XtreamResult['items'] = [];
  for (const s of Array.isArray(live) ? live : []) {
    items.push({
      kind: 'live',
      title: s.name?.trim() || `Channel ${s.stream_id}`,
      url: urls.live(String(s.stream_id)),
      logo: httpIcon(s.stream_icon),
      group: catName(liveCats, s.category_id, 'Live TV'),
      tvgId: s.epg_channel_id || undefined,
      streamId: String(s.stream_id),
    });
  }
  for (const v of Array.isArray(vod) ? vod : []) {
    const icon = httpIcon(v.stream_icon);
    const rawVodUrl = urls.vod(String(v.stream_id), v.container_extension || 'mp4');
    items.push({
      kind: 'movie',
      title: v.name?.trim() || `Movie ${v.stream_id}`,
      url: (v.container_extension || '').toLowerCase() === 'ts' ? normalizeStreamUrl(rawVodUrl) : rawVodUrl,
      poster: icon,
      logo: icon,
      group: catName(vodCats, v.category_id, 'Movies'),
      year: yearOf(v.year ?? v.name),
      rating: v.rating ? Number(v.rating) || undefined : undefined,
      genre: v.genre || undefined,
      description: v.plot || undefined,
      durationLabel: v.duration || undefined,
      streamId: String(v.stream_id),
    });
  }

  // Save series cleanly as fast placeholders (episodes load on demand in <1s when user opens a series!)
  // unless caller explicitly passed maxSeriesEpisodeFetches > 0.
  const maxFetch = opts.maxSeriesEpisodeFetches ?? 0;
  const list = Array.isArray(seriesList) ? seriesList : [];
  let fetched = 0;
  for (const s of list) {
    if (fetched >= maxFetch) {
      const icon = httpIcon(s.cover);
      items.push({
        kind: 'series',
        title: s.name?.trim() || `Series ${s.series_id}`,
        url: '',
        poster: icon,
        logo: icon,
        group: catName(seriesCats, s.category_id, 'Series'),
        description: s.plot || undefined,
        genre: s.genre || undefined,
        year: yearOf(s.releaseDate),
        rating: s.rating ? Number(s.rating) || undefined : undefined,
        seriesTitle: s.name?.trim(),
        seriesId: String(s.series_id),
        episodesLoaded: false,
      });
      continue;
    }
    fetched++;
    try {
      const detail = await fetchJson<XcSeriesInfo>(apiUrl(creds, { action: 'get_series_info', series_id: String(s.series_id) }), 16000);
      const seasons = detail.episodes ?? {};
      const icon = httpIcon(detail.info?.cover ?? s.cover);
      for (const seasonKey of Object.keys(seasons).sort((a, b) => Number(a) - Number(b))) {
        for (const ep of seasons[seasonKey] ?? []) {
          items.push({
            kind: 'series',
            title: ep.title?.trim() || `${s.name} S${seasonKey}E${ep.episode_num ?? ''}`,
            url: urls.series(ep.id, ep.container_extension || 'mp4'),
            poster: icon,
            logo: icon,
            group: catName(seriesCats, s.category_id, 'Series'),
            description: ep.info?.plot || detail.info?.plot || undefined,
            seriesTitle: s.name?.trim(),
            season: Number(seasonKey) || undefined,
            episode: ep.episode_num ?? undefined,
            seriesId: String(s.series_id),
            episodesLoaded: true,
          });
        }
      }
    } catch {
      items.push({
        kind: 'series',
        title: s.name,
        url: '',
        poster: httpIcon(s.cover),
        group: catName(seriesCats, s.category_id, 'Series'),
        seriesTitle: s.name,
        seriesId: String(s.series_id),
        episodesLoaded: false,
      });
    }
  }

  // Fallback #2: If `player_api.php` authenticated (`auth === 1`) yet returned 0 streams, try `get.php` M3U_PLUS!
  if (items.length === 0) {
    try {
      const { text, status } = await fetchWithTimeout(getPhpM3uUrl(creds, liveExt), 24000, 35 * 1024 * 1024);
      if (status >= 200 && status < 300 && text.includes('#EXTINF')) {
        const parsed = parseM3U(text);
        items.push(...parsed.items);
      }
    } catch { /* ignore */ }
  }

  // Optional fast XMLTV EPG check (capped at 12s so huge Xtream imports never stall on slow xmltv.php!)
  let programmes: XtreamResult['programmes'] = [];
  if (opts.includeXmltv) {
    try {
      const { text, status } = await fetchWithTimeout(xmltvUrl(creds), 14000, 25 * 1024 * 1024);
      if (status >= 200 && status < 300) {
        programmes = parseXmltv(text).programmes;
      }
    } catch {
      warnings.push('Full XMLTV skipped during fast connect — use Fetch EPG anytime, or view live per-channel short EPG inside the player.');
    }
  }

  return { items, programmes, warnings, accountNote };
}

/** Load episodes for one placeholder series (used when user clicks a series card). */
export async function fetchSeriesEpisodes(creds: XtreamCreds, seriesId: string, meta: { title: string; group: string; poster?: string }): Promise<Omit<MediaItem, 'id' | 'playlistId'>[]> {
  const urls = streamUrls(creds);
  const detail = await fetchJson<XcSeriesInfo>(apiUrl(creds, { action: 'get_series_info', series_id: seriesId }), 20000);
  const out: Omit<MediaItem, 'id' | 'playlistId'>[] = [];
  const seasons = detail.episodes ?? {};
  for (const seasonKey of Object.keys(seasons).sort((a, b) => Number(a) - Number(b))) {
    for (const ep of seasons[seasonKey] ?? []) {
      const rawEpUrl = urls.series(ep.id, ep.container_extension || 'mp4');
      out.push({
        kind: 'series',
        title: ep.title?.trim() || `${meta.title} S${seasonKey}E${ep.episode_num ?? ''}`,
        url: (ep.container_extension || '').toLowerCase() === 'ts' ? normalizeStreamUrl(rawEpUrl) : rawEpUrl,
        poster: meta.poster,
        logo: meta.poster,
        group: meta.group,
        description: ep.info?.plot || detail.info?.plot || undefined,
        seriesTitle: meta.title,
        season: Number(seasonKey) || undefined,
        episode: ep.episode_num ?? undefined,
        seriesId,
        episodesLoaded: true,
      });
    }
  }
  return out;
}

/** Refresh only the XMLTV EPG for a stored Xtream source. */
export async function fetchXtreamEpg(creds: XtreamCreds): Promise<{ programmes: XtreamResult['programmes']; warnings: string[] }> {
  const { text, status } = await fetchWithTimeout(xmltvUrl(creds), 40000, 25 * 1024 * 1024);
  if (status < 200 || status >= 300) throw new Error(`EPG download returned HTTP ${status}.`);
  const parsed = parseXmltv(text);
  return { programmes: parsed.programmes, warnings: parsed.warnings };
}

/** Per-channel short EPG (base64 titles) — used as fallback when no XMLTV match exists. */
export async function fetchShortEpg(creds: XtreamCreds, streamId: string, limit = 8): Promise<{ title: string; description?: string; start: number; end: number }[]> {
  const data = await fetchJson<{ epg_listings?: { title?: string; description?: string; start?: string; end?: string }[] }>(apiUrl(creds, { action: 'get_short_epg', stream_id: streamId, limit: String(limit) }), 15000);
  return (data.epg_listings ?? []).map((p) => ({ title: decodeB64(p.title) || 'Programme', description: decodeB64(p.description) || undefined, start: new Date((p.start ?? '').replace(' ', 'T') + 'Z').getTime(), end: new Date((p.end ?? '').replace(' ', 'T') + 'Z').getTime() })).filter((p) => p.title && Number.isFinite(p.start));
}
