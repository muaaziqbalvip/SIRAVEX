import { describe, expect, it } from 'vitest';
import { mapPlaybackError } from './mapper';

describe('mapPlaybackError', () => {
  it('maps RTSP to unsupported with gateway guidance', () => {
    const e = mapPlaybackError({ url: 'rtsp://example.com/ch1', format: 'unsupported' });
    expect(e.category).toBe('unsupported-format'); expect(e.retryable).toBe(false); expect(e.message).toContain('gateway');
  });
  it('maps 403 to auth without leaking url secrets', () => {
    const e = mapPlaybackError({ message: 'HTTP 403 forbidden token=abc123' });
    expect(e.category).toBe('auth'); expect(e.message).not.toContain('abc123');
  });
  it('maps CORS failures with host only', () => {
    const e = mapPlaybackError({ message: 'Failed to fetch due to CORS', url: 'https://prov.example/live?token=secret' });
    expect(e.category).toBe('cors'); expect(e.message).not.toContain('secret');
  });
  it('maps media code 4 to codec', () => { expect(mapPlaybackError({ code: 4 }).category).toBe('unsupported-codec'); });
});

describe('shaka error codes', () => {
  it('maps network/HTTP failures with the real code', () => {
    const r = mapPlaybackError({ shakaCode: 1002, url: 'https://hidden.example/live.mpd?a=1' });
    expect(r.category).toBe('cors');
    expect(r.codeLabel).toBe('DASH error 1002');
    expect(r.message).not.toContain('hidden.example');
  });
  it('maps auth/token failures to a clear hint', () => {
    const r = mapPlaybackError({ shakaCode: 1001 });
    expect(r.category).toBe('auth');
    expect(r.action).toMatch(/fresh link|Re-import/i);
  });
  it('maps DRM failures to the drm category with licence guidance', () => {
    const r = mapPlaybackError({ shakaCode: 6001 });
    expect(r.category).toBe('drm');
    expect(r.action).toMatch(/licence|ClearKey/i);
  });
  it('maps key/restriction failures honestly', () => {
    const r = mapPlaybackError({ shakaCode: 7000 });
    expect(r.category).toBe('unsupported-format');
    expect(r.action).toMatch(/licence keys/i);
  });
  it('still falls back safely for truly unknown inputs', () => {
    const r = mapPlaybackError({ shakaCode: 42 });
    expect(r.category).toBe('unknown');
    expect(r.codeLabel).toBe('DASH error 42');
  });
});
