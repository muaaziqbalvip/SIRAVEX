import { describe, expect, it } from 'vitest';
import {
  hashParentalPin,
  isAdultCategoryOrTitle,
  isGroupLocked,
  isMediaLocked,
  isValidPinFormat,
  verifyParentalPin,
} from './parental';
import { DEFAULT_SETTINGS, type MediaItem } from '@/types/models';

describe('Parental controls & PIN security', () => {
  it('validates 4–8 digit numeric PIN format', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('98765432')).toBe(true);
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('12ab')).toBe(false);
  });

  it('hashes and verifies PINs with salted SHA-256', async () => {
    const hash = await hashParentalPin('2580');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('2580');
    expect(await verifyParentalPin('2580', hash)).toBe(true);
    expect(await verifyParentalPin('0000', hash)).toBe(false);
  });

  it('detects adult/18+/XXX category names without false positives on normal channels', () => {
    expect(isAdultCategoryOrTitle('For Adults 18+')).toBe(true);
    expect(isAdultCategoryOrTitle('XXX VIP Movies')).toBe(true);
    expect(isAdultCategoryOrTitle('NSFW Live')).toBe(true);
    expect(isAdultCategoryOrTitle('Sports HD')).toBe(false);
    expect(isAdultCategoryOrTitle('News & Documentary')).toBe(false);
  });

  it('evaluates group and media locks accurately across locked vs unlocked sessions', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      parentalEnabled: true,
      parentalPinHash: 'sha256:dummy',
      parentalAutoAdult: true,
      lockedGroups: ['Late Night Cinema'],
      lockedItemIds: ['item-secret-1'],
    };

    const normalCh: MediaItem = {
      id: 'ch-1',
      playlistId: 'p1',
      kind: 'live',
      title: 'PTV Sports HD',
      url: 'https://example.com/ptv.m3u8',
      group: 'Sports',
    };
    const adultCh: MediaItem = { ...normalCh, id: 'ch-2', group: 'Adult 18+' };
    const customGroupCh: MediaItem = { ...normalCh, id: 'ch-3', group: 'Late Night Cinema' };
    const pinnedItem: MediaItem = { ...normalCh, id: 'item-secret-1' };

    expect(isMediaLocked(normalCh, settings, false)).toBe(false);
    expect(isMediaLocked(adultCh, settings, false)).toBe(true);
    expect(isGroupLocked('Late Night Cinema', settings, false)).toBe(true);
    expect(isMediaLocked(customGroupCh, settings, false)).toBe(true);
    expect(isMediaLocked(pinnedItem, settings, false)).toBe(true);

    // Once session is unlocked with PIN, all items become accessible
    expect(isMediaLocked(adultCh, settings, true)).toBe(false);
    expect(isMediaLocked(customGroupCh, settings, true)).toBe(false);
    expect(isMediaLocked(pinnedItem, settings, true)).toBe(false);
  });
});
