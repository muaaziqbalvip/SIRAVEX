import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, Radio } from 'lucide-react';
import { Button, Card, Input } from '@/components/ui/ui';
import { PlayerShell } from '@/playback/components/PlayerShell';
import { MzAdSlot } from '@/components/ads/MzAdSlot';
import { formatOf } from '@/playback/capabilities/capabilities';
import { redactUrl, sanitizeUrl } from '@/lib/security';
import { parseClearKeys } from '@/lib/clearkey';
import type { MediaItem } from '@/types/models';
import type { LoadOptions } from '@/playback/engine';

const RECENT_KEY = 'siravex-direct-links';
const FORMATS = [
  ['auto', 'Auto-Detect'],
  ['hls', 'HLS (.m3u8)'],
  ['dash', 'DASH (.mpd)'],
  ['mpegts', 'MPEG-TS (.ts)'],
  ['flv', 'FLV (.flv)'],
  ['native', 'MP4 / WebM / MKV'],
] as const;

export function DirectPlayPage() {
  const [url, setUrl] = useState(() => {
    try { return sessionStorage.getItem('siravex-direct-prefill') ?? ''; } catch { return ''; }
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem('siravex-direct-prefill');
      localStorage.removeItem(RECENT_KEY);
    } catch { /* ignore */ }
  }, []);
  const [format, setFormat] = useState<string>('auto');
  const [clearKey, setClearKey] = useState('');
  const [licenseUrl, setLicenseUrl] = useState('');
  const [referrer, setReferrer] = useState('');
  const [playing, setPlaying] = useState<{ url: string; opts: LoadOptions; at: number } | null>(null);
  const [error, setError] = useState('');
  // Recents SIRF is session ki memory mein — token wale private links disk par kabhi save nahi hote.
  const [recent, setRecent] = useState<string[]>([]);
  const detected = useMemo(() => (url.trim() ? formatOf(url.trim(), format) : null), [url, format]);

  const play = (raw?: string) => {
    const target = (raw ?? url).trim();
    const clean = sanitizeUrl(target);
    if (!clean) { setError('Valid http(s) stream URL darj karein.'); return; }
    setError('');
    let opts: LoadOptions = { forcedFormat: format, autoplay: true };
    if (clearKey.trim()) {
      const parsed = parseClearKeys(clearKey);
      if (!parsed) {
        setError('ClearKey samajh nahi aya — kid:key (hex), {"kid":"key"} JSON, ya JWK keys format use karein.');
        return;
      }
      opts = { ...opts, clearKeys: parsed };
    }
    if (licenseUrl.trim()) {
      if (!sanitizeUrl(licenseUrl.trim())) { setError('License URL valid nahi hai.'); return; }
      opts = { ...opts, licenseUrl: licenseUrl.trim() };
    }
    if (referrer.trim()) {
      if (!sanitizeUrl(referrer.trim())) { setError('HTTP Referer URL valid nahi hai.'); return; }
      opts = { ...opts, referrer: referrer.trim() };
    }
    setRecent((prev) => [clean, ...prev.filter((r) => r !== clean)].slice(0, 6));
    setPlaying({ url: clean, opts, at: Date.now() });
  };

  const activeFormat = playing ? formatOf(playing.url, playing.opts.forcedFormat) : null;
  const item: MediaItem | null = playing
    ? {
        id: `direct:${playing.at}`,
        playlistId: 'direct',
        kind: activeFormat === 'native' ? 'movie' : 'live',
        title: 'Direct Stream',
        url: playing.url,
        group: 'Play Any Stream',
      }
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <img src="/icons/logo-256.png" alt="" width={46} height={46} className="h-[46px] w-[46px] rounded-xl shadow-glow" />
        <div>
          <h1 className="text-xl font-extrabold sm:text-2xl">Play Any Stream</h1>
          <p className="text-sm text-muted">
            Universal HTTP + HTTPS Media Engine — <code>http://</code> (:8080 / Xtream) aur <code>https://</code> dono links auto-bridge ke sath chalayein.
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <label className="block text-sm font-semibold">
          Stream URL (HTTP or HTTPS)
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) { e.preventDefault(); play(); } }}
            placeholder="http://panel:8080/live/u/p/101.m3u8 · https://…/stream.mpd · .ts · .mp4"
            inputMode="url"
            className="mt-1.5"
            aria-describedby="fmt-note"
          />
        </label>
        <p id="fmt-note" className="mt-1.5 text-xs text-muted" role="status">
          {detected ? (
            <>Detected: <strong className="text-cyanx">{detected.toUpperCase()}</strong> — auth-token wale links (…/render.mpd?auth=…&amp;q=auto) aur inline <code>?ck=kid:key</code> bhi automatically pehchane jate hain.</>
          ) : (
            'Format URL ke pathname aur query hints se detect hota hai; token/query isay kharab nahi karta.'
          )}
        </p>
        <div className="chips-row -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Format">
          {FORMATS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setFormat(v)}
              aria-pressed={format === v}
              className={`min-h-[38px] shrink-0 rounded-full px-3.5 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${format === v ? 'bg-sky-500 text-white shadow-glow' : 'border border-border bg-panel text-silver/85'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-silver">Advanced — DASH DRM &amp; HTTP Referer (sirf apne provider ki di hui settings)</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="block text-xs text-muted">
              ClearKey (kid:key · JSON · JWK)
              <Input value={clearKey} onChange={(e) => setClearKey(e.target.value)} placeholder="kid:key" autoComplete="off" className="mt-1" />
            </label>
            <label className="block text-xs text-muted">
              Widevine license URL
              <Input value={licenseUrl} onChange={(e) => setLicenseUrl(e.target.value)} placeholder="https://license.example/…" autoComplete="off" className="mt-1" />
            </label>
            <label className="block text-xs text-muted">
              HTTP Referer (relay fallback)
              <Input value={referrer} onChange={(e) => setReferrer(e.target.value)} placeholder="https://provider.example/" autoComplete="off" className="mt-1" />
            </label>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-muted">
            Ye sirf woh keys aur headers configure karta hai jo aap khud dete hain (Shaka EME / Relay) — koi DRM bypass ya key extraction nahi hota.
          </p>
        </details>
        {error && <p className="mt-3 rounded-xl bg-red-950/50 p-3 text-sm text-red-200" role="alert">{error}</p>}
        <Button className="mt-4 w-full sm:w-auto" onClick={() => play()} disabled={!url.trim()}>
          <Play size={18} aria-hidden />Play Stream
        </Button>
        {recent.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Recent — sirf is session ke liye (host dikhta hai, tokens kabhi save nahi hote)</p>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setUrl(r); play(r); }}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-border bg-panel px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"
                >
                  <Radio size={13} aria-hidden />{redactUrl(r)}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {item && playing ? (
        <div>
          <PlayerShell item={item} loadOpts={playing.opts} />
          <MzAdSlot slot="banner" placement="player" className="mt-4" />
          <p className="mt-3 text-xs leading-5 text-muted">
            Source host: <strong className="text-silver">{redactUrl(playing.url)}</strong> · Poora private link kahin save/log nahi hua. Agar format ghalat detect ho to upar se format chip badal kar dobara Play karein.
          </p>
        </div>
      ) : (
        <Card className="grid place-items-center py-12 text-center">
          <img src="/icons/logo-256.png" alt="" width={64} height={64} className="h-16 w-16 rounded-2xl opacity-90" />
          <p className="mt-3 max-w-md text-sm leading-6 text-muted">
            Upar stream URL paste karein — HLS, DASH (token wale <em>render.mpd</em> links bhi), MPEG-TS, FLV aur MP4/WebM yahin chalenge. Playlist wala content{' '}
            <Link to="/playlists" className="font-semibold text-cyanx hover:underline">Playlists</Link> se add karein.
          </p>
        </Card>
      )}
    </div>
  );
}
