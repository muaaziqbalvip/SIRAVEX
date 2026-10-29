import { describe, expect, it } from 'vitest';
import { HOUSE_PROMOS, MZ_ADS_HOST, embedScriptUrl, serveUrl, shouldShowPreroll } from './ads';

describe('Mizanora Ads API client', () => {
  it('embed script URL carries host + key', () => {
    const u = embedScriptUrl('mza_test123');
    expect(u).toBe('https://mizanora.vercel.app/api/ads/embed.js?key=mza_test123');
  });
  it('serve URL builds slot + count', () => {
    const u = serveUrl('video', 2, 'k');
    expect(u).toContain('/api/ads/serve?key=k');
    expect(u).toContain('slot=video');
    expect(u).toContain('count=2');
  });
  it('house promos all link to the real shop', () => {
    expect(HOUSE_PROMOS.length).toBeGreaterThanOrEqual(3);
    for (const p of HOUSE_PROMOS) expect(p.href.startsWith(MZ_ADS_HOST)).toBe(true);
  });
});

describe('preroll frequency', () => {
  const now = 10_000_000;
  it('first time shows', () => {
    expect(shouldShowPreroll({ lastShownAt: 0, sessionShown: false, now })).toBe(true);
  });
  it('session already shown blocks', () => {
    expect(shouldShowPreroll({ lastShownAt: 0, sessionShown: true, now })).toBe(false);
  });
  it('inside 30m window blocks, after shows', () => {
    expect(shouldShowPreroll({ lastShownAt: now - 10 * 60000, sessionShown: false, now })).toBe(false);
    expect(shouldShowPreroll({ lastShownAt: now - 31 * 60000, sessionShown: false, now })).toBe(true);
  });
});
