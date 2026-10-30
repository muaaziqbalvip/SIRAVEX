import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearMzAdsCache,
  disableMzAds,
  embedScriptUrl,
  fetchMzSlot,
  formatMzPrice,
  HOUSE_PROMOS,
  MZ_ADS_HOST,
  resolveMzHref,
  resolveMzMediaUrl,
  serveUrl,
  shouldShowPreroll,
  trackMzEvent,
} from './ads';

describe('Mizanora Ads API client', () => {
  afterEach(() => {
    clearMzAdsCache();
    vi.restoreAllMocks();
  });

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

  it('resolves relative /product/... links to Mizanora host and blocks unsafe schemes', () => {
    expect(resolveMzHref('/product/winter-jacket')).toBe('https://mizanora.vercel.app/product/winter-jacket');
    expect(resolveMzHref('https://mizanora.vercel.app/category/watch')).toBe('https://mizanora.vercel.app/category/watch');
    expect(resolveMzHref('javascript:alert(1)')).toBe(MZ_ADS_HOST);
    expect(resolveMzMediaUrl('/uploads/banner.jpg')).toBe('https://mizanora.vercel.app/uploads/banner.jpg');
    expect(resolveMzMediaUrl('data:text/html,evil')).toBeNull();
    expect(formatMzPrice(1499, 'PKR')).toBe('Rs. 1,499');
  });

  it('fetches ads via /api/ads/serve, tracks signed events, and syncs disableMzAds flag', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          rotateMs: 9000,
          ads: [{ id: 'camp_1', type: 'product', headline: 'Winter Sale', href: '/product/coat', token: 'tok_abc' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ).mockResolvedValue(new Response('{}', { status: 200 }));

    const res = await fetchMzSlot('banner', 2, true);
    expect(res.ok).toBe(true);
    expect(res.ads).toHaveLength(1);
    expect(res.rotateMs).toBe(9000);

    trackMzEvent('impression', res.ads[0]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, postInit] = fetchSpy.mock.calls[1];
    const body = JSON.parse(String(postInit?.body));
    expect(body).toMatchObject({
      campaign: 'camp_1',
      token: 'tok_abc',
      href: 'https://mizanora.vercel.app/product/coat',
    });

    (window as unknown as { MZADS_API?: { disabled?: boolean } }).MZADS_API = { disabled: false };
    disableMzAds();
    expect((window as unknown as { MZADS_API?: { disabled?: boolean } }).MZADS_API?.disabled).toBe(true);
    const disabledRes = await fetchMzSlot('banner', 2);
    expect(disabledRes.ads).toEqual([]);
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
