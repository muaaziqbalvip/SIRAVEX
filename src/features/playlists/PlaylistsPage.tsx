import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarSync, Download, FileUp, Link2, Play, RefreshCw, Server, Trash2 } from 'lucide-react';
import { useStore, type ImportPreview } from '@/app/store';
import { Button, Card, ConfirmDialog, EmptyState, Input, Select, Switch } from '@/components/ui/ui';
import { redactUrl } from '@/lib/security';

type Tab = 'file' | 'url' | 'xtream';

export function PlaylistsPage() {
  const store = useStore();
  const { playlists, items, programmes, toast } = store;
  const [tab, setTab] = useState<Tab>('xtream');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [server, setServer] = useState(''); const [user, setUser] = useState(''); const [pass, setPass] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pendingType, setPendingType] = useState<Tab>('file');
  const [epgPass, setEpgPass] = useState<Record<string, string>>({});
  const [epgBusy, setEpgBusy] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File) => {
    setBusy(true);
    try { setPreview(await store.previewFile(f, name)); setPendingType('file'); }
    catch (e) { toast({ tone: 'error', title: 'Import failed', body: e instanceof Error ? e.message : 'Invalid file' }); }
    finally { setBusy(false); }
  };
  const onUrl = async () => {
    setBusy(true);
    try { setPreview(await store.importUrl(name, url)); setPendingType('url'); }
    catch (e) { toast({ tone: 'error', title: 'URL import failed', body: e instanceof Error ? e.message : 'Fetch failed' }); }
    finally { setBusy(false); }
  };
  const onXtream = async () => {
    setBusy(true);
    try {
      const p = await store.importXtream(name, { server: server.trim(), username: user.trim(), password: pass });
      setPreview(p); setPendingType('xtream');
    } catch (e) { toast({ tone: 'error', title: 'Xtream connection failed', body: e instanceof Error ? e.message : 'Connection failed' }); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await store.commitImport(preview.name, preview, pendingType, pendingType === 'url' ? { url } : pendingType === 'xtream' ? { server: server.trim(), username: user.trim(), password: pass, remember } : undefined);
      toast({ tone: 'success', title: 'Source saved', body: `${preview.items.length.toLocaleString()} item(s)${preview.epgCount ? ` + ${preview.epgCount.toLocaleString()} EPG programmes` : ''} added.` });
      setPreview(null); setPass('');
    } catch (e) { toast({ tone: 'error', title: 'Could not save playlist', body: e instanceof Error ? e.message : 'Import failed' }); }
    finally { setBusy(false); }
  };
  const fetchEpg = async (playlistId: string) => {
    setEpgBusy(playlistId);
    try { const n = await store.refreshXtreamEpg(playlistId, epgPass[playlistId] || undefined); toast({ tone: 'success', title: `EPG updated: ${n.toLocaleString()} programmes`, body: 'Guide page aur player mein Now/Next ab nazar ayega.' }); }
    catch (e) { toast({ tone: 'error', title: 'EPG fetch failed', body: e instanceof Error ? e.message : 'Failed' }); }
    finally { setEpgBusy(null); }
  };
  const visible = playlists.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <h1 className="mb-1 text-xl font-extrabold sm:text-2xl">Playlists & Sources</h1>
      <p className="mb-5 max-w-3xl text-sm leading-6 text-muted">Sirf woh sources add karein jin ke istemal ki aap ko ijazat hai. Xtream connect par SIRAVEX asal <strong className="text-silver">player_api</strong> se Live + Movies (posters/rating) + Series (episodes) aur <strong className="text-silver">xmltv.php</strong> se poora EPG khud fetch karta hai. Password kabhi log/export nahi hota.</p>

      <Card className="mb-5">
        <div className="mb-4 flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Add source">
          {([['xtream', Server, 'Xtream Codes'], ['file', FileUp, 'M3U File'], ['url', Link2, 'M3U URL']] as const).map(([t, Icon, label]) => <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${tab === t ? 'bg-sky-500 text-white shadow-glow' : 'border border-border bg-panel'}`}><Icon size={17} aria-hidden />{label}</button>)}
        </div>
        <label className="mb-3 block text-sm font-medium">Playlist Name<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Playlist" className="mt-1" /></label>

        {tab === 'xtream' && (
          <div className="grid gap-3">
            <label className="block text-sm font-medium">Server address<Input value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://provider.example:8080" inputMode="url" className="mt-1" /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium">Username<Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" className="mt-1" /></label>
              <label className="block text-sm font-medium">Password<Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" className="mt-1" /></label>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-panel px-3 py-2.5">
              <Switch checked={remember} onChange={setRemember} label="Remember password on this device" />
              <span className="min-w-[220px] flex-1 text-xs leading-5 text-muted"><strong className="text-silver">Save password on this device</strong> — taake EPG refresh aur series episodes baghair dobara password ke chalein. Sirf is device ke local database mein rehta hai, kabhi server par nahi jata.</span>
            </div>
            <Button onClick={() => void onXtream()} disabled={busy || !server.trim() || !user.trim() || !pass}>{busy ? 'Connecting — Live, Movies, Series aur EPG fetch ho raha hai…' : 'Connect & fetch everything'}</Button>
            <p className="text-xs leading-5 text-muted">Streams provider ke apne HLS (.m3u8) output mein aate hain taake browser mein chalein. Kuch panels browser access block karte hain (CORS) — SIRAVEX use bypass nahi karta; aisi surat mein provider se M3U file le kar File tab use karein.</p>
          </div>
        )}
        {tab === 'file' && (
          <div>
            <input ref={fileRef} type="file" accept=".m3u,.m3u8,.txt" className="sr-only" aria-label="Choose M3U playlist file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}><FileUp size={18} aria-hidden />{busy ? 'Parsing…' : 'Select M3U / M3U8 file (max 15 MB)'}</Button>
            <p className="mt-2 text-xs leading-5 text-muted">File is device par parse hoti hai. Xtream .ts links khud .m3u8 (HLS) mein convert ho jate hain. Pehle preview, phir save — kuch silently overwrite nahi hota.</p>
          </div>
        )}
        {tab === 'url' && (
          <div>
            <label className="block text-sm font-medium">M3U URL<Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://provider.example/playlist.m3u" inputMode="url" className="mt-1" /></label>
            <Button className="mt-3" onClick={() => void onUrl()} disabled={busy || !url.trim()}>{busy ? 'Fetching…' : 'Fetch & preview'}</Button>
            <p className="mt-2 text-xs leading-5 text-muted">CORS block ho to ye browser ki security hai — frontend headers se bypass nahi hoti. File import istemal karein.</p>
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={async () => { try { await store.importDemo(); toast({ tone: 'success', title: 'Demo samples added', body: 'Labelled legal sample streams only.' }); } catch (e) { toast({ tone: 'error', title: 'Demo failed', body: e instanceof Error ? e.message : 'Failed' }); } }}><Play size={17} aria-hidden />Add demo samples</Button>
          <Button variant="ghost" onClick={() => store.exportSettings()}><Download size={17} aria-hidden />Export settings (no secrets)</Button>
        </div>
      </Card>

      {preview && (
        <Card className="mb-5 border-sky-500/60">
          <h2 className="font-bold">Import preview — {preview.name}</h2>
          {preview.accountNote && <p className="mt-1 text-sm text-emerald-300">{preview.accountNote}</p>}
          <p className="mt-1 text-sm text-muted">{preview.items.length.toLocaleString()} item(s) mile{preview.epgCount !== undefined ? ` · EPG programmes: ${preview.epgCount.toLocaleString()}` : ''}. Confirm se pehle kuch save nahi hota.</p>
          <p className="mt-1 text-xs text-muted">{(['live', 'movie', 'series'] as const).map((k) => `${k}: ${preview.items.filter((i) => i.kind === k).length.toLocaleString()}`).join(' · ')}</p>
          {preview.errors.length > 0 && <p className="mt-2 rounded-lg bg-red-950/50 p-3 text-sm text-red-200" role="alert">{preview.errors.join(' ')}</p>}
          {preview.warnings.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold text-amber-300">{preview.warnings.length} warning(s)</summary><ul className="mt-2 list-disc pl-5 text-xs leading-5 text-muted">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
          <ul className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-border bg-ink p-3 text-sm">{preview.items.slice(0, 30).map((i, idx) => <li key={idx} className="truncate py-0.5"><span className="mr-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-300">{i.kind}</span>{i.title}</li>)}{preview.items.length > 30 && <li className="text-muted">…and {(preview.items.length - 30).toLocaleString()} more</li>}</ul>
          <div className="mt-4 flex gap-2"><Button onClick={() => void commit()} disabled={busy || preview.items.length === 0}>{busy ? 'Saving…' : 'Confirm import'}</Button><Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button></div>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="mr-auto text-lg font-bold">Your sources ({playlists.length})</h2>
        <label className="sr-only" htmlFor="pl-filter">Search playlists</label><input id="pl-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search playlists…" className="min-h-[44px] rounded-xl border border-border bg-panel px-3 text-sm focus:border-sky-400 focus:outline-none" /></div>
      {playlists.length === 0 ? <EmptyState title="No playlists yet" body="Upar se Xtream account connect karein ya M3U file/URL add karein. Items khud Live TV, Movies aur Series mein aa jayenge, EPG Guide mein." /> : (
        <div className="grid gap-3">{visible.map((p) => {
          const epgCount = programmes.filter((x) => x.playlistId === p.id).length;
          return (
            <Card key={p.id} className="flex flex-wrap items-center gap-3">
              <img src="/icons/logo-256.png" alt="" width={46} height={46} className="h-[46px] w-[46px] shrink-0 rounded-xl" loading="lazy" />
              <div className="min-w-[220px] flex-1">
                <p className="font-bold">{p.name} {p.isDefault && <span className="ml-1 rounded bg-sky-500/20 px-2 py-0.5 text-xs text-sky-300">Default</span>}</p>
                <p className="mt-1 text-xs leading-5 text-muted">{p.type.toUpperCase()} · {items.filter((i) => i.playlistId === p.id).length.toLocaleString()} items · EPG {epgCount.toLocaleString()} programmes{p.lastEpgAt ? ` (updated ${new Date(p.lastEpgAt).toLocaleDateString()})` : ''} · {p.lastImportedAt ? `Imported ${new Date(p.lastImportedAt).toLocaleString()}` : 'Not imported'}{p.url ? ` · ${redactUrl(p.url)}` : ''}{p.server ? ` · ${redactUrl(p.server)}` : ''}</p>
                <label className="mt-2 block text-xs text-muted">Rename<Input defaultValue={p.name} aria-label={`Rename ${p.name}`} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== p.name) void store.renamePlaylist(p.id, e.target.value); }} className="mt-1" /></label>
                {p.type === 'xtream' && !p.password && (
                  <label className="mt-2 block text-xs text-muted">Password for EPG fetch (not saved)<Input type="password" value={epgPass[p.id] ?? ''} onChange={(e) => setEpgPass((s) => ({ ...s, [p.id]: e.target.value }))} autoComplete="current-password" className="mt-1" /></label>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Select value={p.enabled ? 'enabled' : 'disabled'} onChange={() => void store.togglePlaylist(p.id)} aria-label={`Enable or disable ${p.name}`}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></Select>
                {p.type === 'xtream' && <Button variant="outline" disabled={epgBusy === p.id} onClick={() => void fetchEpg(p.id)}><CalendarSync size={16} aria-hidden />{epgBusy === p.id ? 'Fetching EPG…' : 'Fetch EPG'}</Button>}
                {!p.isDefault && <Button variant="outline" onClick={() => void store.setDefaultPlaylist(p.id)}>Set default</Button>}
                <Button variant="outline" onClick={async () => { try { await store.refreshPlaylist(p.id); toast({ tone: 'success', title: 'Playlist refreshed' }); } catch (e) { toast({ tone: 'error', title: 'Refresh info', body: e instanceof Error ? e.message : 'Failed' }); } }}><RefreshCw size={16} aria-hidden />Refresh</Button>
                <Button variant="danger" onClick={() => setDeleteId(p.id)}><Trash2 size={16} aria-hidden />Remove</Button>
              </div>
            </Card>
          );
        })}</div>
      )}
      <p className="mt-4 text-sm text-muted">Programme guide ke liye <Link to="/epg" className="text-cyanx hover:underline">EPG page</Link> dekhein. Playlist remove karne se us ke items, favourites, progress aur EPG is device se delete ho jate hain.</p>
      <ConfirmDialog open={!!deleteId} title="Remove this playlist?" body="Its channels, movies, favourites, watch progress and EPG stored for this source will be deleted from this device. This cannot be undone." confirmLabel="Remove playlist" onCancel={() => setDeleteId(null)} onConfirm={async () => { if (deleteId) await store.deletePlaylist(deleteId); setDeleteId(null); toast({ tone: 'success', title: 'Playlist removed' }); }} />
    </div>
  );
}
