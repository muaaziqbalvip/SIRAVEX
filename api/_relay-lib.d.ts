export function blockedHost(rawUrl: string): string | null;
export function hasPlayableHlsEntries(text: string): boolean;
export function relayLink(absUrl: string, base: string, ref?: string, seg?: boolean, extraQuery?: string): string;
export function rewriteHlsManifest(text: string, manifestUrl: string, base: string, ref?: string, extraQuery?: string): string;
export function rewriteDashMpd(text: string, mpdUrl: string, base: string, ref?: string, extraQuery?: string): string;
