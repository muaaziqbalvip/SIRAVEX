import { describe, expect, it } from 'vitest';
import { formatOf } from './capabilities';

describe('formatOf audit regressions', () => {
  it('does NOT guess DASH for extension-less live/stream endpoints', () => {
    expect(formatOf('https://cdn.example.com/stream')).toBe('unknown');
    expect(formatOf('https://cdn.example.com/playlist')).toBe('unknown');
    expect(formatOf('http://host:8080/live/user/pass/12345')).toBe('unknown');
  });
  it('still detects explicit DASH hints', () => {
    expect(formatOf('https://host/render.mpd?auth=tok&q=auto')).toBe('dash');
    expect(formatOf('https://host/render?auth=tok')).toBe('dash');
    expect(formatOf('https://host/watch?format=mpd')).toBe('dash');
  });
  it('forced format always wins', () => {
    expect(formatOf('https://host/live/u/p/1.ts', 'hls')).toBe('hls');
    expect(formatOf('https://host/x.m3u8', 'mpegts')).toBe('mpegts');
  });
});
