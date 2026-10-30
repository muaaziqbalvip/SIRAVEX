import { describe, expect, it } from 'vitest';
import { matchesChannelEpg, nowAndNext, nowAndNextForItem, parseXmltv, parseXmltvTime } from './xmltv';

describe('parseXmltvTime', () => {
  it('parses timezone-aware datetimes', () => {
    const t = parseXmltvTime('20260101120000 +0000');
    expect(t).toBe(Date.UTC(2026, 0, 1, 12, 0, 0));
  });
  it('applies offsets', () => {
    expect(parseXmltvTime('20260101120000 +0200')).toBe(Date.UTC(2026, 0, 1, 10, 0, 0));
  });
  it('returns null for invalid values', () => { expect(parseXmltvTime('soon')).toBeNull(); });
});

describe('parseXmltv & EPG channel matching', () => {
  it('parses programmes and skips broken ones', () => {
    const xml = `<?xml version="1.0"?><tv><channel id="ch1"><display-name>One</display-name></channel><programme channel="ch1" start="20260101100000 +0000" stop="20260101110000 +0000"><title>Show A</title><desc>Desc</desc></programme><programme channel="ch1"><title>Broken</title></programme></tv>`;
    const r = parseXmltv(xml);
    expect(r.programmes).toHaveLength(1);
    expect(r.programmes[0].title).toBe('Show A');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('handles invalid XML', () => { expect(parseXmltv('<tv><oops').warnings.length).toBeGreaterThan(0); });
  it('nowAndNext finds current programme', () => {
    const progs = [{ id: '1', channelId: 'c', title: 'Now', start: 1000, end: 3000 }, { id: '2', channelId: 'c', title: 'Next', start: 3000, end: 4000 }];
    const r = nowAndNext(progs, 'c', 2000);
    expect(r.current?.title).toBe('Now'); expect(r.next?.title).toBe('Next');
  });
  it('matchesChannelEpg matches case-insensitively by tvgId, id, or normalized title', () => {
    const item = { id: 'pl1:0:GeoNews', title: 'PK | Geo News HD', tvgId: 'GeoNews.PK' };
    expect(matchesChannelEpg('geonews.pk', item)).toBe(true);
    expect(matchesChannelEpg('pl1:0:GeoNews', { id: 'pl1:0:GeoNews', title: 'Geo News' })).toBe(true);
    const progs = [{ id: 'p1', channelId: 'GEONEWS.PK', title: 'Headline Bulletin', start: 100, end: 500 }];
    expect(nowAndNextForItem(progs, item, 250).current?.title).toBe('Headline Bulletin');
  });
});
