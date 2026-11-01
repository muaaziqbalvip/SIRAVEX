import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  candidateStalkerEndpoints,
  connectStalker,
  formatMacInput,
  normalizeMac,
  normalizePortalUrl,
  resolveStalkerStreamUrl,
  unwrapStalkerCmd,
} from './stalker';

describe('Stalker / Ministra / MAG MAC Portal service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes and formats MAC addresses cleanly', () => {
    expect(normalizeMac('001a79abcdef')).toBe('00:1A:79:AB:CD:EF');
    expect(normalizeMac('00-1a-79-11-22-33')).toBe('00:1A:79:11:22:33');
    expect(normalizeMac('invalid')).toBeNull();
    expect(formatMacInput('001a79ab')).toBe('00:1A:79:AB');
  });

  it('normalizes HTTP and HTTPS Stalker portal URLs with or without scheme', () => {
    expect(normalizePortalUrl('portal.example:8080/c/')).toBe('http://portal.example:8080/c');
    expect(normalizePortalUrl('https://tv.example.com/stalker_portal/c/index.html')).toBe('https://tv.example.com/stalker_portal/c');
    expect(candidateStalkerEndpoints('http://portal.example:8080/stalker_portal/c')[0].endpoint).toBe(
      'http://portal.example:8080/stalker_portal/portal.php',
    );
  });

  it('unwraps ffmpeg / ffrt Stalker stream commands', () => {
    expect(unwrapStalkerCmd('ffmpeg http://185.10.20.30:8080/play/live.php?stream=101&extension=ts')).toBe(
      'http://185.10.20.30:8080/play/live.php?stream=101&extension=ts',
    );
    expect(unwrapStalkerCmd('ffrt2 /live/ch1.m3u8', 'http://portal.example:8080')).toBe('http://portal.example:8080/live/ch1.m3u8');
  });

  it('handshakes MAC portal, imports channels & dynamically resolves create_link stream URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const reqStr = String(input);
      const inner = decodeURIComponent(new URL(reqStr, 'http://localhost').searchParams.get('u') || '');
      if (inner.includes('action=handshake')) {
        return new Response(JSON.stringify({ js: { token: 'BEARER_TOK_999' } }), { status: 200 });
      }
      if (inner.includes('action=get_profile')) {
        return new Response(JSON.stringify({ js: { id: 1 } }), { status: 200 });
      }
      if (inner.includes('action=get_main_info')) {
        return new Response(JSON.stringify({ js: { end_date: '2027-12-31' } }), { status: 200 });
      }
      if (inner.includes('action=get_genres')) {
        return new Response(JSON.stringify({ js: [{ id: '10', title: 'Sports' }] }), { status: 200 });
      }
      if (inner.includes('action=get_all_channels')) {
        return new Response(
          JSON.stringify({
            js: {
              data: [
                {
                  id: '501',
                  name: 'PTV Sports HD',
                  cmd: 'ffrt http://localhost/ch/501',
                  tv_genre_id: '10',
                  logo: '/logos/ptv.png',
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (inner.includes('action=create_link')) {
        return new Response(
          JSON.stringify({
            js: {
              cmd: 'ffmpeg http://185.55.66.77:8080/play/live.php?mac=00:1A:79:AA:BB:CC&stream=501&extension=ts&play_token=SIGNED123',
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ js: { data: [] } }), { status: 200 });
    });

    const connected = await connectStalker({ portal: 'portal.example:8080/c/', mac: '001a79aabbcc' });
    expect(connected.normalizedPortal).toBe('http://portal.example:8080/c');
    expect(connected.normalizedMac).toBe('00:1A:79:AA:BB:CC');
    expect(connected.items).toHaveLength(1);
    expect(connected.items[0].title).toBe('PTV Sports HD');
    expect(connected.items[0].group).toBe('Sports');
    expect(connected.items[0].stalkerCmd).toBe('ffrt http://localhost/ch/501');

    const resolved = await resolveStalkerStreamUrl({
      portal: connected.normalizedPortal,
      mac: connected.normalizedMac,
      cmd: connected.items[0].stalkerCmd!,
      kind: 'itv',
    });
    expect(resolved.url).toContain('http://185.55.66.77:8080/play/live.php');
    expect(resolved.url).toContain('extension=ts');
  });
});
