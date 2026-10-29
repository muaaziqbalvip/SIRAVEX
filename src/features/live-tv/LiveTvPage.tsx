import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, List } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, EmptyState, Select, Skeleton, useDebounced } from '@/components/ui/ui';
import { ChannelRow, MediaCard } from '@/components/media/MediaCard';

export function LiveTvPage() {
  const { ready, items, playlists, settings, updateSettings } = useStore();
  const [q, setQ] = useState(''); const dq = useDebounced(q);
  const [group, setGroup] = useState('All'); const [sort, setSort] = useState<'title' | 'group'>('title');
  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const live = useMemo(() => items.filter((i) => i.kind === 'live' && enabled.has(i.playlistId)), [items, enabled]);
  const groups = useMemo(() => ['All', ...Array.from(new Set(live.map((i) => i.group))).sort()], [live]);
  const filtered = useMemo(() => live.filter((i) => (group === 'All' || i.group === group) && i.title.toLowerCase().includes(dq.toLowerCase())).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : a.group.localeCompare(b.group) || a.title.localeCompare(b.title)), [live, group, dq, sort]);
  if (!ready) return <Skeleton className="h-64" />;
  if (playlists.length === 0) return <EmptyState title="Connect a source to begin" body="Live TV appears here after you import a playlist you are authorized to use. No channels are bundled or fabricated." action={<Link to="/playlists"><Button>Add Playlist</Button></Link>} />;
  const grid = settings.liveLayout === 'grid';
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2"><h1 className="mr-auto text-2xl font-extrabold">Live TV</h1>
        <button type="button" onClick={() => updateSettings({ liveLayout: grid ? 'list' : 'grid' })} aria-label={grid ? 'Switch to list view' : 'Switch to grid view'} className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">{grid ? <List size={19} /> : <LayoutGrid size={19} />}</button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="search">
        <label className="sr-only" htmlFor="live-q">Search channels</label><input id="live-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels…" className="min-h-[44px] min-w-[200px] flex-1 rounded-xl border border-border bg-panel px-3 text-sm focus:border-sky-400 focus:outline-none" />
        <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Filter by category">{groups.map((g) => <option key={g}>{g}</option>)}</Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort channels"><option value="title">Sort: Title</option><option value="group">Sort: Category</option></Select>
        {q && <Button variant="ghost" onClick={() => setQ('')}>Clear search</Button>}
      </div>
      <p className="mb-3 text-sm text-muted" role="status">{filtered.length} channel(s). Current/next programme appears inside the player only when real EPG data is imported.</p>
      {filtered.length === 0 ? <EmptyState title="No channels match" body="Try a different search or category, or import a playlist that contains live channels." /> :
        grid ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{filtered.map((i) => <MediaCard key={i.id} item={i} />)}</div> : <div className="grid gap-2">{filtered.map((i) => <ChannelRow key={i.id} item={i} />)}</div>}
    </div>
  );
}
