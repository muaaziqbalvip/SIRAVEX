import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '@/app/store';
import { Button, Card, EmptyState, Skeleton } from '@/components/ui/ui';
import { nowAndNext } from '@/services/epg/xmltv';

export function EpgPage() {
  const { ready, items, playlists, programmes, importEpg, refreshXtreamEpg, toast } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [epgPass, setEpgPass] = useState<Record<string, string>>({});
  const xtreamSources = playlists.filter((p) => p.type === 'xtream');
  const fetchFromXtream = async (playlistId: string) => {
    setBusy(true);
    try { const n = await refreshXtreamEpg(playlistId, epgPass[playlistId] || undefined); toast({ tone: 'success', title: `EPG updated: ${n.toLocaleString()} programmes` }); }
    catch (e) { toast({ tone: 'error', title: 'EPG fetch failed', body: e instanceof Error ? e.message : 'Failed' }); }
    finally { setBusy(false); }
  };
  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const live = useMemo(() => items.filter((i) => i.kind === 'live' && enabled.has(i.playlistId)), [items, enabled]);
  const [selectedId, setSelectedId] = useState<string>('');
  const selected = live.find((i) => i.id === selectedId) ?? live[0];
  const schedule = useMemo(() => selected?.tvgId ? programmes.filter((p) => p.channelId === selected.tvgId && p.title.toLowerCase().includes(q.toLowerCase())).sort((a, b) => a.start - b.start).slice(0, 60) : [], [programmes, selected, q]);
  const nn = selected?.tvgId ? nowAndNext(programmes, selected.tvgId) : {};
  if (!ready) return <Skeleton className="h-64" />;
  return (
    <div><div className="mb-4 flex flex-wrap items-center gap-2"><h1 className="mr-auto text-2xl font-extrabold">Programme Guide (EPG)</h1>
      <input ref={fileRef} type="file" accept=".xml,text/xml" className="sr-only" aria-label="Import XMLTV EPG file" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setBusy(true); try { const r = await importEpg(f); toast({ tone: 'success', title: `EPG imported: ${r.count} programmes`, body: r.warnings[0] }); } catch (err) { toast({ tone: 'error', title: 'EPG import failed', body: err instanceof Error ? err.message : 'Invalid EPG file' }); } finally { setBusy(false); } }} />
      <Button onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? 'Importing…' : 'Import XMLTV file'}</Button></div>
      {xtreamSources.length > 0 && (
        <div className="mb-4 grid gap-2">
          {xtreamSources.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-sky-500/40 bg-sky-950/30 p-3">
              <p className="min-w-[200px] flex-1 text-sm"><strong>{p.name}</strong><span className="block text-xs text-muted">Xtream EPG {programmes.filter((x) => x.playlistId === p.id).length.toLocaleString()} programmes{p.lastEpgAt ? ` · updated ${new Date(p.lastEpgAt).toLocaleString()}` : ' · abhi fetch nahi hua'}</span></p>
              {!p.password && <label className="sr-only" htmlFor={`epg-pass-${p.id}`}>Password</label>}
              {!p.password && <input id={`epg-pass-${p.id}`} type="password" value={epgPass[p.id] ?? ''} onChange={(e) => setEpgPass((s) => ({ ...s, [p.id]: e.target.value }))} placeholder="Account password" autoComplete="current-password" className="min-h-[42px] w-44 rounded-xl border border-border bg-ink px-3 text-sm focus:border-sky-400 focus:outline-none" />}
              <Button disabled={busy} onClick={() => void fetchFromXtream(p.id)}>{busy ? 'Fetching…' : 'Fetch EPG from Xtream'}</Button>
            </div>
          ))}
        </div>
      )}
      {programmes.length === 0 ? <EmptyState title="No EPG data yet" body="Xtream users: upar wala button dabayein — guide seedha provider ke xmltv.php se ayega. Ya authorized XMLTV file import karein. Channels tvg-id se match hote hain; koi schedule invent nahi hota." action={<Button onClick={() => fileRef.current?.click()}>Import XMLTV</Button>} /> : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <Card className="max-h-[70vh] overflow-y-auto"><h2 className="mb-2 font-bold">Channels</h2><div className="grid gap-1">{live.map((c) => <button key={c.id} type="button" onClick={() => setSelectedId(c.id)} aria-pressed={selected?.id === c.id} className={`min-h-[44px] rounded-lg px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${selected?.id === c.id ? 'bg-sky-500 text-white' : 'hover:bg-panel'}`}>{c.title}<span className="block text-xs opacity-75">{c.tvgId || 'no tvg-id — cannot match EPG'}</span></button>)}</div></Card>
          <div className="min-w-0">
            {selected && <Card className="mb-3"><h2 className="font-bold">{selected.title}</h2>{nn.current ? <p className="mt-1 text-sm"><span className="text-cyanx font-semibold">Now:</span> {nn.current.title} ({new Date(nn.current.start).toLocaleTimeString()}–{new Date(nn.current.end).toLocaleTimeString()})<span className="mt-2 block h-2 overflow-hidden rounded bg-slate-800"><span className="block h-full bg-sky-400" style={{ width: `${Math.min(100, ((Date.now() - nn.current.start) / (nn.current.end - nn.current.start)) * 100)}%` }} /></span></p> : <p className="mt-1 text-sm text-muted">No current programme in the imported data for this channel right now.</p>}{nn.next && <p className="mt-1 text-sm text-muted">Next: {nn.next.title} at {new Date(nn.next.start).toLocaleTimeString()}</p>}
            <label className="sr-only" htmlFor="epg-q">Search programmes</label><input id="epg-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search programme titles…" className="mt-3 min-h-[44px] w-full rounded-xl border border-border bg-ink px-3 text-sm focus:border-sky-400 focus:outline-none" /></Card>}
            <div className="relative overflow-x-auto rounded-2xl border border-border" role="region" aria-label="Schedule timeline">
              <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-red-400/70" style={{ left: '8px' }} aria-hidden />
              {schedule.length === 0 ? <p className="p-5 text-sm text-muted">No programmes match this channel/search in the imported window. <Link to="/playlists" className="text-cyanx hover:underline">Check your EPG import</Link>.</p> : <ol className="min-w-[520px] divide-y divide-border">{schedule.map((p) => <li key={p.id} className={`px-4 py-3 text-sm ${Date.now() >= p.start && Date.now() < p.end ? 'bg-sky-950/50' : 'bg-card'}`}><span className="font-semibold">{p.title}</span><span className="block text-xs text-muted">{new Date(p.start).toLocaleString()} – {new Date(p.end).toLocaleTimeString()}{p.description ? ` · ${p.description}` : ''}</span></li>)}</ol>}
            </div>
            <p className="mt-2 text-xs text-muted">Red line marks “now” relative to the imported schedule window. Catch-up buttons are shown only when a provider supplies a legitimate catch-up capability — none is assumed here.</p>
          </div>
        </div>)}
    </div>
  );
}
