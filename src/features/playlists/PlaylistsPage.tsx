import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileUp, Link2, Play, RefreshCw, Server, Trash2 } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, Card, ConfirmDialog, EmptyState, Input, Select } from '@/components/ui/ui';
import { redactUrl } from '@/lib/security';

type Tab = 'file' | 'url' | 'xtream';
interface Preview { name: string; items: { title: string }[]; warnings: string[]; errors: string[]; total: number; raw: Parameters<ReturnType<typeof useStore>['commitImport']>[1] }

export function PlaylistsPage() {
  const store = useStore();
  const { playlists, items, toast } = store;
  const [tab, setTab] = useState<Tab>('file');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [server, setServer] = useState(''); const [user, setUser] = useState(''); const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pendingType, setPendingType] = useState<'file' | 'url' | 'xtream'>('file');
  const [pendingUrl, setPendingUrl] = useState<string | undefined>(undefined);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const showPreview = (p: Preview, type: 'file' | 'url' | 'xtream', u?: string) => { setPreview(p); setPendingType(type); setPendingUrl(u); };
  const onFile = async (f: File) => {
    setBusy(true);
    try { const p = await store.previewFile(f, name); showPreview({ ...p, raw: p }, 'file'); }
    catch (e) { toast({ tone: 'error', title: 'Import failed', body: e instanceof Error ? e.message : 'Invalid file' }); }
    finally { setBusy(false); }
  };
  const onUrl = async () => {
    setBusy(true);
    try { const p = await store.importUrl(name, url); showPreview({ ...p, raw: p }, 'url', url); }
    catch (e) { toast({ tone: 'error', title: 'URL import failed', body: e instanceof Error ? e.message : 'Fetch failed' }); }
    finally { setBusy(false); }
  };
  const onXtream = async () => {
    setBusy(true);
    try { const p = await store.importXtream(name, server, user, pass); showPreview({ ...p, raw: p }, 'xtream'); setPass(''); }
    catch (e) { toast({ tone: 'error', title: 'Xtream connection failed', body: e instanceof Error ? e.message : 'Connection failed' }); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy(true);
    try { await store.commitImport(preview.name, preview.raw, pendingType, pendingType === 'url' ? pendingUrl : undefined); toast({ tone: 'success', title: 'Playlist imported', body: `${preview.items.length} playable item(s) added.` }); setPreview(null); }
    catch (e) { toast({ tone: 'error', title: 'Could not save playlist', body: e instanceof Error ? e.message : 'Import failed' }); }
    finally { setBusy(false); }
  };
  const visible = playlists.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold">Playlists & Sources</h1>
      <p className="mb-5 max-w-3xl text-sm leading-6 text-muted">Add only sources you are authorized to use. Playlist URLs and credentials are treated as private: they are never written to logs, diagnostics or exports. Passwords are used for the connection request and are not stored in local storage.</p>

      <Card className="mb-5">
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Add source">
          {([['file', FileUp, 'M3U Playlist File'], ['url', Link2, 'M3U URL'], ['xtream', Server, 'Xtream Codes']] as const).map(([t, Icon, label]) => <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${tab === t ? 'bg-sky-500 text-white' : 'border border-border bg-panel'}`}><Icon size={17} aria-hidden />{label}</button>)}
        </div>
        <label className="mb-3 block text-sm font-medium">Playlist Name<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My Playlist" className="mt-1" /></label>
        {tab === 'file' && <div>
          <input ref={fileRef} type="file" accept=".m3u,.m3u8,.txt" className="sr-only" aria-label="Choose M3U playlist file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
          <Button onClick={() => fileRef.current?.click()} disabled={busy}><FileUp size={18} aria-hidden />{busy ? 'Parsing…' : 'Select M3U / M3U8 file (max 15 MB)'}</Button>
          <p className="mt-2 text-xs leading-5 text-muted">The file is parsed on this device. Malformed entries produce warnings instead of crashing, and you always see a preview before anything is saved.</p>
        </div>}
        {tab === 'url' && <div>
          <label className="block text-sm font-medium">M3U URL<Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://provider.example/playlist.m3u" inputMode="url" className="mt-1" /></label>
          <Button className="mt-3" onClick={() => void onUrl()} disabled={busy || !url.trim()}>{busy ? 'Fetching…' : 'Fetch & preview'}</Button>
          <p className="mt-2 text-xs leading-5 text-muted">Browser security may block this fetch (CORS). That cannot be bypassed by changing frontend headers. If it fails, download the file from your provider and use file import.</p>
        </div>}
        {tab === 'xtream' && <div className="grid gap-3">
          <label className="block text-sm font-medium">Server address<Input value={server} onChange={(e) => setServer(e.target.value)} placeholder="http://provider.example:8080" inputMode="url" className="mt-1" /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium">Username<Input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" className="mt-1" /></label>
          <label className="block text-sm font-medium">Password<Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" className="mt-1" /></label></div>
          <p className="text-xs leading-5 text-muted">Credentials are sent only to the server you enter, only for this request, and are never logged or exported. Not every Xtream-compatible panel permits browser access; SIRAVEX does not bypass provider restrictions.</p>
          <Button onClick={() => void onXtream()} disabled={busy || !server.trim() || !user.trim() || !pass}>{busy ? 'Connecting…' : 'Connect & preview'}</Button>
        </div>}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={async () => { try { await store.importDemo(); toast({ tone: 'success', title: 'Demo samples added', body: 'Labelled legal sample streams only.' }); } catch (e) { toast({ tone: 'error', title: 'Demo failed', body: e instanceof Error ? e.message : 'Failed' }); } }}><Play size={17} aria-hidden />Add labelled demo samples</Button>
          <Button variant="ghost" onClick={() => store.exportSettings()}><Download size={17} aria-hidden />Export settings (no secrets)</Button>
        </div>
      </Card>

      {preview && <Card className="mb-5 border-sky-500/50" >
        <h2 className="font-bold">Import preview — {preview.name}</h2>
        <p className="mt-1 text-sm text-muted">{preview.items.length} playable item(s) found from {preview.total} entr{preview.total === 1 ? 'y' : 'ies'}. Nothing is saved until you confirm. Importing never silently overwrites another playlist.</p>
        {preview.errors.length > 0 && <p className="mt-2 rounded-lg bg-red-950/50 p-3 text-sm text-red-200" role="alert">{preview.errors.join(' ')}</p>}
        {preview.warnings.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-sm font-semibold text-amber-300">{preview.warnings.length} warning(s)</summary><ul className="mt-2 list-disc pl-5 text-xs leading-5 text-muted">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
        <ul className="mt-3 max-h-44 overflow-y-auto rounded-lg border border-border bg-ink p-3 text-sm">{preview.items.slice(0, 30).map((i, idx) => <li key={idx} className="truncate py-0.5">{i.title}</li>)}{preview.items.length > 30 && <li className="text-muted">…and {preview.items.length - 30} more</li>}</ul>
        <div className="mt-4 flex gap-2"><Button onClick={() => void commit()} disabled={busy || preview.items.length === 0}>{busy ? 'Saving…' : 'Confirm import'}</Button><Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button></div>
      </Card>}

      <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="mr-auto text-lg font-bold">Your sources ({playlists.length})</h2>
        <label className="sr-only" htmlFor="pl-filter">Search playlists</label><input id="pl-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search playlists…" className="min-h-[44px] rounded-xl border border-border bg-panel px-3 text-sm focus:border-sky-400 focus:outline-none" /></div>
      {playlists.length === 0 ? <EmptyState title="No playlists yet" body="Add an M3U file, URL or Xtream-compatible connection above. Imported items appear in Live TV, Movies and Series automatically." /> :
        <div className="grid gap-3">{visible.map((p) => (
          <Card key={p.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-[220px] flex-1"><p className="font-bold">{p.name} {p.isDefault && <span className="ml-1 rounded bg-sky-500/20 px-2 py-0.5 text-xs text-sky-300">Default</span>}</p>
              <p className="mt-1 text-xs leading-5 text-muted">{p.type.toUpperCase()} · {items.filter((i) => i.playlistId === p.id).length} items stored · {p.lastImportedAt ? `Imported ${new Date(p.lastImportedAt).toLocaleString()}` : 'Not imported'} {p.url ? `· ${redactUrl(p.url)}` : ''}</p>
              <label className="mt-2 block text-xs text-muted">Rename<Input defaultValue={p.name} aria-label={`Rename ${p.name}`} onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== p.name) void store.renamePlaylist(p.id, e.target.value); }} className="mt-1" /></label></div>
            <div className="flex flex-wrap gap-2">
              <Select value={p.enabled ? 'enabled' : 'disabled'} onChange={() => void store.togglePlaylist(p.id)} aria-label={`Enable or disable ${p.name}`}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></Select>
              {!p.isDefault && <Button variant="outline" onClick={() => void store.setDefaultPlaylist(p.id)}>Set default</Button>}
              <Button variant="outline" onClick={async () => { try { await store.refreshPlaylist(p.id); toast({ tone: 'success', title: 'Playlist refreshed' }); } catch (e) { toast({ tone: 'error', title: 'Refresh failed', body: e instanceof Error ? e.message : 'Failed' }); } }}><RefreshCw size={16} aria-hidden />Refresh</Button>
              <Button variant="danger" onClick={() => setDeleteId(p.id)}><Trash2 size={16} aria-hidden />Remove</Button>
            </div>
          </Card>))}
        </div>}
      <p className="mt-4 text-sm text-muted">Need programmes? <Link to="/epg" className="text-cyanx hover:underline">Import an XMLTV EPG file</Link>. Removing a playlist deletes its items, favourites and progress for that source.</p>
      <ConfirmDialog open={!!deleteId} title="Remove this playlist?" body="Its channels, movies, favourites and watch progress stored for this source will be deleted from this device. This cannot be undone." confirmLabel="Remove playlist" onCancel={() => setDeleteId(null)} onConfirm={async () => { if (deleteId) await store.deletePlaylist(deleteId); setDeleteId(null); toast({ tone: 'success', title: 'Playlist removed' }); }} />
    </div>
  );
}
