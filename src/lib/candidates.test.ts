import { describe, expect, it } from 'vitest';
import { buildCandidates } from './candidates';

describe('failover ladder', () => {
  it('multi-language custom-port HLS: direct pehle, relay aakhir mein', () => {
    const list = buildCandidates('https://streams.example:5789/live/auto/559.m3u8', 'hls', { relay: true, httpsPage: true });
    expect(list[0]).toMatchObject({ format: 'hls', via: 'direct' });
    expect(list[list.length - 1]).toMatchObject({ format: 'hls', via: 'relay' });
    expect(list.some((c) => c.format === 'mpegts')).toBe(false);
  });

  it('HTTPS page par HTTP stream aane par relay-first lagata hai (Mixed Content fix) aur ref forward karta hai', () => {
    const list = buildCandidates('http://live.example:8080/ch/1.m3u8', 'hls', {
      relay: true,
      httpsPage: true,
      referrer: 'https://portal.example/',
    });
    expect(list[0]).toMatchObject({ format: 'hls', via: 'relay' });
    expect(list[0].url).toContain('&ref=');
  });

  it('Xtream gehri path par same-server TS variant aata hai', () => {
    const list = buildCandidates('http://host:8080/live/user/pass/123.m3u8', 'hls', { httpsPage: false });
    expect(list.map((c) => c.format)).toEqual(['hls', 'mpegts']);
  });

  it('extension-less par HLS -> TS -> Native chain', () => {
    const list = buildCandidates('https://host/watch/xyz', 'unknown', {});
    expect(list.map((c) => c.format)).toEqual(['hls', 'mpegts', 'native']);
  });

  it('forced format par sirf wohi candidate (relay ke baghair jab off ho)', () => {
    const list = buildCandidates('https://host/x.m3u8', 'mpegts', { forced: 'mpegts' });
    expect(list).toHaveLength(1);
  });

  it('relay URL mein asal URL encoded hota hai, path saaf rehta hai', () => {
    const list = buildCandidates('https://host/live/1.m3u8?a=1', 'hls', { relay: true, httpsPage: true });
    const relay = list[list.length - 1];
    expect(relay.url.startsWith('/api/relay?u=')).toBe(true);
    expect(relay.url).not.toContain('&a=1');
  });

  it('HTTP extensionless Xtream (/user/pass/12345) on HTTPS builds Edge Relay + Xtream HLS bridge + HTTPS upgrade', () => {
    const list = buildCandidates('http://panel.example.com:8080/myuser/mypass/54321', 'unknown', {
      relay: true,
      httpsPage: true,
    });
    expect(list[0]).toMatchObject({ format: 'hls', via: 'relay' });
    expect(list[1]).toMatchObject({ format: 'mpegts', via: 'relay' });
    expect(list[1].url).toContain('&seg=1');
    expect(list.some((c) => c.via === 'relay' && decodeURIComponent(c.url).includes('/live/myuser/mypass/54321.m3u8'))).toBe(true);
    expect(list.some((c) => c.via === 'direct' && c.url.startsWith('https://panel.example.com/'))).toBe(true);
  });

  it('HTTP MP4 movie on HTTPS uses fast-path &seg=1 Edge Relay first + HTTPS upgrade', () => {
    const list = buildCandidates('http://vod.example.com:8080/movie/u/p/99.mp4', 'native', {
      relay: true,
      httpsPage: true,
    });
    expect(list[0]).toMatchObject({ format: 'native', via: 'relay' });
    expect(list[0].url).toContain('&seg=1');
    expect(list.some((c) => c.url === 'https://vod.example.com/movie/u/p/99.mp4')).toBe(true);
  });
});
