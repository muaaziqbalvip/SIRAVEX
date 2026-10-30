import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Grid2x2, LayoutGrid, List, Lock } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, EmptyState, Select, Skeleton, useDebounced } from '@/components/ui/ui';
import { ChannelCard, ChannelRow } from '@/components/media/MediaCard';
import { PinModal } from '@/components/ui/PinModal';
import { cleanGroup } from '@/lib/display';
import { isMediaLocked } from '@/lib/parental';
import { downloadM3u } from '@/lib/m3u-export';

export function LiveTvPage() {
  const { ready, items, playlists, programmes, settings, parentalUnlocked, updateSettings, toast } = useStore();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [group, setGroup] = useState('All');
  const [sort, setSort] = useState<'title' | 'group'>('title');
  const [pinOpen, setPinOpen] = useState(false);

  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const allLive = useMemo(() => items.filter((i) => i.kind === 'live' && enabled.has(i.playlistId)), [items, enabled]);
  const lockedCount = useMemo(
    () => allLive.filter((i) => isMediaLocked(i, settings, parentalUnlocked)).length,
    [allLive, settings, parentalUnlocked],
  );
  const live = useMemo(
    () => allLive.filter((i) => !isMediaLocked(i, settings, parentalUnlocked)),
    [allLive, settings, parentalUnlocked],
  );
  const groups = useMemo(() => ['All', ...Array.from(new Set(live.map((i) => i.group))).sort()], [live]);

  const epgMap = useMemo(() => {
    const now = Date.now();
    const cur = new Map<string, string>();
    const nxt = new Map<string, string>();
    const sorted = [...programmes].sort((a, b) => a.start - b.start);
    for (const p of sorted) {
      const k = p.channelId.trim().toLowerCase();
      if (!k) continue;
      if (now >= p.start && now < p.end) cur.set(k, p.title);
      else if (p.start > now && !nxt.has(k)) nxt.set(k, p.title);
    }
    return { cur, nxt };
  }, [programmes]);

  const getEpgCur = (i: (typeof live)[number]) =>
    (i.tvgId ? epgMap.cur.get(i.tvgId.trim().toLowerCase()) : undefined) ?? epgMap.cur.get(i.id.trim().toLowerCase());
  const getEpgNxt = (i: (typeof live)[number]) =>
    (i.tvgId ? epgMap.nxt.get(i.tvgId.trim().toLowerCase()) : undefined) ?? epgMap.nxt.get(i.id.trim().toLowerCase());

  const filtered = useMemo(
    () =>
      live
        .filter((i) => (group === 'All' || i.group === group) && i.title.toLowerCase().includes(dq.toLowerCase()))
        .sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title) : a.group.localeCompare(b.group) || a.title.localeCompare(b.title))),
    [live, group, dq, sort],
  );
  const shown = filtered.slice(0, 400);

  if (!ready) return <div className="grid gap-2" aria-busy="true"><Skeleton className="h-12" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  if (playlists.length === 0) return <EmptyState title="Connect a source to begin" body="Live TV appears here after you import a playlist you are authorized to use. No channels are bundled or fabricated." action={<Link to="/playlists"><Button>Add Playlist</Button></Link>} />;

  const grid = settings.liveLayout === 'grid';

  return (
    <div className="w-full min-w-0 max-w-full">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-extrabold sm:text-2xl">Live TV</h1>
        <span className="hidden text-sm text-muted sm:inline" role="status">{filtered.length.toLocaleString()} channel(s)</span>
        {lockedCount > 0 && (
          <button
            type="button"
            onClick={() => setPinOpen(true)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-950/40 px-3 text-xs font-bold text-amber-300"
          >
            <Lock size={13} aria-hidden />{lockedCount} Locked
          </button>
        )}
        <Link to="/multiview">
          <Button variant="outline" className="min-h-[40px] px-3 text-xs">
            <Grid2x2 size={15} aria-hidden /><span className="hidden sm:inline">Multi-View</span>
          </Button>
        </Link>
        {filtered.length > 0 && (
          <Button
            variant="outline"
            className="min-h-[40px] px-3 text-xs"
            onClick={() => {
              downloadM3u(filtered, group === 'All' ? 'siravex-live.m3u' : `siravex-${cleanGroup(group)}.m3u`);
              toast({ tone: 'success', title: 'Exported .M3U', body: `${filtered.length.toLocaleString()} live channel(s) exported.` });
            }}
          >
            <Download size={15} aria-hidden /><span className="hidden md:inline">Export .M3U</span>
          </Button>
        )}
        <button
          type="button"
          onClick={() => updateSettings({ liveLayout: grid ? 'list' : 'grid' })}
          aria-label={grid ? 'Switch to list view' : 'Switch to grid view'}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"
        >
          {grid ? <List size={18} /> : <LayoutGrid size={18} />}
        </button>
      </div>

      <label className="sr-only" htmlFor="live-q">Search channels</label>
      <input id="live-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels…" className="mb-3 min-h-[46px] w-full rounded-xl border border-border bg-panel px-3.5 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30" />

      <div className="chips-row -mx-3 mb-3 flex flex-nowrap gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0" role="group" aria-label="Categories">
        {groups.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroup(g)}
            aria-pressed={group === g}
            className={`min-h-[38px] max-w-[240px] shrink-0 truncate rounded-full px-3.5 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${group === g ? 'bg-sky-500 text-white shadow-glow' : 'border border-border bg-card text-silver/85'}`}
            title={g}
          >
            {g === 'All' ? 'All' : cleanGroup(g)}
          </button>
        ))}
        <Select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort channels" className="min-h-[38px] shrink-0 rounded-full text-[13px]">
          <option value="title">A–Z</option>
          <option value="group">Category</option>
        </Select>
      </div>

      {filtered.length > shown.length && <p className="mb-2 text-xs text-muted">Showing first {shown.length} — search or pick a category to narrow down.</p>}

      {filtered.length === 0 ? (
        <EmptyState title="No channels match" body="Try a different search or category, or import a playlist that contains live channels." />
      ) : grid ? (
        <div className="flex w-full min-w-0 flex-wrap gap-2.5">{shown.map((i) => <ChannelCard key={i.id} item={i} nowTitle={getEpgCur(i)} />)}</div>
      ) : (
        <div className="grid w-full min-w-0 gap-2">{shown.map((i) => <ChannelRow key={i.id} item={i} nowTitle={getEpgCur(i)} nextTitle={getEpgNxt(i)} />)}</div>
      )}

      <PinModal open={pinOpen} onClose={() => setPinOpen(false)} />
    </div>
  );
}
