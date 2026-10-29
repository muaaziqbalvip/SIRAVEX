import { describe, expect, it } from 'vitest';
import { isSubtitleFile, srtToVtt } from './subtitles';

describe('subtitle helpers', () => {
  it('converts SRT timestamps and indices to WebVTT', () => {
    const vtt = srtToVtt('1\n00:00:01,250 --> 00:00:03,500\nAssalam-o-Alaikum\n\n2\n00:00:04,000 --> 00:00:05,000\nDusri line\n');
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.250 --> 00:00:03.500');
    expect(vtt).toContain('Assalam-o-Alaikum');
    expect(vtt).not.toContain('\n1\n');
  });
  it('accepts only subtitle extensions', () => {
    expect(isSubtitleFile('film.SRT')).toBe(true);
    expect(isSubtitleFile('film-en.vtt')).toBe(true);
    expect(isSubtitleFile('film.mp4')).toBe(false);
  });
});
