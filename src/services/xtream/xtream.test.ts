import { describe, expect, it } from 'vitest';
import { decodeB64, normalizeServer, streamUrls } from './xtream';
import { normalizeStreamUrl } from '@/lib/security';
import { extractYear } from '@/services/playlist/m3u';

const creds = { server: 'http://prov.example:8080/', username: 'u ser', password: 'p@ss' };

describe('xtream service', () => {
  it('normalizes server addresses', () => {
    expect(normalizeServer('http://prov.example:8080/')).toBe('http://prov.example:8080');
    expect(normalizeServer('http://prov.example:8080/player_api.php?x=1')).toBe('http://prov.example:8080');
    expect(normalizeServer('notaurl')).toBeNull();
  });
  it('builds HLS live urls and encoded vod/series urls', () => {
    const u = streamUrls(creds);
    expect(u.live('42')).toBe('http://prov.example:8080/live/u%20ser/p%40ss/42.m3u8');
    expect(u.vod('7', 'mkv')).toContain('/movie/u%20ser/p%40ss/7.mkv');
    expect(u.series('9', '')).toContain('/series/u%20ser/p%40ss/9.mp4');
  });
  it('decodes base64 short-EPG titles as UTF-8', () => {
    const b64 = Buffer.from('Teri Meri Kahani — قسط', 'utf-8').toString('base64');
    expect(decodeB64(b64)).toContain('Teri Meri Kahani');
    expect(decodeB64('')).toBe('');
    expect(decodeB64('not base64!!')).toBeTruthy();
  });
  it('rewrites Xtream .ts streams to the provider HLS output', () => {
    expect(normalizeStreamUrl('http://h:8080/live/user/pass/123.ts')).toBe('http://h:8080/live/user/pass/123.m3u8');
    expect(normalizeStreamUrl('http://h:8080/movie/user/pass/5.ts?x=1')).toContain('/movie/user/pass/5.m3u8');
    // Generic TS (not Xtream-shaped) stays untouched/unsupported honesty.
    expect(normalizeStreamUrl('http://h/stream.ts')).toBe('http://h/stream.ts');
  });
  it('extracts years from titles', () => {
    expect(extractYear('Some Film (2021) HD')).toBe(2021);
    expect(extractYear('Old Classic 1975')).toBe(1975);
    expect(extractYear('No year here 1080p')).toBeUndefined();
  });
});
