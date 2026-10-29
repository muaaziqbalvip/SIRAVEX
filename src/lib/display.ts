/**
 * Provider titles are often stuffed with flags, crowns, [PRO VIP] tags and even
 * WhatsApp numbers. Those break layouts (long unbroken strings overflow cards).
 * Display-only cleaning: stored data is never mutated; details pages can show raw.
 */
export function cleanTitle(raw: string): string {
  if (!raw) return '';
  let t = raw;
  // Drop contact spam: phone numbers, "Contact ...", WhatsApp plugs.
  t = t.replace(/\b(?:whats\s?app|contact|call|order)\b[^•|–-]*/gi, '');
  t = t.replace(/(\+?\d[\d\s-]{8,}\d)/g, '');
  // Bracketed marketing tags: [PRO VIP], [4K], (PRO VIP) keep years though.
  t = t.replace(/\[[^\]]*(?:vip|pro|premium|4k|uhd|fhd|hd|sd|free|paid|coming soon)[^\]]*\]/gi, '');
  t = t.replace(/\((?:pro\s?)?vip\)/gi, '');
  // Leading flag/emoji/symbol clusters.
  t = t.replace(/^[\s\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}★☆👑🎬🎭📰🕌📺🏏🔴•|–-]+/u, '');
  t = t.replace(/\s*[•|]\s*(pro\s?)?vip\b/gi, '');
  t = t.replace(/\s{2,}/g, ' ').replace(/^[\s•|–-]+/, '').trim();
  return t || raw.trim();
}

/** Group/category names get the same treatment so chips stay one-line. */
export function cleanGroup(raw: string): string {
  return cleanTitle(raw).toUpperCase().slice(0, 42) || 'GENERAL';
}
