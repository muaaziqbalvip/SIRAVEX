import { describe, expect, it } from 'vitest';
import { classifyFormat, isHttpUrl, redactUrl, sanitizeUrl, validatePlaylistFile } from './security';

describe('security helpers', () => {
  it('validates http urls', () => { expect(isHttpUrl('https://a.example/x.m3u8')).toBe(true); expect(isHttpUrl('javascript:alert(1)')).toBe(false); });
  it('sanitizes dangerous schemes', () => { expect(sanitizeUrl('data:text/html,hi')).toBeNull(); expect(sanitizeUrl(' https://a.example/v.mp4 ')).toContain('https://'); });
  it('redacts credentials and query strings', () => { const r = redactUrl('https://user:pass@example.com:8080/live?token=secret'); expect(r).toBe('https://example.com:8080'); expect(r).not.toContain('secret'); });
  it('classifies formats honestly', () => { expect(classifyFormat('https://x/a.m3u8')).toBe('hls'); expect(classifyFormat('rtsp://x/a')).toBe('unsupported'); expect(classifyFormat('https://x/a.ts')).toBe('unsupported'); });
  it('validates playlist files', () => { expect(validatePlaylistFile(new File(['x'], 'list.m3u'))).toBeNull(); expect(validatePlaylistFile(new File(['x'], 'list.exe'))).toContain('Unsupported'); });
});
