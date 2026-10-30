import { cleanGroup, cleanTitle } from '@/lib/display';
import { matchesChannelEpg } from '@/services/epg/xmltv';
import type { EpgProgramme, MediaItem, MediaKind } from '@/types/models';

export function normalizeSearchText(raw?: string | number | null): string {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenizeQuery(query: string): string[] {
  const norm = normalizeSearchText(query);
  if (!norm) return [];
  return norm.split(/\s+/).filter(Boolean);
}

export interface SearchProgrammeHit {
  programme: EpgProgramme;
  channel?: MediaItem;
  isLiveNow: boolean;
}

export interface LibrarySearchOutput {
  total: number;
  items: MediaItem[];
  live: MediaItem[];
  movies: MediaItem[];
  series: MediaItem[];
  programmes: SearchProgrammeHit[];
}

export interface SearchOptions {
  kind?: 'all' | MediaKind;
  enabledPlaylistIds?: ReadonlySet<string>;
  programmes?: EpgProgramme[];
  limitPerKind?: number;
  now?: number;
}

/**
 * Multi-token weighted search across locally imported channels, movies, series,
 * and EPG programmes. Never lets movies/series starve Live TV results.
 */
export function searchLibrary(
  allItems: MediaItem[],
  query: string,
  opts: SearchOptions = {},
): LibrarySearchOutput {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return { total: 0, items: [], live: [], movies: [], series: [], programmes: [] };
  }

  const fullNeedle = tokens.join(' ');
  const kindFilter = opts.kind ?? 'all';
  const enabled = opts.enabledPlaylistIds;
  const limit = opts.limitPerKind ?? 80;
  const now = opts.now ?? Date.now();

  const scored: { item: MediaItem; score: number }[] = [];

  for (let i = 0; i < allItems.length; i++) {
    const item = allItems[i];
    if (enabled && !enabled.has(item.playlistId)) continue;
    if (kindFilter !== 'all' && item.kind !== kindFilter) continue;

    const cTitle = normalizeSearchText(cleanTitle(item.title));
    const rTitle = normalizeSearchText(item.title);
    const sTitle = normalizeSearchText(item.seriesTitle);
    const group = normalizeSearchText(cleanGroup(item.group));
    const meta = normalizeSearchText(
      [item.genre, item.year, item.tvgId, item.description].filter(Boolean).join(' '),
    );
    const haystack = `${rTitle} ${cTitle} ${sTitle} ${group} ${meta}`;

    // Every query token must appear somewhere in the item's combined searchable text
    let allMatched = true;
    for (let t = 0; t < tokens.length; t++) {
      if (!haystack.includes(tokens[t])) {
        allMatched = false;
        break;
      }
    }
    if (!allMatched) continue;

    let score = 10;
    if (cTitle === fullNeedle || rTitle === fullNeedle) score += 140;
    else if (cTitle.startsWith(fullNeedle) || rTitle.startsWith(fullNeedle)) score += 95;
    else if (cTitle.includes(fullNeedle) || rTitle.includes(fullNeedle)) score += 65;

    if (sTitle && sTitle.includes(fullNeedle)) score += 45;
    if (group === fullNeedle) score += 30;

    for (let t = 0; t < tokens.length; t++) {
      const tok = tokens[t];
      if (cTitle.includes(tok) || rTitle.includes(tok)) score += 25;
      else if (sTitle.includes(tok)) score += 18;
      else if (group.includes(tok)) score += 10;
      else score += 5;
    }

    // Prefer playable series episodes / clean live channels slightly on ties
    if (item.kind === 'live') score += 2;
    if (item.url) score += 1;

    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));

  const live: MediaItem[] = [];
  const movies: MediaItem[] = [];
  const series: MediaItem[] = [];
  const combined: MediaItem[] = [];

  for (let i = 0; i < scored.length; i++) {
    const it = scored[i].item;
    if (combined.length < limit * 2) combined.push(it);
    if (it.kind === 'live' && live.length < limit) live.push(it);
    else if (it.kind === 'movie' && movies.length < limit) movies.push(it);
    else if (it.kind === 'series' && series.length < limit) series.push(it);
  }

  // Search EPG programmes when viewing All or Live TV
  const progHits: SearchProgrammeHit[] = [];
  if ((kindFilter === 'all' || kindFilter === 'live') && opts.programmes && opts.programmes.length > 0) {
    const livePool = allItems.filter(
      (i) => i.kind === 'live' && (!enabled || enabled.has(i.playlistId)),
    );
    for (let i = 0; i < opts.programmes.length; i++) {
      const pr = opts.programmes[i];
      if (pr.end < now - 5 * 60_000) continue; // skip already-ended shows
      const pText = normalizeSearchText(`${pr.title} ${pr.description ?? ''}`);
      let ok = true;
      for (let t = 0; t < tokens.length; t++) {
        if (!pText.includes(tokens[t])) { ok = false; break; }
      }
      if (!ok) continue;
      const channel = livePool.find((ch) => matchesChannelEpg(pr.channelId, ch));
      progHits.push({
        programme: pr,
        channel,
        isLiveNow: now >= pr.start && now < pr.end,
      });
      if (progHits.length >= 24) break;
    }
    progHits.sort((a, b) => Number(b.isLiveNow) - Number(a.isLiveNow) || a.programme.start - b.programme.start);
  }

  return {
    total: scored.length,
    items: combined,
    live,
    movies,
    series,
    programmes: progHits,
  };
}
