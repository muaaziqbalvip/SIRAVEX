import { formatBitrate } from '@/lib/clearkey';

export interface TrackOption {
  id: string;
  label: string;
  sub?: string;
  lang?: string;
  supported?: boolean;
  groupId?: string;
  codec?: string;
  channels?: number;
}

export interface QualityOption {
  id: string;
  label: string;
  shortLabel: string;
  sub?: string;
  height?: number;
  width?: number;
  bitrate?: number;
  fps?: number;
  codec?: string;
}

const ISO3_TO_ISO1: Record<string, string> = {
  urd: 'ur', hin: 'hi', eng: 'en', ara: 'ar', pan: 'pa', pnb: 'pa',
  tur: 'tr', spa: 'es', fra: 'fr', fre: 'fr', per: 'fa', fas: 'fa',
  pus: 'ps', ben: 'bn', tam: 'ta', tel: 'te', mal: 'ml', mar: 'mr',
  guj: 'gu', kan: 'kn', sin: 'si', nep: 'ne', ind: 'id', msa: 'ms',
  may: 'ms', deu: 'de', ger: 'de', ita: 'it', por: 'pt', rus: 'ru',
  zho: 'zh', chi: 'zh', jpn: 'ja', kor: 'ko', tha: 'th', vie: 'vi',
  pol: 'pl', nld: 'nl', dut: 'nl', ukr: 'uk', ron: 'ro', rum: 'ro',
};

const LANG_NAME_FALLBACK: Record<string, string> = {
  ur: 'Urdu', hi: 'Hindi', en: 'English', ar: 'Arabic', pa: 'Punjabi',
  tr: 'Turkish', es: 'Spanish', fr: 'French', fa: 'Persian', ps: 'Pashto',
  bn: 'Bengali', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', mr: 'Marathi',
  gu: 'Gujarati', de: 'German', it: 'Italian', pt: 'Portuguese', ru: 'Russian',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', id: 'Indonesian', ms: 'Malay',
};

export function normalizeLangCode(raw?: string | null): string {
  if (!raw) return '';
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  if (!base || base === 'und' || base === 'unk' || base === 'mul' || base === 'zxx') return '';
  return ISO3_TO_ISO1[base] ?? base;
}

export function humanLanguageName(code?: string | null): string {
  const norm = normalizeLangCode(code);
  if (!norm) return '';
  if (LANG_NAME_FALLBACK[norm]) return LANG_NAME_FALLBACK[norm];
  try {
    const out = new Intl.DisplayNames(['en'], { type: 'language' }).of(norm);
    if (out && out.toLowerCase() !== norm) return out;
  } catch { /* fallback below */ }
  return norm.toUpperCase();
}

export function languageMatches(track: { lang?: string | null; label?: string | null }, preferred?: string): boolean {
  const pref = normalizeLangCode(preferred);
  if (!pref) return false;
  const tLang = normalizeLangCode(track.lang);
  if (tLang && tLang === pref) return true;
  const fullName = LANG_NAME_FALLBACK[pref]?.toLowerCase();
  if (fullName && track.label && new RegExp(`\\b${fullName}\\b`, 'i').test(track.label)) return true;
  return false;
}

export function isAudioCodecSupported(
  codec?: string | null,
  customCheck?: (mime: string) => boolean,
): boolean {
  if (!codec) return true;
  const c = codec.trim();
  if (!c) return true;
  const check = customCheck ?? ((mime: string) => {
    try {
      const win = typeof window !== 'undefined'
        ? (window as unknown as { MediaSource?: { isTypeSupported?: (m: string) => boolean }; ManagedMediaSource?: { isTypeSupported?: (m: string) => boolean } })
        : {};
      const ms = win.MediaSource ?? win.ManagedMediaSource ?? (typeof MediaSource !== 'undefined' ? MediaSource : undefined);
      if (!ms || typeof ms.isTypeSupported !== 'function') return true;
      return ms.isTypeSupported(mime);
    } catch { return true; }
  });
  const lower = c.toLowerCase();
  if (lower === 'opus' || lower === 'vorbis') {
    return check(`audio/webm; codecs="${c}"`) || check(`audio/mp4; codecs="${c}"`);
  }
  return check(`audio/mp4; codecs="${c}"`);
}

