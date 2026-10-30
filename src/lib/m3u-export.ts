import type { AppSettings, MediaItem, VideoPicturePreset } from '@/types/models';

export const VIDEO_PICTURE_PRESETS: Record<
  Exclude<VideoPicturePreset, 'custom'>,
  { label: string; sub: string; brightness: number; contrast: number; saturation: number }
> = {
  standard: { label: 'Standard', sub: 'Original broadcast accurate colors', brightness: 100, contrast: 100, saturation: 100 },
  cinema: { label: 'Cinema Warm', sub: 'Deep contrast & rich film tone', brightness: 97, contrast: 112, saturation: 108 },
  vivid: { label: 'Vivid Sports', sub: 'Crisp stadium grass & bright highlights', brightness: 105, contrast: 115, saturation: 128 },
  night: { label: 'Night Comfort', sub: 'Softened glare for dark-room viewing', brightness: 86, contrast: 95, saturation: 92 },
};

export const VIDEO_PICTURE_PRESET_LIST = (
  Object.entries(VIDEO_PICTURE_PRESETS) as [
    Exclude<VideoPicturePreset, 'custom'>,
    (typeof VIDEO_PICTURE_PRESETS)['standard'],
  ][]
).map(([id, cfg]) => ({ id, ...cfg }));

export function buildVideoFilterCss(
  s: Pick<AppSettings, 'videoPreset' | 'videoBrightness' | 'videoContrast' | 'videoSaturation'>,
): string | undefined {
  const vals =
    s.videoPreset !== 'custom' && VIDEO_PICTURE_PRESETS[s.videoPreset]
      ? VIDEO_PICTURE_PRESETS[s.videoPreset]
      : { brightness: s.videoBrightness, contrast: s.videoContrast, saturation: s.videoSaturation };

  const b = Math.min(160, Math.max(50, vals.brightness || 100));
  const c = Math.min(160, Math.max(50, vals.contrast || 100));
  const sat = Math.min(200, Math.max(0, vals.saturation ?? 100));
  if (b === 100 && c === 100 && sat === 100) return undefined;
  return `brightness(${b}%) contrast(${c}%) saturate(${sat}%)`;
}

function escapeM3uAttr(v: string): string {
  return v.replace(/"/g, "'").replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Exports MediaItem[] (e.g. curated Favourites or filtered channels) into a clean,
 * standards-compliant `#EXTM3U` playlist preserving logos, groups, EPG IDs, and KODIPROP hints.
 */
export function buildM3uPlaylist(items: MediaItem[], playlistTitle = 'SIRAVEX Curated Playlist'): string {
  const lines: string[] = [`#EXTM3U x-tvg-url="" # ${playlistTitle.replace(/[\r\n]+/g, ' ')}`];
  for (const it of items) {
    if (!it.url) continue;
    if (it.forcedFormat === 'dash') {
      lines.push('#KODIPROP:inputstream.adaptive.manifest_type=mpd');
    } else if (it.forcedFormat === 'hls') {
      lines.push('#KODIPROP:inputstream.adaptive.manifest_type=hls');
    }
    if (it.drmClearKeys && Object.keys(it.drmClearKeys).length > 0) {
      const pairs = Object.entries(it.drmClearKeys)
        .map(([k, v]) => `${k}:${v}`)
        .join(',');
      lines.push('#KODIPROP:inputstream.adaptive.license_type=org.w3.clearkey');
      lines.push(`#KODIPROP:inputstream.adaptive.license_key=${pairs}`);
    } else if (it.drmLicenseUrl) {
      lines.push('#KODIPROP:inputstream.adaptive.license_type=com.widevine.alpha');
      lines.push(`#KODIPROP:inputstream.adaptive.license_key=${it.drmLicenseUrl}`);
    }
    if (it.referrer) {
      lines.push(`#EXTVLCOPT:http-referrer=${it.referrer}`);
    }

    const attrs: string[] = [];
    if (it.tvgId) attrs.push(`tvg-id="${escapeM3uAttr(it.tvgId)}"`);
    const logo = it.logo || it.poster;
    if (logo) attrs.push(`tvg-logo="${escapeM3uAttr(logo)}"`);
    if (it.group) attrs.push(`group-title="${escapeM3uAttr(it.group)}"`);
    const attrStr = attrs.length ? ` ${attrs.join(' ')}` : '';
    const cleanName = it.title.replace(/[\r\n]+/g, ' ').trim() || 'Untitled';
    lines.push(`#EXTINF:-1${attrStr},${cleanName}`);
    lines.push(it.url);
  }
  return `${lines.join('\n')}\n`;
}

export function downloadM3u(itemsOrContent: MediaItem[] | string, filename = 'siravex-favourites.m3u'): void {
  const content = Array.isArray(itemsOrContent)
    ? buildM3uPlaylist(itemsOrContent, filename.replace(/\.(m3u8?)$/i, ''))
    : itemsOrContent;
  const blob = new Blob([content], { type: 'audio/x-mpegurl;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.m3u') || filename.endsWith('.m3u8') ? filename : `${filename}.m3u`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
