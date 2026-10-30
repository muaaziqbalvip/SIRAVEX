import { describe, expect, it } from 'vitest';
import { normalizeSearchText, searchLibrary, tokenizeQuery } from './search';
import type { EpgProgramme, MediaItem } from '@/types/models';

const SAMPLE_ITEMS: MediaItem[] = [
  ...Array.from({ length: 30 }, (_, idx): MediaItem => ({
    id: `mov-${idx}`,
    playlistId: 'p1',
    kind: 'movie',
    title: `Sports Documentary Vol ${idx + 1}`,
    url: `https://example.com/movie/${idx}.mp4`,
    group: 'Sports Movies',
  })),
  {
    id: 'live-ptv',
    playlistId: 'p1',
    kind: 'live',
    title: 'PK | PTV Sports HD',
    url: 'https://example.com/live/ptv.m3u8',
    group: 'Pakistan Sports',
    tvgId: 'ptv.sports.pk',
  },
  {
    id: 'live-geo',
    playlistId: 'p1',
    kind: 'live',
    title: 'PK: Geo News FHD',
    url: 'https://example.com/live/geo.m3u8',
    group: 'Urdu News',
    tvgId: 'geonews.pk',
  },
  {
    id: 'ser-1',
    playlistId: 'p1',
    kind: 'series',
    title: 'Spider-Man S01E01',
    seriesTitle: 'Spider-Man',
    url: 'https://example.com/series/1.mp4',
    group: 'Animation',
  },
];

describe('Search engine (v3.5.0)', () => {
  it('normalizes punctuation and diacritics into clean tokens', () => {
    expect(normalizeSearchText('PK | Spider-Man: Café!')).toBe('pk spider man cafe');
    expect(tokenizeQuery('  Geo   News  ')).toEqual(['geo', 'news']);
  });

  it('never hides Live TV matches when >20 Movies also match the query', () => {
    const res = searchLibrary(SAMPLE_ITEMS, 'sports');
    expect(res.movies.length).toBe(30);
    expect(res.live.map((c) => c.id)).toContain('live-ptv');
  });

  it('matches multi-word queries across group + title and punctuation', () => {
    expect(searchLibrary(SAMPLE_ITEMS, 'urdu geo').live[0]?.id).toBe('live-geo');
    expect(searchLibrary(SAMPLE_ITEMS, 'spider man').series[0]?.id).toBe('ser-1');
  });

  it('surfaces live EPG programmes and links them to matching channels', () => {
    const now = 1_700_000_000_000;
    const progs: EpgProgramme[] = [
      {
        id: 'epg-1',
        channelId: 'PTV.SPORTS.PK', // case-different tvgId!
        title: 'Live Cricket: Pakistan vs Australia',
        start: now - 600_000,
        end: now + 3_600_000,
      },
    ];
    const res = searchLibrary(SAMPLE_ITEMS, 'cricket australia', { programmes: progs, now });
    expect(res.programmes).toHaveLength(1);
    expect(res.programmes[0].isLiveNow).toBe(true);
    expect(res.programmes[0].channel?.id).toBe('live-ptv');
  });
});
