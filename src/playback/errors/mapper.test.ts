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
