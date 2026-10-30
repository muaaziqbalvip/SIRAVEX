import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, GripVertical, Play, Trash2 } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, EmptyState } from '@/components/ui/ui';
import { SafeImage } from '@/components/media/MediaCard';
import { isMediaLocked } from '@/lib/parental';
import { downloadM3u } from '@/lib/m3u-export';

export function FavouritesPage() {
  const { favourites, items, settings, parentalUnlocked, reorderFavourites, toggleFavourite, toast } = useStore();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const favItems = favourites
    .map((f) => items.find((i) => i.id === f.itemId))
    .filter((i): i is NonNullable<typeof i> => Boolean(i) && !isMediaLocked(i!, settings, parentalUnlocked));

  const moveFavourite = async (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || toIdx < 0 || toIdx >= favItems.length) return;
    const ids = favItems.map((i) => i.id);
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    await reorderFavourites(ids);
  };

  if (favItems.length === 0) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-extrabold">Favourites</h1>
        <EmptyState
          title="No favourites yet"
          body="Tap the heart icon on any channel, movie or series to pin it here (synced across devices when signed in)."
          action={<Link to="/live"><Button>Browse Live TV</Button></Link>}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">Favourites ({favItems.length})</h1>
          <p className="text-sm text-muted">Drag rows or use arrow buttons to reorder · Export as a portable `.m3u` playlist anytime.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            downloadM3u(favItems, 'siravex-favourites.m3u');
            toast({ tone: 'success', title: 'Exported .M3U Playlist', body: `${favItems.length} favourite channel(s)/VOD exported.` });
          }}
        >
          <Download size={16} aria-hidden />Export .M3U
        </Button>
      </div>

      <ul className="mt-4 grid gap-2">
        {favItems.map((it, idx) => (
          <li
            key={it.id}
            draggable
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragIdx !== null) void moveFavourite(dragIdx, idx); setDragIdx(null); }}
            className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card p-2.5 sm:gap-3 sm:p-3"
          >
            <GripVertical className="hidden shrink-0 cursor-grab text-muted sm:block" size={18} aria-hidden />
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-panel sm:h-12 sm:w-12"><SafeImage src={it.poster || it.logo} title={it.title} className="h-full w-full" /></div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold sm:text-base">{it.title}</p>
              <p className="truncate text-xs text-muted">{it.kind.toUpperCase()} · {it.group}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              <button type="button" disabled={idx === 0} onClick={() => void moveFavourite(idx, idx - 1)} aria-label={`Move ${it.title} up`} className="grid h-9 w-9 place-items-center rounded-lg border border-border disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx sm:h-10 sm:w-10"><ArrowUp size={16} /></button>
              <button type="button" disabled={idx === favItems.length - 1} onClick={() => void moveFavourite(idx, idx + 1)} aria-label={`Move ${it.title} down`} className="grid h-9 w-9 place-items-center rounded-lg border border-border disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx sm:h-10 sm:w-10"><ArrowDown size={16} /></button>
              <Link to={`/player/${encodeURIComponent(it.id)}`} aria-label={`Play ${it.title}`} className="grid h-9 w-9 place-items-center rounded-lg bg-sky-500 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx sm:h-10 sm:w-10"><Play size={16} /></Link>
              <button type="button" onClick={() => void toggleFavourite(it.id)} aria-label={`Remove ${it.title} from favourites`} className="grid h-9 w-9 place-items-center rounded-lg border border-border text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx sm:h-10 sm:w-10"><Trash2 size={16} /></button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
