import { describe, expect, it } from 'vitest';
import { buildCandidates } from './candidates';

describe('failover ladder', () => {
  it('multi-language custom-port HLS: direct pehle, relay aakhir mein', () => {
    const list = buildCandidates('https://streams.example:5789/live/auto/559.m3u8', 'hls', { relay: true });
    expect(list[0]).toMatchObject({ format: 'hls', via: 'direct' });
    expect(list[list.length - 1]).toMatchObject({ format: 'hls', via: 'relay' });
    // /live/auto/559 gehri Xtream path nahi (user/pass nahi) — .ts variant guess nahi hoga
    expect(list.some((c) => c.format === 'mpegts')).toBe(false);
  });
  it('Xtream gehri path par same-server TS variant aata hai', () => {
    const list = buildCandidates('http://host:8080/live/user/pass/123.m3u8', 'hls', {});
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
    const list = buildCandidates('https://host/live/1.m3u8?a=1', 'hls', { relay: true });
    const relay = list[list.length - 1];
    expect(relay.url.startsWith('/api/relay?u=')).toBe(true);
    expect(relay.url).not.toContain('&a=1');
  });
});
