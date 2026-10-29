import { describe, expect, it } from 'vitest';
import { cleanGroup, cleanTitle } from './display';
import { formatOf } from '@/playback/capabilities/capabilities';

describe('cleanTitle', () => {
  it('removes VIP tags and contact spam that overflow layouts', () => {
    const out = cleanTitle('👑 PK Pakistan Super Drama & News HD [PRO VIP] • Contact 0306-2015326');
    expect(out).not.toContain('0306');
    expect(out).not.toContain('PRO VIP');
    expect(out).toContain('Pakistan Super Drama');
  });
  it('keeps normal titles and years', () => {
    expect(cleanTitle('Bol (2011)')).toContain('Bol');
    expect(cleanTitle('1899 — S01E01')).toContain('1899');
  });
  it('cleans group names for chips', () => {
    expect(cleanGroup('🎬🍿 MOVIES & CINEMA HD')).toContain('MOVIES');
    expect(cleanGroup('').length).toBeGreaterThan(0);
  });
});

describe('formatOf with tokenized URLs', () => {
  it('detects DASH from pathname despite auth query (render.mpd?auth=…&q=auto)', () => {
    expect(formatOf('https://live.example.com:5789/render.mpd?auth=abc123&channel_id=917&q=auto')).toBe('dash');
  });
  it('detects HLS, TS, FLV, native', () => {
    expect(formatOf('https://h/x.m3u8?token=1')).toBe('hls');
    expect(formatOf('https://h/live/1.ts')).toBe('mpegts');
    expect(formatOf('https://h/live/1.flv')).toBe('flv');
    expect(formatOf('https://h/v.mp4')).toBe('native');
  });
  it('honors forced format from Direct Play', () => {
    expect(formatOf('https://h/stream', 'dash')).toBe('dash');
    expect(formatOf('https://h/stream', 'ts')).toBe('mpegts');
  });
  it('keeps RTSP unsupported (no browser/gateway)', () => {
    expect(formatOf('rtsp://h/ch1')).toBe('unsupported');
  });
});
