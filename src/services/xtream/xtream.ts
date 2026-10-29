import type { EpgProgramme, MediaItem } from '@/types/models';
import { normalizeStreamUrl, sanitizeUrl } from '@/lib/security';
import { parseXmltv } from '@/services/epg/xmltv';

/**
 * Xtream Codes-compatible API service (isolated provider layer).
 * Endpoints used (standard XC API):
 *  - player_api.php?username&password                       -> auth/account info
 *  - player_api.php?...&action=get_live_categories|get_vod_categories|get_series_categories
 *  - player_api.php?...&action=get_live_streams|get_vod_streams|get_series
 *  - player_api.php?...&action=get_series_info&series_id=
 *  - player_api.php?...&action=get_short_epg&stream_id=&limit=  (titles are base64!)
 *  - xmltv.php?username&password                            -> full XMLTV EPG
 * Stream URLs use the provider's HLS output (.m3u8), never raw .ts.
 * Credentials travel only to the server the user entered; never logged.
 */
export interface XtreamCreds { server: string; username: string; password: string }
export interface XtreamResult {
  items: Omit<MediaItem, 'id' | 'playlistId'>[];
  programmes: Omit<EpgProgramme, 'id' | 'playlistId'>[];
  warnings: string[];
  accountNote: string;
}

