import { describe, expect, it } from 'vitest';
import { blockedHost, relayLink, rewriteDashMpd, rewriteHlsManifest } from '../../api/_relay-lib.js';

describe('API Relay SSRF protection & manifest rewriting', () => {
  it('blocks loopback, private IPv4, link-local, metadata, and IPv6/mapped-IPv4 hosts', () => {
    expect(blockedHost('http://127.0.0.1:8080/live.m3u8')).toBeTruthy();
    expect(blockedHost('http://10.0.0.5/live.m3u8')).toBeTruthy();
    expect(blockedHost('http://172.16.5.4/live.m3u8')).toBeTruthy();
    expect(blockedHost('http://192.168.1.10/live.m3u8')).toBeTruthy();
    expect(blockedHost('http://169.254.169.254/latest/meta-data')).toBeTruthy();
    expect(blockedHost('http://[::1]:8080/live.m3u8')).toBeTruthy();
    expect(blockedHost('http://[::ffff:127.0.0.1]/live.m3u8')).toBeTruthy();
    expect(blockedHost('http://[fe80::1]/live.m3u8')).toBeTruthy();
    expect(blockedHost('http://[fc00::1]/live.m3u8')).toBeTruthy();
    expect(blockedHost('http://printer.local/stream')).toBeTruthy();
    expect(blockedHost('file:///etc/passwd')).toBeTruthy();
  });

  it('allows valid public http and https stream URLs', () => {
    expect(blockedHost('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')).toBeNull();
    expect(blockedHost('http://93.184.216.34:8080/live/u/p/123.m3u8')).toBeNull();
  });

  it('rewrites HLS master & media manifests and preserves referrer across nested tracks & segments', () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Urdu",LANGUAGE="ur",URI="audio/ur.m3u8"',
      '#EXT-X-KEY:METHOD=AES-128,URI="keys/k1.key"',
      '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,AUDIO="aud"',
      '720p/index.m3u8',
      '#EXTINF:6.0,',
      'seg-001.ts',
    ].join('\n');

    const out = rewriteHlsManifest(
      manifest,
      'http://cdn.example.com/live/ch1/master.m3u8',
      'https://siravex.vercel.app',
      'https://player.example.com/',
    );

    expect(out).toContain(encodeURIComponent('http://cdn.example.com/live/ch1/audio/ur.m3u8'));
    expect(out).toContain(encodeURIComponent('http://cdn.example.com/live/ch1/keys/k1.key'));
    expect(out).toContain(encodeURIComponent('http://cdn.example.com/live/ch1/720p/index.m3u8'));
    expect(out).toContain(encodeURIComponent('http://cdn.example.com/live/ch1/seg-001.ts'));
    expect(out).toContain(`&ref=${encodeURIComponent('https://player.example.com/')}`);
    expect(out).toContain('&seg=1');

    // Root-relative mode (base = '') avoids proxy http/https Mixed-Content bugs
    const relOut = rewriteHlsManifest(manifest, 'http://cdn.example.com/live/ch1/master.m3u8', '', '');
    expect(relOut).toContain('\n/api/relay?u=');
    expect(relOut).not.toContain('http://localhost/api/relay');
  });

  it('rewrites DASH MPD BaseURL & SegmentTemplate URLs while preserving $Number$ tokens and referrer', () => {
    const mpd = [
      '<?xml version="1.0"?>',
      '<MPD type="dynamic">',
      '  <BaseURL>tracks/</BaseURL>',
      '  <Period id="0">',
      '    <AdaptationSet mimeType="video/mp4">',
      '      <SegmentTemplate initialization="init-$RepresentationID$.mp4" media="seg-$RepresentationID$-$Number$.m4s" />',
      '    </AdaptationSet>',
      '  </Period>',
      '</MPD>',
    ].join('\n');
    const out = rewriteDashMpd(
      mpd,
      'http://cdn.example.com/dash/live/manifest.mpd',
      'https://siravex.vercel.app',
      'https://portal.example.com/',
    );
    expect(out).toContain(encodeURIComponent('http://cdn.example.com/dash/live/tracks/'));
    expect(out).toContain('$RepresentationID$');
    expect(out).toContain('$Number$');
    expect(out).toContain(encodeURIComponent('https://portal.example.com/'));
    expect(relayLink('http://a.example/seg.m4s', 'https://siravex.vercel.app', 'https://r.example/')).toContain('&ref=');
  });
});