export function friendlyAudioCodec(codec?: string | null): string {
  if (!codec) return '';
  const c = codec.toLowerCase();
  if (c.startsWith('mp4a.40')) return 'AAC';
  if (c === 'mp4a.69' || c === 'mp4a.6b' || c === 'mp3') return 'MP3';
  if (c.startsWith('ec-3') || c.startsWith('eac3')) return 'Dolby E-AC3';
  if (c.startsWith('ac-3') || c.startsWith('ac3')) return 'Dolby AC-3';
  if (c.startsWith('ac-4')) return 'Dolby AC-4';
  if (c.includes('opus')) return 'Opus';
  if (c.includes('flac')) return 'FLAC';
  if (c.includes('vorbis')) return 'Vorbis';
  if (c.includes('dts')) return 'DTS';
  return codec.split('.')[0].toUpperCase();
}

export function friendlyVideoCodec(codec?: string | null): string {
  if (!codec) return '';
  const c = codec.toLowerCase();
  if (c.startsWith('avc1') || c.startsWith('avc3')) return 'H.264';
  if (c.startsWith('hev1') || c.startsWith('hvc1')) return 'HEVC';
  if (c.startsWith('av01')) return 'AV1';
  if (c.startsWith('vp09') || c.startsWith('vp9')) return 'VP9';
  if (c.startsWith('dvh1') || c.startsWith('dvhe')) return 'Dolby Vision';
  return '';
}

export function friendlyChannels(raw?: string | number | null): string {
  if (raw === undefined || raw === null || raw === '') return '';
  const str = String(raw).trim();
  if (/joc|atmos/i.test(str)) return 'Atmos';
  const n = parseInt(str, 10);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n === 1) return 'Mono';
  if (n === 2) return 'Stereo';
  if (n === 6) return '5.1ch';
  if (n === 8) return '7.1ch';
  return `${n}ch`;
}

export function resolutionTierBadge(height?: number | null): string {
  if (!height || height <= 0) return '';
  if (height >= 2160) return '4K';
  if (height >= 1440) return 'QHD';
  if (height >= 1080) return 'FHD';
  if (height >= 720) return 'HD';
  if (height >= 480) return 'SD';
  return '';
}

export function formatShortQuality(height?: number | null, bitrate?: number | null, fallbackName?: string | null): string {
  if (height && height > 0) return `${height}p`;
  if (fallbackName && fallbackName.trim()) return fallbackName.trim();
  if (bitrate && bitrate > 0) return formatBitrate(bitrate);
  return 'Auto';
}

export interface RawHlsLevel {
  height?: number;
  width?: number;
  bitrate?: number;
  frameRate?: number;
  videoCodec?: string;
  codecSet?: string;
  name?: string;
  attrs?: Record<string, string | undefined>;
}

/**
 * HLS levels -> sorted (highest to lowest) QualityOption list.
 * Each item's `id` stays the exact `hls.levels` index so `hls.nextLevel` / `hls.currentLevel` maps 1:1.
 */
