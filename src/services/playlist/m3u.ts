import type { MediaItem, ParsedPlaylist } from '@/types/models';
import { parseClearKeys } from '@/lib/clearkey';
import { detectKindFromUrl, normalizeStreamUrl, sanitizeUrl } from '@/lib/security';

export function extractYear(title: string): number | undefined {
  const m = title.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  return m ? Number(m[1]) : undefined;
}

function parseAttrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out[m[1].toLowerCase()] = m[2];
  return out;
}

function classify(title: string, group: string, url: string): MediaItem['kind'] {
  const fromUrl = detectKindFromUrl(url);
  if (fromUrl === 'movie') return 'movie';
  if (fromUrl === 'series-episode') return 'series';
  const g = `${group} ${title}`.toLowerCase();
  if (/(movie|movies|vod|film|films|cine|cinema|box ?office)/.test(g)) return 'movie';
  if (/(series|serial|season|episode|seasons|episodes)/.test(g) || /s\d{1,2}[\s._-]*e\d{1,3}/i.test(title)) return 'series';
  return 'live';
}

function seriesParts(title: string): { seriesTitle?: string; season?: number; episode?: number } {
  const m = title.match(/^(.*?)[\s._-]*[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})/);
  if (!m) return {};
  return { seriesTitle: m[1].replace(/[._]+/g, ' ').trim() || title, season: Number(m[2]), episode: Number(m[3]) };
}

interface PendingDirectives {
  forcedFormat?: MediaItem['forcedFormat'];
  licenseType?: string;
  licenseKeyRaw?: string;
  referrer?: string;
}

function splitPipeHeaders(rawLine: string): { urlPart: string; referrer?: string } {
  const pipeIdx = rawLine.indexOf('|');
  if (pipeIdx < 0) return { urlPart: rawLine };
  const urlPart = rawLine.slice(0, pipeIdx).trim();
  const headerPart = rawLine.slice(pipeIdx + 1).trim();
  let referrer: string | undefined;
  for (const pair of headerPart.split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const k = pair.slice(0, eq).trim().toLowerCase();
    const v = decodeURIComponent(pair.slice(eq + 1).trim());
    if ((k === 'referer' || k === 'referrer' || k === 'origin') && sanitizeUrl(v)) {
      referrer = sanitizeUrl(v) ?? undefined;
    }
  }
  return { urlPart, referrer };
}

function resolveDrmDirectives(d: PendingDirectives): Pick<MediaItem, 'forcedFormat' | 'drmClearKeys' | 'drmLicenseUrl' | 'referrer'> {
  const out: Pick<MediaItem, 'forcedFormat' | 'drmClearKeys' | 'drmLicenseUrl' | 'referrer'> = {};
  if (d.forcedFormat) out.forcedFormat = d.forcedFormat;
  if (d.referrer) out.referrer = d.referrer;

  const rawKey = d.licenseKeyRaw?.trim();
  if (rawKey) {
    const lt = (d.licenseType ?? '').toLowerCase();
    const keyBase = rawKey.split('|')[0].trim();
    const parsedClear = parseClearKeys(rawKey) ?? parseClearKeys(keyBase);
    if (parsedClear) {
      out.drmClearKeys = parsedClear;
      if (!out.forcedFormat) out.forcedFormat = 'dash';
    } else if (lt.includes('widevine') || /^https?:\/\//i.test(keyBase)) {
      const cleanLic = sanitizeUrl(keyBase);
      if (cleanLic) {
        out.drmLicenseUrl = cleanLic;
        if (!out.forcedFormat) out.forcedFormat = 'dash';
      }
    }
  }
  return out;
}

/**
 * Pure M3U parser with `#KODIPROP:inputstream.adaptive.*`, `#EXTVLCOPT:http-referrer`,
 * and Kodi `|Referer=...` pipe-header support. Malformed entries become warnings, never throw.
 */
