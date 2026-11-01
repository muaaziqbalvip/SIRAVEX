import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectXtream, decodeB64, extractCredsFromUrl, normalizeServer, streamUrls } from './xtream';
import { normalizeStreamUrl } from '@/lib/security';
import { extractYear } from '@/services/playlist/m3u';

const creds = { server: 'http://prov.example:8080/', username: 'u ser', password: 'p@ss' };

describe('xtream service', () => {
  it('normalizes server addresses (with or without http://)', () => {
    expect(normalizeServer('http://prov.example:8080/')).toBe('http://prov.example:8080');
    expect(normalizeServer('prov.example:8080')).toBe('http://prov.example:8080');
    expect(normalizeServer('185.20.30.40:8080/c')).toBe('http://185.20.30.40:8080');
    expect(normalizeServer('http://prov.example:8080/player_api.php?x=1')).toBe('http://prov.example:8080');
    expect(normalizeServer('notaurl')).toBeNull();
  });

  it('extracts credentials from pasted get.php URLs and honors ts-only Xtream panels', async () => {
    const ext = extractCredsFromUrl('http://star.example:8080/get.php?username=ali&password=786&type=m3u_plus&output=ts');
    expect(ext).toEqual({ server: 'http://star.example:8080', username: 'ali', password: '786' });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const s = String(input);
      if (s.includes('action=get_live_streams')) {
        return new Response(JSON.stringify([{ stream_id: 99, name: 'Geo News', category_id: '1' }]), { status: 200 });
      }
      if (s.includes('action=')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(
        JSON.stringify({ user_info: { auth: 1, status: 'Active', allowed_output_formats: ['ts'] } }),
        { status: 200 },
      );
    });

    const res = await connectXtream({ server: 'star.example:8080', username: 'ali', password: '786' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].url).toBe('http://star.example:8080/live/ali/786/99.ts');
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