export function buildHlsQualityOptions(levels: RawHlsLevel[]): QualityOption[] {
  const mapped: (QualityOption & { origIdx: number })[] = [];
  const seenExact = new Set<string>();

  levels.forEach((l, idx) => {
    const height = l.height && l.height > 0 ? l.height : undefined;
    const width = l.width && l.width > 0 ? l.width : undefined;
    const bitrate = l.bitrate && l.bitrate > 0 ? l.bitrate : undefined;
    const fpsRaw = l.frameRate || (l.attrs?.['FRAME-RATE'] ? parseFloat(l.attrs['FRAME-RATE']) : undefined);
    const fps = fpsRaw && Number.isFinite(fpsRaw) && fpsRaw > 0 ? Math.round(fpsRaw) : undefined;
    const vCodec = friendlyVideoCodec(l.videoCodec || l.codecSet || l.attrs?.CODECS);
    const exactKey = `${height ?? 0}:${bitrate ? Math.round(bitrate / 25000) : idx}:${vCodec}`;
    if (seenExact.has(exactKey)) return;
    seenExact.add(exactKey);

    const tier = resolutionTierBadge(height);
    const shortLabel = formatShortQuality(height, bitrate, l.name) || `Level ${idx + 1}`;
    const baseLabel = height ? `${height}p${tier ? ` ${tier}` : ''}` : l.name?.trim() || (bitrate ? formatBitrate(bitrate) : `Level ${idx + 1}`);
    const brText = bitrate ? formatBitrate(bitrate) : '';
    const label = height && brText ? `${baseLabel} · ${brText}` : baseLabel;
    const subParts = [
      width && height ? `${width}×${height}` : '',
      !height && brText ? brText : '',
      fps && fps > 30 ? `${fps}fps` : '',
      vCodec,
    ].filter(Boolean);

    mapped.push({
      id: String(idx),
      origIdx: idx,
      label,
      shortLabel,
      sub: subParts.join(' · ') || undefined,
      height,
      width,
      bitrate,
      fps,
      codec: vCodec || undefined,
    });
  });

  mapped.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0) || a.origIdx - b.origIdx);
  return [{ id: 'auto', label: 'Auto', shortLabel: 'Auto' }, ...mapped.map(({ origIdx: _o, ...rest }) => rest)];
}

export interface RawHlsAudioTrack {
  id?: number;
  name?: string;
  lang?: string;
  groupId?: string;
  audioCodec?: string;
  channels?: string;
  default?: boolean;
  attrs?: Record<string, string | undefined>;
}

/**
 * HLS audio tracks -> clean, disambiguated TrackOption list with browser codec support flags.
 */
export function buildHlsAudioOptions(
  tracksInGroup: RawHlsAudioTrack[],
  allTracks: RawHlsAudioTrack[] = [],
  codecCheck?: (mime: string) => boolean,
): TrackOption[] {
  const source = tracksInGroup.length > 0 ? tracksInGroup : dedupeHlsAllAudio(allTracks);
  const rawNames = source.map((t, i) => {
    const cleanName = (t.name || '').trim();
    const langFull = humanLanguageName(t.lang);
    if (cleanName && !/^audio\s*\d*$/i.test(cleanName) && cleanName.toLowerCase() !== 'und') {
      return langFull && !cleanName.toLowerCase().includes(langFull.toLowerCase()) ? `${cleanName} (${langFull})` : cleanName;
    }
    return langFull || cleanName || `Audio ${i + 1}`;
  });

  const nameCounts = new Map<string, number>();
  for (const n of rawNames) nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  const nameSeen = new Map<string, number>();

  return source.map((t, i) => {
    const codecRaw = t.audioCodec || t.attrs?.CODECS;
    const supported = isAudioCodecSupported(codecRaw, codecCheck);
    const codecLabel = friendlyAudioCodec(codecRaw);
    const chLabel = friendlyChannels(t.channels || t.attrs?.CHANNELS);
    let label = rawNames[i];
    if ((nameCounts.get(label) ?? 0) > 1) {
      const seq = (nameSeen.get(label) ?? 0) + 1;
      nameSeen.set(label, seq);
      const distinguisher = [codecLabel, chLabel].filter(Boolean).join(' ');
      label = distinguisher ? `${label} · ${distinguisher}` : `${label} #${seq}`;
    }
    const subParts = [
      humanLanguageName(t.lang),
      codecLabel,
      chLabel,
      !supported ? 'Browser codec unsupported' : '',
    ].filter(Boolean);
    return {
      id: String(i),
      label,
      sub: subParts.join(' · ') || undefined,
      lang: t.lang,
      supported,
      groupId: t.groupId,
      codec: codecLabel || undefined,
    };
  });
}

function dedupeHlsAllAudio(all: RawHlsAudioTrack[]): RawHlsAudioTrack[] {
  if (all.length <= 1) return all;
  const firstGroup = all[0]?.groupId;
  if (firstGroup) {
    const inFirst = all.filter((t) => t.groupId === firstGroup);
    if (inFirst.length > 0) return inFirst;
  }
  return all;
}

