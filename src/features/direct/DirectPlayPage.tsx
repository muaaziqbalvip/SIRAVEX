import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Radio } from 'lucide-react';
import { Button, Card, Input, Select } from '@/components/ui/ui';
import { PlayerShell } from '@/playback/components/PlayerShell';
import { formatOf } from '@/playback/capabilities/capabilities';
import { redactUrl, sanitizeUrl } from '@/lib/security';
import type { MediaItem } from '@/types/models';
import type { LoadOptions } from '@/playback/engine';

const RECENT_KEY = 'siravex-direct-links';
const FORMATS = [
  ['auto', 'Auto-Detect'], ['hls', 'HLS (.m3u8)'], ['dash', 'DASH (.mpd)'], ['mpegts', 'MPEG-TS (.ts)'], ['flv', 'FLV (.flv)'], ['native', 'MP4 / WebM / MKV'],
] as const;

export function DirectPlayPage() {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<string>('auto');
  const [clearKey, setClearKey] = useState('');
  const [licenseUrl, setLicenseUrl] = useState('');
  const [playing, setPlaying] = useState<{ url: string; opts: LoadOptions; at: number } | null>(null);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[]; } catch { return []; } });
  const detected = useMemo(() => (url.trim() ? formatOf(url.trim(), format) : null), [url, format]);

  const play = (raw?: string) => {
    const target = (raw ?? url).trim();
    const clean = sanitizeUrl(target);
    if (!clean) { setError('Valid http(s) stream URL darj karein.'); return; }
    setError('');
    let opts: LoadOptions = { forcedFormat: format };
    if (clearKey.trim()) {
      const [kid, key] = clearKey.split(':').map((s) => s.trim());
      if (!kid || !key) { setError('ClearKey format ghalat hai — kid:key (hex) likhein.'); return; }
      opts = { ...opts, clearKeys: { [kid]: key } };
    }
    if (licenseUrl.trim()) {
      if (!sanitizeUrl(licenseUrl.trim())) { setError('License URL valid nahi hai.'); return; }
      opts = { ...opts, licenseUrl: licenseUrl.trim() };
    }
    const next = [clean, ...recent.filter((r) => r !== clean)].slice(0, 6);
    setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setPlaying({ url: clean, opts, at: Date.now() });
  };

  const item: MediaItem | null = playing ? { id: `direct:${playing.at}`, playlistId: 'direct', kind: 'live', title: 'Direct Stream', url: playing.url, group: 'Play Any Stream' } : null;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <img src="/icons/logo-256.png" alt="" width={46} height={46} className="h-[46px] w-[46px] rounded-xl shadow-glow" />
        <div><h1 className="text-xl font-extrabold sm:text-2xl">Play Any Stream</h1><p className="text-sm text-muted">Universal Media Engine — koi bhi authorized stream link chalayein.</p></div>
      </div>

      <Card className="mb-4">
        <label className="block text-sm font-semibold">Stream URL
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/stream.m3u8 · .mpd · .ts · .flv · .mp4" inputMode="url" className="mt-1.5" aria-describedby="fmt-note" />
        </label>
        <p id="fmt-note" className="mt-1.5 text-xs text-muted" role="status">
          {detected ? <>Detected: <strong className="text-cyanx">{detected.toUpperCase()}</strong> — auth-token wale links (…/render.mpd?auth=…&q=auto) bhi pathname se pehchane jate hain.</> : 'Format URL ke pathname se detect hota hai; token/query isay kharab nahi karta.'}
        </p>
        <div className="chips-row -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Format">
          {FORMATS.map(([v, label]) => <button key={v} type="button" onClick={() => setFormat(v)} aria-pressed={format === v} className={`min-h-[38px] shrink-0 rounded-full px-3.5 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${format === v ? 'bg-sky-500 text-white shadow-glow' : 'border border-border bg-panel text-silver/85'}`}>{label}</button>)}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-silver">Advanced — DASH DRM (sirf apne provider ki di hui keys)</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block text-xs text-muted">ClearKey (kid:key hex)<Input value={clearKey} onChange={(e) => setClearKey(e.target.value)} placeholder="kid:key" autoComplete="off" className="mt-1" /></label>
            <label className="block text-xs text-muted">Widevine license URL<Input value={licenseUrl} onChange={(e) => setLicenseUrl(e.target.value)} placeholder="https://license.example/…" autoComplete="off" className="mt-1" /></label>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-muted">Ye sirf woh keys configure karta hai jo aap khud dete hain (Shaka EME) — koi DRM bypass ya key extraction nahi hota.</p>
        </details>
        {error && <p className="mt-3 rounded-xl bg-red-950/50 p-3 text-sm text-red-200" role="alert">{error}</p>}
        <Button className="mt-4 w-full sm:w-auto" onClick={() => play()} disabled={!url.trim()}><Play size={18} aria-hidden />Play Stream</Button>
        {recent.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Recent (host sirf — tokens kabhi nahi dikhte)</p>
            <div className="flex flex-wrap gap-1.5">{recent.map((r) => <button key={r} type="button" onClick={() => { setUrl(r); play(r); }} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-border bg-panel px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Radio size={13} aria-hidden />{redactUrl(r)}</button>)}</div>
          </div>
        )}
      </Card>

      {item && playing ? (
        <div key={playing.at}><PlayerShell item={item} loadOpts={playing.opts} />
          <p className="mt-3 text-xs leading-5 text-muted">Source host: <strong className="text-silver">{redactUrl(playing.url)}</strong> · Poora private link kahin save/log nahi hua. Agar format ghalat detect ho to upar se format chip badal kar dobara Play karein.</p>
        </div>
      ) : (
        <Card className="grid place-items-center py-12 text-center">
          <img src="/icons/logo-256.png" alt="" width={64} height={64} className="h-16 w-16 rounded-2xl opacity-90" />
          <p className="mt-3 max-w-md text-sm leading-6 text-muted">Upar stream URL paste karein — HLS, DASH (token wale <em>render.mpd</em> links bhi), MPEG-TS, FLV aur MP4/WebM yahin chalenge. Playlist wala content <Link to="/playlists" className="font-semibold text-cyanx hover:underline">Playlists</Link> se add karein.</p>
        </Card>
      )}
    </div>
  );
}
