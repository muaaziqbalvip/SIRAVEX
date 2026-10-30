import { describe, expect, it } from 'vitest';
import { formatBitrate } from '@/lib/clearkey';
import {
  buildDashAudioOptions,
  buildDashQualityOptions,
  buildHlsAudioOptions,
  buildHlsQualityOptions,
  formatShortQuality,
  friendlyAudioCodec,
  friendlyVideoCodec,
  humanLanguageName,
  languageMatches,
  normalizeLangCode,
  resolutionTierBadge,
} from './tracks';

describe('ISO-639 language normalization & matching', () => {
  it('maps 3-letter ISO-639-2/B/T codes and names to 2-letter codes', () => {
    expect(normalizeLangCode('urd')).toBe('ur');
    expect(normalizeLangCode('hin')).toBe('hi');
    expect(normalizeLangCode('eng-US')).toBe('en');
    expect(normalizeLangCode('pan')).toBe('pa');
    expect(normalizeLangCode('ger')).toBe('de');
    expect(normalizeLangCode('und')).toBe('');
  });

  it('produces readable language names', () => {
    expect(humanLanguageName('ur')).toBe('Urdu');
    expect(humanLanguageName('hin')).toBe('Hindi');
    expect(humanLanguageName('ara')).toBe('Arabic');
  });

  it('matches user language preference against ISO codes and free-form labels', () => {
    expect(languageMatches({ lang: 'urd', label: 'Track 1' }, 'ur')).toBe(true);
    expect(languageMatches({ lang: 'und', label: 'Audio 2 - Hindi Stereo' }, 'hi')).toBe(true);
    expect(languageMatches({ lang: 'urd', label: 'Urdu' }, 'en')).toBe(false);
  });
});

describe('codec, bitrate & resolution helpers', () => {
  it('describes video and audio codecs cleanly', () => {
    expect(friendlyVideoCodec('avc1.640028')).toBe('H.264');
    expect(friendlyVideoCodec('hvc1.1.6.L120.90')).toBe('HEVC');
    expect(friendlyVideoCodec('av01.0.08M.08')).toBe('AV1');
    expect(friendlyAudioCodec('mp4a.40.2')).toBe('AAC');
    expect(friendlyAudioCodec('ec-3')).toBe('Dolby E-AC3');
    expect(friendlyAudioCodec('ac-3')).toBe('Dolby AC-3');
  });

  it('formats bitrates and resolution tiers', () => {
    expect(formatBitrate(4_500_000)).toBe('4.5 Mbps');
    expect(formatBitrate(320_000)).toBe('320 kbps');
    expect(resolutionTierBadge(2160)).toBe('4K');
    expect(resolutionTierBadge(1080)).toBe('FHD');
    expect(resolutionTierBadge(720)).toBe('HD');
    expect(formatShortQuality(1080, 4_200_000)).toBe('1080p');
  });
});

describe('HLS quality & audio track builders', () => {
  it('sorts HLS levels descending by height/bitrate while preserving original level indices', () => {
    const qualities = buildHlsQualityOptions([
      { height: 480, width: 854, bitrate: 1_100_000, videoCodec: 'avc1.4d401f' },
      { height: 1080, width: 1920, bitrate: 3_500_000, videoCodec: 'avc1.640028', frameRate: 25 },
      { height: 1080, width: 1920, bitrate: 5_200_000, videoCodec: 'avc1.640028', frameRate: 50 },
      { height: 720, width: 1280, bitrate: 2_400_000, videoCodec: 'avc1.4d401f', frameRate: 50 },
    ]);
    expect(qualities.map((q) => q.id)).toEqual(['auto', '2', '1', '3', '0']);
    expect(qualities[1].shortLabel).toBe('1080p');
    expect(qualities[1].sub).toContain('1920×1080');
    expect(qualities[1].sub).toContain('50fps');
    expect(qualities[1].sub).toContain('H.264');
  });

  it('builds HLS audio tracks from allAudioTracks before active group populates and dedupes across groups', () => {
    const tracks = buildHlsAudioOptions(
      [], // audioTracks is empty right at MANIFEST_PARSED before level loads!
      [
        { id: 0, name: 'Urdu', lang: 'urd', groupId: 'audio-high', audioCodec: 'mp4a.40.2', channels: '2' },
        { id: 1, name: 'English', lang: 'eng', groupId: 'audio-high', audioCodec: 'mp4a.40.2', channels: '6' },
        { id: 2, name: 'Urdu', lang: 'urd', groupId: 'audio-low', audioCodec: 'mp4a.40.2', channels: '2' },
      ],
      () => true,
    );
    expect(tracks).toHaveLength(2);
    expect(tracks[0].label).toContain('Urdu');
    expect(tracks[0].sub).toContain('AAC');
    expect(tracks[0].sub).toContain('Stereo');
    expect(tracks[1].label).toContain('English');
    expect(tracks[1].sub).toContain('5.1ch');
  });
});

describe('Shaka DASH quality & audio track builders', () => {
  it('dedupes Shaka video tracks across multi-audio variants and sorts highest to lowest', () => {
    const qualities = buildDashQualityOptions([
      { width: 1280, height: 720, bandwidth: 2_500_000, frameRate: 30, codecs: 'avc1.4d401f' },
      { width: 1280, height: 720, bandwidth: 2_500_000, frameRate: 30, codecs: 'avc1.4d401f' },
      { width: 1920, height: 1080, bandwidth: 5_000_000, frameRate: 60, codecs: 'avc1.64002a' },
      { width: 640, height: 360, bandwidth: 700_000, frameRate: 30, codecs: 'avc1.42c01e' },
    ]);
    expect(qualities.map((q) => q.id)).toEqual(['auto', 'vt-2', 'vt-0', 'vt-3']);
    expect(qualities[1].shortLabel).toBe('1080p');
  });

  it('preserves distinct Shaka audio tracks even when multiple tracks share und language', () => {
    const res = buildDashAudioOptions(
      [
        { language: 'und', label: 'Stadium FX', codecs: 'mp4a.40.2', channelsCount: 2, active: true },
        { language: 'und', label: 'Commentary', codecs: 'ec-3', channelsCount: 6, active: false },
        { language: 'urd', label: 'Urdu', codecs: 'mp4a.40.2', channelsCount: 2, active: false },
      ],
      [],
      () => true,
    );
    expect(res.options).toHaveLength(3);
    expect(res.options.map((t) => t.id)).toEqual(['sa-0', 'sa-1', 'sa-2']);
    expect(res.activeId).toBe('sa-0');
    expect(res.options[0].label).toContain('Stadium FX');
    expect(res.options[1].label).toContain('Commentary');
    expect(res.options[2].label).toContain('Urdu');
  });
});
