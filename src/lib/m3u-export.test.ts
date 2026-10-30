import { describe, expect, it } from 'vitest';
import { buildM3uPlaylist, buildVideoFilterCss } from './m3u-export';
import { parseM3U } from '@/services/playlist/m3u';
import type { MediaItem } from '@/types/models';

describe('Video picture equalizer & M3U playlist exporter', () => {
  it('returns undefined for unmodified standard preset and valid CSS filter for presets/sliders', () => {
    expect(
      buildVideoFilterCss({ videoPreset: 'standard', videoBrightness: 100, videoContrast: 100, videoSaturation: 100 }),
    ).toBeUndefined();
    const cinema = buildVideoFilterCss({
      videoPreset: 'cinema',
      videoBrightness: 97,
      videoContrast: 112,
      videoSaturation: 108,
    });
    expect(cinema).toContain('brightness(97%)');
    expect(cinema).toContain('contrast(112%)');
    expect(cinema).toContain('saturate(108%)');

    const custom = buildVideoFilterCss({
      videoPreset: 'custom',
      videoBrightness: 110,
      videoContrast: 105,
      videoSaturation: 120,
    });
    expect(custom).toBe('brightness(110%) contrast(105%) saturate(120%)');
  });

  it('exports standards-compliant #EXTM3U that round-trips cleanly through parseM3U', () => {
    const sample: MediaItem[] = [
      {
        id: 'c1',
        playlistId: 'p1',
        kind: 'live',
        title: 'ARY News HD',
        url: 'https://streams.example.com/ary/index.m3u8',
        group: 'Pakistan News',
        tvgId: 'arynews.pk',
        logo: 'https://cdn.example.com/ary.png',
        referrer: 'https://arynews.tv/',
        drmClearKeys: { '00112233445566778899aabbccddeeff': 'ffeeddccbbaa99887766554433221100' },
      },
    ];

    const m3uText = buildM3uPlaylist(sample, 'My Favourites');
    expect(m3uText.startsWith('#EXTM3U')).toBe(true);
    expect(m3uText).toContain('tvg-id="arynews.pk"');
    expect(m3uText).toContain('group-title="Pakistan News"');
    expect(m3uText).toContain('#EXTVLCOPT:http-referrer=https://arynews.tv/');
    expect(m3uText).toContain('#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey');

    const parsed = parseM3U(m3uText);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].title).toBe('ARY News HD');
    expect(parsed.items[0].group).toBe('Pakistan News');
    expect(parsed.items[0].tvgId).toBe('arynews.pk');
    expect(parsed.items[0].referrer).toBe('https://arynews.tv/');
    expect(parsed.items[0].drmClearKeys).toEqual({
      '00112233445566778899aabbccddeeff': 'ffeeddccbbaa99887766554433221100',
    });
  });
});