export interface RawShakaVideoTrack {
  active?: boolean;
  bandwidth?: number;
  codecs?: string | null;
  frameRate?: number | null;
  height?: number | null;
  width?: number | null;
  label?: string | null;
}

export interface RawShakaVariant {
  id: number;
  height?: number | null;
  width?: number | null;
  bandwidth?: number;
  frameRate?: number | null;
  codecs?: string | null;
  videoCodec?: string | null;
  active?: boolean;
  audioLanguage?: string;
  audioRoles?: string[] | null;
  audioId?: number | null;
  audioCodec?: string | null;
  channelsCount?: number | null;
  label?: string | null;
}

/**
 * DASH video quality options (sorted high-to-low).
 * Uses `v-<idx>` IDs when built from `player.getVideoTracks()` or `h-<height>-<bw>` for variants.
 */
export function buildDashQualityOptions(
  videoTracks: RawShakaVideoTrack[],
  variants: RawShakaVariant[] = [],
): QualityOption[] {
  const list: QualityOption[] = [];
  if (videoTracks.length > 0) {
    const kept: { idx: number; t: RawShakaVideoTrack }[] = [];
    videoTracks.forEach((t, idx) => {
      const h = t.height ?? 0;
      const bw = t.bandwidth ?? 0;
      const dup = kept.some((k) => (k.t.height ?? 0) === h && Math.abs((k.t.bandwidth ?? 0) - bw) < Math.max(80_000, bw * 0.12));
      if (!dup) kept.push({ idx, t });
    });
    kept.sort((a, b) => (b.t.height ?? 0) - (a.t.height ?? 0) || (b.t.bandwidth ?? 0) - (a.t.bandwidth ?? 0));
    for (const { idx, t } of kept) {
      const height = t.height && t.height > 0 ? t.height : undefined;
      const width = t.width && t.width > 0 ? t.width : undefined;
      const bitrate = t.bandwidth && t.bandwidth > 0 ? t.bandwidth : undefined;
      const fps = t.frameRate && t.frameRate > 0 ? Math.round(t.frameRate) : undefined;
      const vCodec = friendlyVideoCodec(t.codecs);
      const tier = resolutionTierBadge(height);
      const shortLabel = formatShortQuality(height, bitrate, t.label);
      const base = height ? `${height}p${tier ? ` ${tier}` : ''}` : t.label || formatBitrate(bitrate) || `Track ${idx + 1}`;
      const br = bitrate ? formatBitrate(bitrate) : '';
      const subParts = [width && height ? `${width}×${height}` : '', fps && fps > 30 ? `${fps}fps` : '', vCodec].filter(Boolean);
      list.push({
        id: `vt-${idx}`,
        label: height && br ? `${base} · ${br}` : base,
        shortLabel,
        sub: subParts.join(' · ') || undefined,
        height,
        width,
        bitrate,
        fps,
        codec: vCodec || undefined,
      });
    }
    return [{ id: 'auto', label: 'Auto', shortLabel: 'Auto' }, ...list];
  }

  // Fallback for variant-only manifests/mocks
  const keptVar: RawShakaVariant[] = [];
  for (const v of variants) {
    const h = v.height ?? 0;
    const bw = v.bandwidth ?? 0;
    if (!h && !bw) continue;
    const dup = keptVar.some((k) => (k.height ?? 0) === h && Math.abs((k.bandwidth ?? 0) - bw) < Math.max(120_000, bw * 0.15));
    if (!dup) keptVar.push(v);
  }
  keptVar.sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
  for (const v of keptVar) {
    const height = v.height && v.height > 0 ? v.height : undefined;
    const width = v.width && v.width > 0 ? v.width : undefined;
    const bitrate = v.bandwidth && v.bandwidth > 0 ? v.bandwidth : undefined;
    const fps = v.frameRate && v.frameRate > 0 ? Math.round(v.frameRate) : undefined;
    const vCodec = friendlyVideoCodec(v.videoCodec || v.codecs);
    const tier = resolutionTierBadge(height);
    const shortLabel = formatShortQuality(height, bitrate, v.label);
    const base = height ? `${height}p${tier ? ` ${tier}` : ''}` : formatBitrate(bitrate) || `Variant ${v.id}`;
    const br = bitrate ? formatBitrate(bitrate) : '';
    list.push({
      id: height ? `h-${height}-${bitrate ?? 0}` : `var-${v.id}`,
      label: height && br ? `${base} · ${br}` : base,
      shortLabel,
      sub: [width && height ? `${width}×${height}` : '', fps && fps > 30 ? `${fps}fps` : '', vCodec].filter(Boolean).join(' · ') || undefined,
      height,
      width,
      bitrate,
      fps,
      codec: vCodec || undefined,
    });
  }
  return [{ id: 'auto', label: 'Auto', shortLabel: 'Auto' }, ...list];
}

