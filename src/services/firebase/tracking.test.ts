import { describe, expect, it } from 'vitest';
import { buildWatchPayload } from './tracking';

describe('tracking privacy', () => {
  it('watch payload mein URL/token kabhi shamil nahi hota', () => {
    const p = buildWatchPayload({ title: 'ARY News', kind: 'live', group: 'News', ...( { url: 'https://secret.host/live/u/pass/1.m3u8?auth=tok' } as object) }, 123);
    expect(Object.keys(p).sort()).toEqual(['at', 'group', 'kind', 'title']);
    expect(JSON.stringify(p)).not.toContain('secret.host');
    expect(JSON.stringify(p)).not.toContain('auth=');
    expect(p.at).toBe(123);
  });
  it('lambi titles mehfooz limit par kat-ti hain', () => {
    const p = buildWatchPayload({ title: 'x'.repeat(500), kind: 'movie' });
    expect(p.title.length).toBe(120);
  });
});