export function normalizeServer(server: string): string | null {
  const clean = sanitizeUrl(server.trim());
  if (!clean) return null;
  const u = new URL(clean);
  u.pathname = u.pathname.replace(/\/(player_api|get|xmltv)\.php$/i, '').replace(/\/+$/, '');
  u.search = ''; u.hash = '';
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
export function xmltvUrl(creds: XtreamCreds): string {
  const base = normalizeServer(creds.server) as string;
  const u = new URL(`${base}/xmltv.php`);
  u.searchParams.set('username', creds.username);
  u.searchParams.set('password', creds.password);
  return u.toString();
}
/** Pure URL builders (unit-tested). */
export function streamUrls(creds: XtreamCreds): { live: (id: string) => string; vod: (id: string, ext: string) => string; series: (id: string, ext: string) => string } {
  const base = normalizeServer(creds.server) as string;
  const enc = encodeURIComponent;
  return {
    live: (id) => `${base}/live/${enc(creds.username)}/${enc(creds.password)}/${enc(id)}.m3u8`,
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error(`Response too large (${(buf.byteLength / 1048576).toFixed(1)} MB, limit ${(maxBytes / 1048576).toFixed(0)} MB).`);
    return { text: new TextDecoder().decode(buf), status: res.status };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('Request timed out. The provider may be slow or blocking browser requests.');
    if (e instanceof Error && /Response too large/.test(e.message)) throw e;
    throw new Error('Could not reach the provider from the browser (commonly CORS or provider browser-blocking). SIRAVEX cannot bypass provider restrictions — ask your provider for an M3U file and import it locally.');
  } finally { clearTimeout(timer); }
}
async function fetchJson<T>(url: string, timeoutMs = 25000): Promise<T> {
  const { text, status } = await fetchWithTimeout(url, timeoutMs, 30 * 1024 * 1024);
  if (status === 401 || status === 403) throw new Error(`Provider rejected the login (HTTP ${status}). Check username/password and account expiry.`);
  if (status < 200 || status >= 300) throw new Error(`Provider returned HTTP ${status}. Not every XC panel allows browser access.`);
  try { return JSON.parse(text) as T; } catch { throw new Error('Provider returned an invalid (non-JSON) response. This panel may not be Xtream-API compatible.'); }
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

/** Full XC connect: auth + live + VOD + series episodes (bounded) + XMLTV EPG attempt. */
export async function connectXtream(creds: XtreamCreds, opts: { maxSeriesEpisodeFetches?: number } = {}): Promise<XtreamResult> {
  if (!normalizeServer(creds.server)) throw new Error('Enter a valid server address, e.g. http://provider.example:8080');
  if (!creds.username.trim() || !creds.password) throw new Error('Username and password are required.');
  const warnings: string[] = [];
  const auth = await fetchJson<{ user_info?: { auth?: number; status?: string; exp_date?: string | null; message?: string } }>(apiUrl(creds, {}));
  const info = auth.user_info;
  if (!info || info.auth !== 1) throw new Error(`Provider refused the login${info?.status ? ` (account status: ${info.status})` : ''}. Check credentials and expiry.`);
  const accountNote = `Account active${info.exp_date ? ` · expires ${new Date(Number(info.exp_date) * 1000).toLocaleDateString()}` : ''}`;

  const urls = streamUrls(creds);
  const [liveCats, vodCats, seriesCats] = await Promise.all([
    fetchJson<XcCategory[]>(apiUrl(creds, { action: 'get_live_categories' })).catch(() => [] as XcCategory[]),
    fetchJson<XcCategory[]>(apiUrl(creds, { action: 'get_vod_categories' })).catch(() => [] as XcCategory[]),
    fetchJson<XcCategory[]>(apiUrl(creds, { action: 'get_series_categories' })).catch(() => [] as XcCategory[]),
  ]);
  const [live, vod, seriesList] = await Promise.all([
    fetchJson<XcLive[]>(apiUrl(creds, { action: 'get_live_streams' })).catch((e: Error) => { warnings.push(`Live list failed: ${e.message}`); return [] as XcLive[]; }),
    fetchJson<XcVod[]>(apiUrl(creds, { action: 'get_vod_streams' })).catch((e: Error) => { warnings.push(`Movies list failed: ${e.message}`); return [] as XcVod[]; }),
    fetchJson<XcSeries[]>(apiUrl(creds, { action: 'get_series' })).catch((e: Error) => { warnings.push(`Series list failed: ${e.message}`); return [] as XcSeries[]; }),
  ]);

  const items: XtreamResult['items'] = [];
  for (const s of Array.isArray(live) ? live : []) {
    items.push({ kind: 'live', title: s.name?.trim() || `Channel ${s.stream_id}`, url: urls.live(String(s.stream_id)), logo: httpIcon(s.stream_icon), group: catName(liveCats, s.category_id, 'Live TV'), tvgId: s.epg_channel_id || undefined, streamId: String(s.stream_id) });
  }
  for (const v of Array.isArray(vod) ? vod : []) {
    const icon = httpIcon(v.stream_icon);
    items.push({ kind: 'movie', title: v.name?.trim() || `Movie ${v.stream_id}`, url: normalizeStreamUrl(urls.vod(String(v.stream_id), v.container_extension || 'mp4')), poster: icon, logo: icon, group: catName(vodCats, v.category_id, 'Movies'), year: yearOf(v.year ?? v.name), rating: v.rating ? Number(v.rating) || undefined : undefined, genre: v.genre || undefined, description: v.plot || undefined, durationLabel: v.duration || undefined, streamId: String(v.stream_id) });
  }
  // Series: fetch episodes with bounded concurrency; leftovers become placeholders that load on demand.
  const maxFetch = opts.maxSeriesEpisodeFetches ?? 60;
  const list = Array.isArray(seriesList) ? seriesList : [];
  let fetched = 0;
  const queue = [...list];
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const s = queue.shift() as XcSeries;
      if (fetched >= maxFetch) {
        const icon = httpIcon(s.cover);
        items.push({ kind: 'series', title: s.name?.trim() || `Series ${s.series_id}`, url: '', poster: icon, logo: icon, group: catName(seriesCats, s.category_id, 'Series'), description: s.plot || undefined, genre: s.genre || undefined, year: yearOf(s.releaseDate), rating: s.rating ? Number(s.rating) || undefined : undefined, seriesTitle: s.name?.trim(), seriesId: String(s.series_id), episodesLoaded: false });
        continue;
      }
      fetched++;
      try {
        const detail = await fetchJson<XcSeriesInfo>(apiUrl(creds, { action: 'get_series_info', series_id: String(s.series_id) }), 20000);
        const seasons = detail.episodes ?? {};
        const seasonNums = Object.keys(seasons).sort((a, b) => Number(a) - Number(b));
        const icon = httpIcon(detail.info?.cover ?? s.cover);
        if (seasonNums.length === 0) warnings.push(`Series "${s.name}" returned no episodes.`);
        for (const seasonKey of seasonNums) {
          for (const ep of seasons[seasonKey] ?? []) {
            items.push({ kind: 'series', title: ep.title?.trim() || `${s.name} S${seasonKey}E${ep.episode_num ?? ''}`, url: normalizeStreamUrl(urls.series(ep.id, ep.container_extension || 'mp4')), poster: icon, logo: icon, group: catName(seriesCats, s.category_id, 'Series'), description: ep.info?.plot || detail.info?.plot || undefined, seriesTitle: s.name?.trim(), season: Number(seasonKey) || undefined, episode: ep.episode_num ?? undefined, seriesId: String(s.series_id), episodesLoaded: true });
          }
        }
      } catch { warnings.push(`Could not load episodes for "${s.name}" — it is saved as a series placeholder.`); items.push({ kind: 'series', title: s.name, url: '', poster: httpIcon(s.cover), group: catName(seriesCats, s.category_id, 'Series'), seriesTitle: s.name, seriesId: String(s.series_id), episodesLoaded: false }); }
    }
  });
  await Promise.all(workers);
  if (list.length > maxFetch) warnings.push(`${list.length - maxFetch} series were saved as placeholders (episode lists load when opened) to keep import fast.`);

  // EPG: full XMLTV from the same account (this was missing before — the #1 Xtream complaint).
  let programmes: XtreamResult['programmes'] = [];
  try {
    const { text, status } = await fetchWithTimeout(xmltvUrl(creds), 40000, 25 * 1024 * 1024);
    if (status >= 200 && status < 300) {
      const parsed = parseXmltv(text);
      programmes = parsed.programmes;
      if (programmes.length === 0) warnings.push('Provider XMLTV returned no programmes. Per-channel short EPG will still work in the player when available.');
    } else warnings.push(`EPG download returned HTTP ${status}; per-channel short EPG remains available.`);
  } catch (e) { warnings.push(`Full EPG download skipped: ${e instanceof Error ? e.message : 'failed'}. Per-channel short EPG remains available.`); }

  return { items, programmes, warnings, accountNote };
}

