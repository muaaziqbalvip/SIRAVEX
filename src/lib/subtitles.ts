/** Convert SubRip (.srt) text to WebVTT so the browser can render it as a track. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/^\d+\s*$/gm, '');
  return `WEBVTT\n\n${body.trim()}\n`;
}
export function isSubtitleFile(name: string): boolean { return /\.(srt|vtt)$/i.test(name); }
