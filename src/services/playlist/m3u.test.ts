import { describe, expect, it } from 'vitest';
import { parseM3U } from './m3u';

const VALID = `#EXTM3U
#EXTINF:-1 tvg-id="ch1" tvg-logo="https://example.com/a.png" group-title="News",Example News
https://example.com/live/ch1.m3u8
#EXTINF:-1 group-title="Movies",Demo Film
https://example.com/movie/film.mp4
#EXTINF:-1 group-title="Series",My Show S01E02 Episode
https://example.com/series/show/2.mp4`;

describe('parseM3U', () => {
  it('parses valid entries with metadata', () => {
    const r = parseM3U(VALID);
    expect(r.items).toHaveLength(3);
    expect(r.items[0].tvgId).toBe('ch1');
    expect(r.items[0].kind).toBe('live');
    expect(r.items[1].kind).toBe('movie');
    expect(r.items[2].kind).toBe('series');
    expect(r.items[2].season).toBe(1);
    expect(r.items[2].episode).toBe(2);
  });

  it('parses #KODIPROP ClearKey, Widevine license URL, #EXTVLCOPT referrer & pipe headers', () => {
    const m3u = [
      '#EXTM3U',
      '#KODIPROP:inputstream.adaptive.manifest_type=mpd',
      '#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey',
      '#KODIPROP:inputstream.adaptive.license_key=00112233445566778899aabbccddeeff:ffeeddccbbaa99887766554433221100',
      '#EXTVLCOPT:http-referrer=https://portal.example.com/',
      '#EXTINF:-1 group-title="Sports",Sports DASH',
      'https://cdn.example.com/live/sports/stream',
      '#EXTINF:-1 group-title="Movies",Widevine Stream',
      '#KODIPROP:inputstream.adaptive.manifest_type=mpd',
      '#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha',
      '#KODIPROP:inputstream.adaptive.license_key=https://license.example.com/wv|Content-Type=application/octet-stream',
      'https://cdn.example.com/vod/movie.mpd|User-Agent=Kodi&Referer=https://wv.example.com/',
    ].join('\n');

    const r = parseM3U(m3u);
    expect(r.items).toHaveLength(2);
    expect(r.items[0].forcedFormat).toBe('dash');
    expect(r.items[0].drmClearKeys).toEqual({
      '00112233445566778899aabbccddeeff': 'ffeeddccbbaa99887766554433221100',
    });
    expect(r.items[0].referrer).toBe('https://portal.example.com/');

    expect(r.items[1].forcedFormat).toBe('dash');
    expect(r.items[1].drmLicenseUrl).toBe('https://license.example.com/wv');
    expect(r.items[1].url).toBe('https://cdn.example.com/vod/movie.mpd');
    expect(r.items[1].referrer).toBe('https://wv.example.com/');
  });

  it('warns on malformed entries without crashing', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:-1,Broken\nnotaurl\nhttps://example.com/ok.m3u8\n');
    expect(r.report.warnings.length).toBeGreaterThan(0);
    expect(r.items).toHaveLength(1);
  });

  it('reports empty playlist as error', () => {
    const r = parseM3U('   ');
    expect(r.report.errors.length).toBeGreaterThan(0);
    expect(r.items).toHaveLength(0);
  });

  it('rejects dangerous URL schemes', () => {
    const r = parseM3U('#EXTM3U\n#EXTINF:-1,Evil\njavascript:alert(1)\n');
    expect(r.items).toHaveLength(0);
  });
});
