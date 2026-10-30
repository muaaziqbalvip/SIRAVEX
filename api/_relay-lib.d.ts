export function blockedHost(rawUrl: string): string | null;
export function relayLink(absUrl: string, base: string, ref?: string): string;
export function rewriteHlsManifest(text: string, manifestUrl: string, base: string, ref?: string): string;
export function rewriteDashMpd(text: string, mpdUrl: string, base: string, ref?: string): string;
