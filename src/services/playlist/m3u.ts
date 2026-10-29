import type { MediaItem, ParsedPlaylist } from '@/types/models';
import { detectKindFromUrl, sanitizeUrl } from '@/lib/security';

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
  if (/\b(movie|movies|vod|film|cine)\b/.test(g)) return 'movie';
  if (/\b(series|serial|season|episode)\b/.test(g) || /s\d{1,2}e\d{1,3}/i.test(title)) return 'series';
  return 'live';
}

function seriesParts(title: string): { seriesTitle?: string; season?: number; episode?: number } {
  const m = title.match(/^(.*?)[\s._-]*[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})/);
  if (!m) return {};
  return { seriesTitle: m[1].replace(/[._]+/g, ' ').trim() || title, season: Number(m[2]), episode: Number(m[3]) };
}

/** Pure M3U parser. Malformed entries become warnings, never throw on bad lines. */
export function parseM3U(text: string): ParsedPlaylist {
  const warnings: string[] = [];
  const errors: string[] = [];
  const items: ParsedPlaylist['items'] = [];
  if (!text || !text.trim()) { errors.push('Playlist content is empty.'); return { items, report: { total: 0, imported: 0, warnings, errors } }; }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let pending: { title: string; attrs: Record<string, string> } | null = null;
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) continue;
    if (line.startsWith('#EXTINF')) {
      total++;
      const comma = line.lastIndexOf(',');
      const title = comma >= 0 ? line.slice(comma + 1).trim() : '';
      if (!title) warnings.push(`Line ${i + 1}: entry has no title and was kept with a generated name.`);
      pending = { title: title || 'Untitled channel', attrs: parseAttrs(line) };
      continue;
    }
    if (line.startsWith('#')) continue; // EXTGRP, EXTVLCOPT etc are ignored safely
    // URL line
    const url = sanitizeUrl(line);
    if (!url) { warnings.push(`Line ${i + 1}: invalid or unsupported stream URL skipped.`); pending = null; continue; }
    if (!pending) { warnings.push(`Line ${i + 1}: stream URL without #EXTINF metadata; imported as untitled.`); pending = { title: 'Untitled channel', attrs: {} }; total++; }
    const group = pending.attrs['group-title'] || '';
    const kind = classify(pending.title, group, url);
    const sp = kind === 'series' ? seriesParts(pending.title) : {};
    items.push({
      kind, title: pending.title, url,
      logo: pending.attrs['tvg-logo'] ? sanitizeUrl(pending.attrs['tvg-logo']) ?? undefined : undefined,
      poster: kind !== 'live' && pending.attrs['tvg-logo'] ? sanitizeUrl(pending.attrs['tvg-logo']) ?? undefined : undefined,
      group: group || (kind === 'live' ? 'Live TV' : kind === 'movie' ? 'Movies' : 'Series'),
      tvgId: pending.attrs['tvg-id'] || undefined,
      ...sp,
    });
    pending = null;
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
    '#EXTINF:-1 tvg-id="demo-tos" group-title="Demo Live",Demo — Tears of Steel (HLS sample)',
    'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
    '#EXTINF:-1 tvg-id="demo-dash" group-title="Demo Movies",Demo Movie — Big Buck Bunny (DASH sample)',
    'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd',
    '#EXTINF:-1 tvg-id="demo-mp4" group-title="Demo Movies",Demo Movie — Sintel Trailer (MP4 sample)',
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
  ].join('\n');
}
