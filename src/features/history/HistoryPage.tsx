import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, ConfirmDialog, EmptyState, Skeleton } from '@/components/ui/ui';
import { MediaCard } from '@/components/media/MediaCard';

export function HistoryPage() {
  const { ready, items, progress, removeProgress, clearHistory, toast } = useStore();
  const [confirm, setConfirm] = useState(false);
  const entries = [...progress].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => ({ p, item: items.find((i) => i.id === p.itemId) })).filter((x) => x.item);
  const cont = entries.filter((x) => !x.p.completed && x.p.position > 5);
  if (!ready) return <Skeleton className="h-64" />;
  if (entries.length === 0) return <EmptyState title="No watch history yet" body="When you watch seekable movies or episodes, progress is saved locally so you can resume. Live TV does not create fake progress." action={<Link to="/movies"><Button>Browse Movies</Button></Link>} />;
  return (
    <div><div className="mb-4 flex flex-wrap items-center gap-2"><h1 className="mr-auto text-2xl font-extrabold">Continue Watching & History</h1><Button variant="danger" onClick={() => setConfirm(true)}>Clear all history</Button></div>
      <h2 className="mb-2 font-bold">Continue Watching</h2>
      {cont.length === 0 ? <p className="mb-6 text-sm text-muted">Nothing in progress right now.</p> : <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{cont.map(({ p, item }) => <div key={item!.id}><MediaCard item={item!} progressPct={p.duration ? (p.position / p.duration) * 100 : 0} /><button type="button" onClick={() => void removeProgress(item!.id)} className="mt-1 inline-flex min-h-[40px] items-center gap-1 text-xs text-red-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx rounded"><Trash2 size={13} aria-hidden /> Remove</button></div>)}</div>}
      <h2 className="mb-2 font-bold">Recently Watched</h2>
      <div className="grid gap-2">{entries.map(({ p, item }) => <div key={item!.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2"><span className="min-w-0 flex-1"><Link to={`/player/${encodeURIComponent(item!.id)}`} className="block truncate text-sm font-semibold hover:text-cyanx">{item!.title}</Link><span className="text-xs text-muted">{new Date(p.updatedAt).toLocaleString()}{p.completed ? ' · Completed' : p.duration ? ` · ${Math.round((p.position / p.duration) * 100)}%` : ''}</span></span><button type="button" onClick={() => void removeProgress(item!.id)} aria-label={`Remove ${item!.title} from history`} className="grid h-11 w-11 place-items-center rounded-full hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Trash2 size={17} /></button></div>)}</div>
      <ConfirmDialog open={confirm} title="Clear all history?" body="This deletes all saved watch progress and recently-watched entries on this device. Playlists and favourites are not affected." confirmLabel="Clear history" onCancel={() => setConfirm(false)} onConfirm={async () => { await clearHistory(); setConfirm(false); toast({ tone: 'success', title: 'History cleared' }); }} />
    </div>
  );
}
