import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Check, GripVertical, ListOrdered, Play, Trash2 } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, EmptyState, Skeleton } from '@/components/ui/ui';
import { ChannelRow, MediaCard, SafeImage } from '@/components/media/MediaCard';
import { cleanTitle } from '@/lib/display';
import type { MediaItem } from '@/types/models';

const KIND_LABEL: Record<string, string> = { live: 'Live TV', movie: 'Movie', series: 'Series', episode: 'Episode', channel: 'Channel' };

function SortableFavRow({ item, index, total, onMove, onRemove, onOpen }: {
  item: MediaItem; index: number; total: number;
  onMove: (itemId: string, dir: -1 | 1) => void; onRemove: (itemId: string) => void; onOpen: (item: MediaItem) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined, opacity: isDragging ? 0.92 : 1 };
  return (
    <div ref={setNodeRef} style={style} className={`flex items-center gap-2 rounded-2xl border bg-card p-2 ${isDragging ? 'border-sky-400 shadow-glow' : 'border-border'}`}>
      <button type="button" {...attributes} {...listeners} aria-label={`Drag to reorder ${cleanTitle(item.title)}`} className="grid h-11 w-9 shrink-0 cursor-grab touch-none place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-white active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">
        <GripVertical size={19} aria-hidden />
      </button>
      <span className="w-6 shrink-0 text-center text-xs font-bold tabular-nums text-muted">{index + 1}</span>
      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-black/40">
        <SafeImage src={item.logo || item.poster} title={item.title} className="h-full w-full" contain={item.kind === 'live'} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{cleanTitle(item.title)}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
          <span className="rounded-full border border-border px-1.5 py-px font-semibold">{KIND_LABEL[item.kind]}</span>
          {item.group && <span className="truncate">{cleanTitle(item.group)}</span>}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
        <button type="button" onClick={() => onMove(item.id, -1)} disabled={index === 0} aria-label={`Move ${cleanTitle(item.title)} up`} className="grid h-10 w-9 place-items-center rounded-xl text-white/85 hover:bg-white/10 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><ArrowUp size={17} aria-hidden /></button>
        <button type="button" onClick={() => onMove(item.id, 1)} disabled={index === total - 1} aria-label={`Move ${cleanTitle(item.title)} down`} className="grid h-10 w-9 place-items-center rounded-xl text-white/85 hover:bg-white/10 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><ArrowDown size={17} aria-hidden /></button>
        <button type="button" onClick={() => onOpen(item)} aria-label={`Play ${cleanTitle(item.title)}`} className="grid h-10 w-10 place-items-center rounded-full bg-sky-500 text-white shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Play size={16} className="ml-0.5" aria-hidden /></button>
        <button type="button" onClick={() => onRemove(item.id)} aria-label={`Remove ${cleanTitle(item.title)} from favourites`} className="grid h-10 w-9 place-items-center rounded-xl text-red-300 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Trash2 size={16} aria-hidden /></button>
      </span>
    </div>
  );
}

export function FavouritesPage() {
  const { ready, items, favourites, reorderFavourites, toggleFavourite } = useStore();
  const navigate = useNavigate();
  const [reorderMode, setReorderMode] = useState(false);
  const favItems = useMemo(
    () => favourites.map((f) => items.find((i) => i.id === f.itemId)).filter((i): i is MediaItem => Boolean(i)),
    [favourites, items],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!ready) return <Skeleton className="h-64" />;
  if (favItems.length === 0) return <EmptyState title="No favourites yet" body="Tap the heart on any channel, movie or episode to save it here. Favourites are stored locally on this device and survive refresh when storage is available." action={<Link to="/live"><Button>Browse Live TV</Button></Link>} />;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = favItems.map((i) => i.id);
    const from = ids.indexOf(String(active.id)); const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    void reorderFavourites(arrayMove(ids, from, to));
  };
  const onMove = (itemId: string, dir: -1 | 1) => {
    const ids = favItems.map((i) => i.id);
    const from = ids.indexOf(itemId); const to = from + dir;
    if (from < 0 || to < 0 || to >= ids.length) return;
    void reorderFavourites(arrayMove(ids, from, to));
  };
  const openItem = (item: MediaItem) => navigate(`/player/${encodeURIComponent(item.id)}`);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold">Favourites</h1>
          <p className="text-sm text-muted">{favItems.length} saved item(s), stored locally. Aap ki apni tartib (order) bhi device par save rehti hai.</p>
        </div>
        <Button variant={reorderMode ? 'primary' : 'outline'} onClick={() => setReorderMode(!reorderMode)} aria-pressed={reorderMode}>
          {reorderMode ? <><Check size={16} aria-hidden />Done</> : <><ListOrdered size={16} aria-hidden />Reorder</>}
        </Button>
      </div>

      {reorderMode ? (
        <div>
          <p className="mb-3 text-xs leading-5 text-muted">Grip (⋮⋮) pakar kar drag karein, ya ↑ ↓ buttons / keyboard (handle par focus + Space + arrow keys) se tartib badlein. Har tabdeeli foran save ho jati hai — koi Save button nahi chahiye.</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}>
            <SortableContext items={favItems.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="relative grid gap-2">
                {favItems.map((item, idx) => (
                  <SortableFavRow key={item.id} item={item} index={idx} total={favItems.length} onMove={onMove} onRemove={(id) => void toggleFavourite(id)} onOpen={openItem} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      ) : (
        <>
          <h2 className="mb-2 font-bold">Channels</h2>
          <div className="mb-6 grid gap-2">
            {favItems.filter((i) => i.kind === 'live').map((i) => <ChannelRow key={i.id} item={i} />)}
            {favItems.every((i) => i.kind !== 'live') && <p className="text-sm text-muted">No favourite channels.</p>}
          </div>
          <h2 className="mb-2 font-bold">Movies & Series</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {favItems.filter((i) => i.kind !== 'live').map((i) => <MediaCard key={i.id} item={i} />)}
          </div>
        </>
      )}
    </div>
  );
}
