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
