import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, Card } from '@/components/ui/ui';
import { detectCapabilities } from '@/playback/capabilities/capabilities';
import { APP_VERSION, APP_BUILD } from '@/lib/version';
import { estimateStorage } from '@/services/storage/db';

export function DiagnosticsPage() {
  const { diagnostics, playlists, items, programmes, toast } = useStore();
  const [caps] = useState(() => { try { return detectCapabilities(); } catch { return null; } });
  const [swStatus, setSwStatus] = useState('checking…');
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({});
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then((r) => setSwStatus(r ? `registered (scope ${r.scope})` : 'not registered (expected in dev / non-HTTPS)')).catch(() => setSwStatus('registration check failed'));
    else setSwStatus('not supported in this browser');
    void estimateStorage().then(setStorage);
  }, []);
  const report = [
    `SIRAVEX diagnostics — ${new Date().toISOString()}`,
    `App version: ${APP_VERSION} (build ${APP_BUILD})`,
    `User agent: ${navigator.userAgent}`,
    `Online: ${navigator.onLine}`,
    `Capabilities: ${JSON.stringify(caps)}`,
    `Service worker: ${swStatus}`,
    `Storage: usage=${storage.usage ?? 'n/a'} quota=${storage.quota ?? 'n/a'}`,
    `Playlists: ${playlists.length} · Items: ${items.length} · EPG programmes: ${programmes.length}`,
    'Recent sanitized errors (category + message + host only, never full URLs or credentials):',
    ...diagnostics.slice(0, 20).map((d) => `- [${new Date(d.at).toISOString()}] ${d.category}: ${d.message} host=${d.urlHost ?? 'n/a'}`),
  ].join('\n');
  return (
    <div className="mx-auto max-w-4xl"><h1 className="mb-1 text-2xl font-extrabold">Diagnostics</h1><p className="mb-5 text-sm text-muted">Sanitized by design. This page never shows passwords, tokens or complete private stream URLs.</p>
      <Card className="mb-4"><h2 className="mb-3 font-bold">Browser capabilities</h2>
        {caps ? <ul className="grid gap-1 text-sm sm:grid-cols-2">{Object.entries(caps).map(([k, v]) => <li key={k} className="flex justify-between rounded-lg bg-panel px-3 py-2"><span>{k}</span><strong className={v ? 'text-emerald-300' : 'text-red-300'}>{v ? 'Yes' : 'No'}</strong></li>)}</ul> : <p className="text-sm text-muted">Capability detection unavailable.</p>}
        <p className="mt-3 text-sm text-muted">Playback engines — HLS: native (Safari) or HLS.js over MSE · DASH: Shaka Player · Direct MP4/WebM: native HTML5. RTSP/RTMP/raw TS are reported as unsupported, never faked.</p>
      </Card>
      <Card className="mb-4"><h2 className="mb-2 font-bold">Service worker & storage</h2><p className="text-sm text-muted">Service worker: {swStatus}</p><p className="mt-1 text-sm text-muted">Storage estimate: {storage.usage !== undefined ? `${(storage.usage / 1048576).toFixed(2)} MB used` : 'unavailable'} {storage.quota ? `of ${(storage.quota / 1073741824).toFixed(1)} GB` : ''}. Offline keeps the app shell and local data — live streams still need internet.</p></Card>
      <Card className="mb-4"><h2 className="mb-2 font-bold">Sanitized playback error history ({diagnostics.length})</h2>
        {diagnostics.length === 0 ? <p className="text-sm text-muted">No playback errors recorded yet.</p> : <ul className="grid gap-2">{diagnostics.slice(0, 20).map((d) => <li key={d.id} className="rounded-lg bg-panel p-3 text-sm"><strong>{d.category}</strong> — {d.message}<span className="block text-xs text-muted">{new Date(d.at).toLocaleString()} · host: {d.urlHost ?? 'n/a'}</span></li>)}</ul>}
      </Card>
      <Card><h2 className="mb-2 font-bold">Copy diagnostics report</h2><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-ink p-3 text-xs leading-5 text-muted">{report}</pre><Button className="mt-3" onClick={async () => { try { await navigator.clipboard.writeText(report); toast({ tone: 'success', title: 'Diagnostics copied', body: 'Secrets and full URLs are excluded.' }); } catch { toast({ tone: 'error', title: 'Copy failed', body: 'Clipboard is unavailable in this browser context.' }); } }}><Copy size={17} aria-hidden />Copy report</Button></Card>
    </div>
  );
}
