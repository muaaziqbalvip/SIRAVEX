import type { AppSettings, MediaItem } from '@/types/models';

const ADULT_REGEX = /(?:^|[^a-z0-9])(18\+|adult|adults|xxx|porn|nsfw|erotic|for\s+adults|\+18)(?:$|[^a-z0-9])/i;

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,8}$/.test(pin.trim());
}

/**
 * Deterministic salted SHA-256 hash for Parental Control PIN.
 * Falls back to FNV-1a hex only in legacy test contexts without SubtleCrypto.
 */
export async function hashParentalPin(pin: string): Promise<string> {
  const clean = pin.trim();
  const payload = `siravex-parental-v1::${clean}`;
  if (globalThis.crypto?.subtle) {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv:${(h >>> 0).toString(16)}`;
}

export async function verifyParentalPin(pin: string, expectedHash: string): Promise<boolean> {
  if (!expectedHash) return false;
  const computed = await hashParentalPin(pin);
  return computed === expectedHash;
}

export function isAdultCategoryOrTitle(group?: string, title?: string): boolean {
  const g = (group ?? '').trim();
  const t = (title ?? '').trim();
  return ADULT_REGEX.test(g) || ADULT_REGEX.test(t);
}

export type ParentalSlice = Pick<
  AppSettings,
  'parentalEnabled' | 'parentalPinHash' | 'parentalAutoAdult' | 'lockedGroups' | 'lockedItemIds'
>;

export function isParentalActive(settings: ParentalSlice): boolean {
  return Boolean(settings.parentalEnabled && settings.parentalPinHash);
}

export function isGroupLocked(
  group: string,
  settings: ParentalSlice,
  sessionUnlocked = false,
): boolean {
  if (!isParentalActive(settings) || sessionUnlocked) return false;
  const norm = (group ?? '').trim().toLowerCase();
  if (norm && settings.lockedGroups.some((g) => g.trim().toLowerCase() === norm)) return true;
  if (settings.parentalAutoAdult && isAdultCategoryOrTitle(group)) return true;
  return false;
}

export function isMediaLocked(
  item: Pick<MediaItem, 'id' | 'group' | 'title'>,
  settings: ParentalSlice,
  sessionUnlocked = false,
): boolean {
  if (!isParentalActive(settings) || sessionUnlocked) return false;
  if (settings.lockedItemIds.includes(item.id)) return true;
  if (isGroupLocked(item.group, settings, false)) return true;
  if (settings.parentalAutoAdult && isAdultCategoryOrTitle(item.group, item.title)) return true;
  return false;
}