/** Load episodes for one placeholder series (used when import bounded the episode fetch). */
export async function fetchSeriesEpisodes(creds: XtreamCreds, seriesId: string, meta: { title: string; group: string; poster?: string }): Promise<Omit<MediaItem, 'id' | 'playlistId'>[]> {
  const urls = streamUrls(creds);
  const detail = await fetchJson<XcSeriesInfo>(apiUrl(creds, { action: 'get_series_info', series_id: seriesId }), 20000);
  const out: Omit<MediaItem, 'id' | 'playlistId'>[] = [];
  const seasons = detail.episodes ?? {};
  for (const seasonKey of Object.keys(seasons).sort((a, b) => Number(a) - Number(b))) {
    for (const ep of seasons[seasonKey] ?? []) {
      out.push({ kind: 'series', title: ep.title?.trim() || `${meta.title} S${seasonKey}E${ep.episode_num ?? ''}`, url: normalizeStreamUrl(urls.series(ep.id, ep.container_extension || 'mp4')), poster: meta.poster, logo: meta.poster, group: meta.group, description: ep.info?.plot || detail.info?.plot || undefined, seriesTitle: meta.title, season: Number(seasonKey) || undefined, episode: ep.episode_num ?? undefined, seriesId, episodesLoaded: true });
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