export interface RawShakaAudioTrack {
  active?: boolean;
  label?: string | null;
  language?: string;
  originalLanguage?: string | null;
  roles?: string[];
  codecs?: string | null;
  channelsCount?: number | null;
  primary?: boolean;
  spatialAudio?: boolean;
}

/**
 * DASH audio options — supports Shaka 4.12 `getAudioTracks()` so even streams where
 * multiple tracks share `language: "und"` are listed distinctly and switchable!
 */
export function buildDashAudioOptions(
  audioTracks: RawShakaAudioTrack[],
  fallbackLangRoles: { language: string; role?: string; label?: string }[] = [],
  codecCheck?: (mime: string) => boolean,
): { options: TrackOption[]; activeId: string; activeLabel: string } {
  if (audioTracks.length > 0) {
    const baseLabels = audioTracks.map((t, i) => {
      const lbl = (t.label || '').trim();
      const lang = humanLanguageName(t.originalLanguage || t.language);
      const role = t.roles?.length ? t.roles.join(', ') : '';
      let base = lbl && lbl.toLowerCase() !== 'und' ? (lang && !lbl.toLowerCase().includes(lang.toLowerCase()) ? `${lbl} (${lang})` : lbl) : lang || `Audio ${i + 1}`;
      if (role && !base.toLowerCase().includes(role.toLowerCase())) base = `${base} · ${role}`;
      return base;
    });
    const counts = new Map<string, number>();
    for (const b of baseLabels) counts.set(b, (counts.get(b) ?? 0) + 1);
    const seen = new Map<string, number>();

    let activeId = '';
    let activeLabel = 'Default';
    const options: TrackOption[] = audioTracks.map((t, i) => {
      const codecLabel = friendlyAudioCodec(t.codecs);
      const chLabel = t.spatialAudio ? 'Atmos' : friendlyChannels(t.channelsCount);
      const supported = isAudioCodecSupported(t.codecs, codecCheck);
      let label = baseLabels[i];
      if ((counts.get(label) ?? 0) > 1) {
        const seq = (seen.get(label) ?? 0) + 1;
        seen.set(label, seq);
        const extra = [codecLabel, chLabel].filter(Boolean).join(' ');
        label = extra ? `${label} · ${extra}` : `${label} #${seq}`;
      }
      const id = `sa-${i}`;
      if (t.active) { activeId = id; activeLabel = label; }
      const subParts = [humanLanguageName(t.originalLanguage || t.language), codecLabel, chLabel, !supported ? 'Browser codec unsupported' : ''].filter(Boolean);
      return {
        id,
        label,
        sub: subParts.join(' · ') || undefined,
        lang: t.originalLanguage || t.language,
        supported,
        codec: codecLabel || undefined,
        channels: t.channelsCount ?? undefined,
      };
    });
    if (!activeId && options[0]) { activeId = options[0].id; activeLabel = options[0].label; }
    return { options, activeId, activeLabel };
  }

  // Fallback to language+role pairs
  const seen = new Set<string>();
  const options: TrackOption[] = [];
  for (const l of fallbackLangRoles) {
    const id = `${l.language}|${l.role ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const lang = humanLanguageName(l.language) || l.language || `Audio ${options.length + 1}`;
    options.push({
      id,
      label: l.role ? `${lang} · ${l.role}` : lang,
      lang: l.language,
      supported: true,
    });
  }
  return { options, activeId: options[0]?.id ?? '', activeLabel: options[0]?.label ?? 'Default' };
}
