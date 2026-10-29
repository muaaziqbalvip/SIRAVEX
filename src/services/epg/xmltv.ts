import type { EpgProgramme } from '@/types/models';

/** Parse XMLTV datetime: YYYYMMDDHHmmss + optional timezone offset. Returns epoch ms or null. */
export function parseXmltvTime(raw: string): number | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec, tz] = m;
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec || '0'));
  if (Number.isNaN(base)) return null;
  if (!tz) return base; // treat as UTC when no offset supplied
  const sign = tz[0] === '-' ? 1 : -1;
  const off = (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))) * 60000;
  return base + sign * off;
}

export interface XmltvResult { programmes: Omit<EpgProgramme, 'id'>[]; channelIds: string[]; warnings: string[] }

/** DOMParser-based XMLTV parsing. Text content only — provider HTML is never rendered. */
export function parseXmltv(xml: string): XmltvResult {
  const warnings: string[] = [];
  const programmes: XmltvResult['programmes'] = [];
  const channelIds: string[] = [];
  if (!xml || !xml.trim()) return { programmes, channelIds, warnings: ['EPG file is empty.'] };
  if (xml.length > 25 * 1024 * 1024) return { programmes, channelIds, warnings: ['EPG file exceeds the 25 MB safety limit.'] };
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return { programmes, channelIds, warnings: ['Invalid XML: the EPG file could not be parsed.'] };
  doc.querySelectorAll('channel').forEach((c) => { const id = c.getAttribute('id'); if (id) channelIds.push(id); });
  doc.querySelectorAll('programme').forEach((p, idx) => {
    const channelId = p.getAttribute('channel') || '';
    const start = p.getAttribute('start') ? parseXmltvTime(p.getAttribute('start') as string) : null;
    const end = p.getAttribute('stop') ? parseXmltvTime(p.getAttribute('stop') as string) : null;
    const title = p.querySelector('title')?.textContent?.trim() || '';
    if (!channelId || start === null || end === null || !title) { if (idx < 5000) warnings.push(`Programme #${idx + 1} skipped: missing channel, title or valid times.`); return; }
    programmes.push({ channelId, title, description: p.querySelector('desc')?.textContent?.trim() || undefined, start, end });
  });
  return { programmes, channelIds, warnings: warnings.slice(0, 50) };
}

export function nowAndNext(programmes: EpgProgramme[], channelId: string, at = Date.now()): { current?: EpgProgramme; next?: EpgProgramme } {
  const list = programmes.filter((p) => p.channelId === channelId).sort((a, b) => a.start - b.start);
  const current = list.find((p) => at >= p.start && at < p.end);
  const next = list.find((p) => p.start > (current ? current.start : at));
  return { current, next };
}
