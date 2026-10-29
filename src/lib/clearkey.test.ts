import { describe, expect, it } from 'vitest';
import { formatBitrate, parseClearKeys } from './clearkey';

const KID = '00112233445566778899aabbccddeeff';
const KEY = 'ffeeddccbbaa99887766554433221100';

describe('parseClearKeys', () => {
  it('kid:key hex parse karta hai', () => {
    expect(parseClearKeys(`${KID}:${KEY}`)).toEqual({ [KID]: KEY });
  });
  it('multiple pairs aur JSON map parse karta hai', () => {
    expect(Object.keys(parseClearKeys(`${KID}:${KEY}, ${KEY}:${KID}`) ?? {})).toHaveLength(2);
    expect(parseClearKeys(`{"${KID}":"${KEY}"}`)).toEqual({ [KID]: KEY });
  });
  it('JWK base64url set parse karta hai', () => {
    const b64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwk = JSON.stringify({ keys: [{ kty: 'oct', kid: b64(KID), k: b64(KEY) }] });
    expect(parseClearKeys(jwk)).toEqual({ [KID]: KEY });
  });
  it('ghalat input par null deta hai', () => {
    expect(parseClearKeys('hello world')).toBeNull();
    expect(parseClearKeys('')).toBeNull();
    expect(parseClearKeys('zz:yy')).toBeNull();
  });
});

describe('formatBitrate', () => {
  it('Mbps/kbps labels', () => {
    expect(formatBitrate(4_200_000)).toBe('4.2 Mbps');
    expect(formatBitrate(800_000)).toBe('800 kbps');
    expect(formatBitrate(0)).toBe('');
    expect(formatBitrate(undefined)).toBe('');
  });
});
