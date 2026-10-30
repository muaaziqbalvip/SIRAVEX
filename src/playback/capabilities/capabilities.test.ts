import { describe, expect, it } from 'vitest';
import { formatOf } from './capabilities';

describe('formatOf audit regressions', () => {
  it('does NOT guess DASH for extension-less live/stream endpoints', () => {
    expect(formatOf('https://cdn.example.com/stream')).toBe('unknown');
    expect(formatOf('https://cdn.example.com/playlist')).toBe('unknown');
    expect(formatOf('http://host:8080/live/user/pass/12345')).toBe('unknown');
  });

  it('still detects explicit DASH & Smooth Streaming hints and query params', () => {
    expect(formatOf('https://host/render.mpd?auth=tok&q=auto')).toBe('dash');
    expect(formatOf('https://host/render?auth=tok')).toBe('dash');
    expect(formatOf('https://host/watch?format=mpd')).toBe('dash');
    expect(formatOf('https://host/live/channel.ism/Manifest')).toBe('dash');
    expect(formatOf('https://host/get.php?output=m3u8')).toBe('hls');
  });

  it('unwraps /api/relay?u=... URLs to detect the underlying stream format', () => {
    const wrapped = `/api/relay?u=${encodeURIComponent('http://cdn.example.com/live/ch1.m3u8?token=xyz')}`;
    expect(formatOf(wrapped)).toBe('hls');
  });

  it('forced format always wins', () => {
    expect(formatOf('https://host/live/u/p/1.ts', 'hls')).toBe('hls');
    expect(formatOf('https://host/x.m3u8', 'mpegts')).toBe('mpegts');
  });
});
