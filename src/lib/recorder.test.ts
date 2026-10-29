import { describe, expect, it } from 'vitest';
import { REC_QUALITIES, formatBytes, formatRecClock, pickRecordingMime, recordingExt, safeFileBase } from './recorder';
import { applyFavouriteOrder, nextSortOrder, sortFavourites } from './favourites-order';
import type { Favourite } from '@/types/models';

describe('pickRecordingMime ladder', () => {
  const only = (...ok: string[]) => (m: string) => ok.includes(m);
  it('prefers MP4 avc1 when supported', () => {
    expect(pickRecordingMime(() => true)).toContain('video/mp4');
  });
  it('falls back to WebM VP9 then VP8', () => {
    expect(pickRecordingMime(only('video/webm;codecs=vp9,opus'))).toBe('video/webm;codecs=vp9,opus');
    expect(pickRecordingMime(only('video/webm;codecs=vp8,opus', 'video/webm'))).toBe('video/webm;codecs=vp8,opus');
  });
  it('returns empty when nothing supported', () => {
    expect(pickRecordingMime(() => false)).toBe('');
  });
  it('survives a throwing isTypeSupported', () => {
    expect(pickRecordingMime(() => { throw new Error('x'); })).toBe('');
  });
});

describe('recording helpers', () => {
  it('extension by mime', () => {
    expect(recordingExt('video/mp4;codecs="avc1"')).toBe('mp4');
    expect(recordingExt('video/webm;codecs=vp9,opus')).toBe('webm');
  });
  it('formatBytes scales', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
    expect(formatBytes(-5)).toBe('0 B');
  });
  it('formatRecClock mm:ss and h:mm:ss', () => {
    expect(formatRecClock(0)).toBe('0:00');
    expect(formatRecClock(65)).toBe('1:05');
    expect(formatRecClock(3661)).toBe('1:01:01');
  });
  it('safeFileBase slugs title, keeps no URL chars, adds date', () => {
    const base = safeFileBase('ARY News HD — Live!!', new Date(2026, 9, 29, 14, 5));
    expect(base).toBe('siravex-ary-news-hd-live-20261029-1405');
    expect(safeFileBase('', new Date(2026, 0, 2, 3, 4))).toBe('siravex-stream-20260102-0304');
    expect(safeFileBase('x'.repeat(200), new Date(2026, 0, 2)).length).toBeLessThanOrEqual(48 + 24);
  });
  it('quality presets descend in bitrate', () => {
    const bits = REC_QUALITIES.map((q) => q.videoBitsPerSecond);
    expect(bits).toEqual([...bits].sort((a, b) => b - a));
    expect(new Set(REC_QUALITIES.map((q) => q.id)).size).toBe(3);
  });
});

const fav = (itemId: string, createdAt: number, sortOrder?: number): Favourite => ({ id: `fav:${itemId}`, itemId, createdAt, sortOrder });
describe('favourites ordering', () => {
  it('legacy entries sort by createdAt', () => {
    expect(sortFavourites([fav('b', 2), fav('a', 1)]).map((f) => f.itemId)).toEqual(['a', 'b']);
  });
  it('explicit sortOrder wins over createdAt', () => {
    expect(sortFavourites([fav('a', 1, 5), fav('b', 2, 3)]).map((f) => f.itemId)).toEqual(['b', 'a']);
  });
  it('applyFavouriteOrder assigns index order and keeps unlisted last', () => {
    const out = applyFavouriteOrder([fav('a', 1), fav('b', 2), fav('c', 3)], ['c', 'a']);
    expect(sortFavourites(out).map((f) => f.itemId)).toEqual(['c', 'a', 'b']);
  });
  it('nextSortOrder appends at end', () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([fav('a', 1, 7)])).toBe(8);
  });
});