export function parseM3U(text: string): ParsedPlaylist {
  const warnings: string[] = [];
  const errors: string[] = [];
  const items: ParsedPlaylist['items'] = [];
  if (!text || !text.trim()) {
    errors.push('Playlist content is empty.');
    return { items, report: { total: 0, imported: 0, warnings, errors } };
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let pending: { title: string; attrs: Record<string, string> } | null = null;
  let directives: PendingDirectives = {};
  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) continue;

    if (line.startsWith('#KODIPROP:')) {
      const rest = line.slice('#KODIPROP:'.length).trim();
      const eq = rest.indexOf('=');
      if (eq > 0) {
        const key = rest.slice(0, eq).trim().toLowerCase();
        const val = rest.slice(eq + 1).trim();
        if (key.endsWith('manifest_type')) {
          const mt = val.toLowerCase();
          if (mt === 'mpd' || mt === 'dash' || mt === 'ism') directives.forcedFormat = 'dash';
          else if (mt === 'hls' || mt === 'm3u8') directives.forcedFormat = 'hls';
        } else if (key.endsWith('license_type')) {
          directives.licenseType = val;
        } else if (key.endsWith('license_key')) {
          directives.licenseKeyRaw = val;
        }
      }
      continue;
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      const rest = line.slice('#EXTVLCOPT:'.length).trim();
      const eq = rest.indexOf('=');
      if (eq > 0) {
        const key = rest.slice(0, eq).trim().toLowerCase();
        const val = rest.slice(eq + 1).trim();
        if ((key === 'http-referrer' || key === 'http-referer' || key === 'http-origin') && sanitizeUrl(val)) {
          directives.referrer = sanitizeUrl(val) ?? undefined;
        }
      }
      continue;
    }

    if (line.startsWith('#EXTINF')) {
      total++;
      const comma = line.lastIndexOf(',');
      const title = comma >= 0 ? line.slice(comma + 1).trim() : '';
      if (!title) warnings.push(`Line ${i + 1}: entry has no title and was kept with a generated name.`);
      pending = { title: title || 'Untitled channel', attrs: parseAttrs(line) };
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      if (pending) pending.attrs['group-title'] = line.slice('#EXTGRP:'.length).trim();
      continue;
    }

    if (line.startsWith('#')) continue;

    // Stream URL line (supports optional Kodi `|Referer=...` suffix)
    const { urlPart, referrer: pipeRef } = splitPipeHeaders(line);
    const rawUrl = sanitizeUrl(urlPart);
    if (!rawUrl) {
      warnings.push(`Line ${i + 1}: invalid or unsupported stream URL skipped.`);
      pending = null;
      directives = {};
      continue;
    }
    const url = normalizeStreamUrl(rawUrl);
    if (!pending) {
      warnings.push(`Line ${i + 1}: stream URL without #EXTINF metadata; imported as untitled.`);
      pending = { title: 'Untitled channel', attrs: {} };
      total++;
    }
    if (pipeRef && !directives.referrer) directives.referrer = pipeRef;
    const drmFields = resolveDrmDirectives(directives);
    const group = pending.attrs['group-title'] || '';
    const kind = classify(pending.title, group, url);
    const sp = kind === 'series' ? seriesParts(pending.title) : {};
    items.push({
      kind,
      title: pending.title,
      url,
      logo: pending.attrs['tvg-logo'] ? sanitizeUrl(pending.attrs['tvg-logo']) ?? undefined : undefined,
      poster: kind !== 'live' && pending.attrs['tvg-logo'] ? sanitizeUrl(pending.attrs['tvg-logo']) ?? undefined : undefined,
      group: group || (kind === 'live' ? 'Live TV' : kind === 'movie' ? 'Movies' : 'Series'),
      tvgId: pending.attrs['tvg-id'] || undefined,
      year: extractYear(pending.title),
      ...sp,
      ...drmFields,
    });
    pending = null;
    directives = {};
  }

  if (pending) warnings.push('Last entry has metadata but no stream URL and was skipped.');
  if (items.length === 0 && errors.length === 0) errors.push('No playable entries were found. Check that the file is a valid M3U playlist.');
  return { items, report: { total, imported: items.length, warnings: warnings.slice(0, 50), errors } };
}

export function buildDemoPlaylistText(): string {
  return [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="demo-bbb" group-title="Demo Live",Demo — Big Buck Bunny (HLS sample)',
    'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    '#EXTINF:-1 tvg-id="demo-tos" group-title="Demo Live",Demo — Tears of Steel (Multi-Audio HLS)',
    'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
    '#EXTINF:-1 tvg-id="demo-dash" group-title="Demo Movies",Demo Movie — Big Buck Bunny (DASH sample)',
    'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
    '#EXTINF:-1 tvg-id="demo-mp4" group-title="Demo Movies",Demo Movie — Sintel Trailer (MP4 sample)',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
  ].join('\n');
}
