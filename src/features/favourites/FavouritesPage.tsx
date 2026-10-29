import { Link } from 'react-router-dom';
import { useStore } from '@/app/store';
import { Button, EmptyState, Skeleton } from '@/components/ui/ui';
import { ChannelRow, MediaCard } from '@/components/media/MediaCard';

export function FavouritesPage() {
  const { ready, items, favourites } = useStore();
  const favItems = favourites.map((f) => items.find((i) => i.id === f.itemId)).filter(Boolean);
  if (!ready) return <Skeleton className="h-64" />;
  if (favItems.length === 0) return <EmptyState title="No favourites yet" body="Tap the heart on any channel, movie or episode to save it here. Favourites are stored locally on this device and survive refresh when storage is available." action={<Link to="/live"><Button>Browse Live TV</Button></Link>} />;
  return (
    <div><h1 className="mb-1 text-2xl font-extrabold">Favourites</h1><p className="mb-4 text-sm text-muted">{favItems.length} saved item(s), stored locally. Removing a playlist also removes its favourites.</p>
      <h2 className="mb-2 font-bold">Channels</h2><div className="mb-6 grid gap-2">{favItems.filter((i) => i!.kind === 'live').map((i) => <ChannelRow key={i!.id} item={i!} />)}{favItems.every((i) => i!.kind !== 'live') && <p className="text-sm text-muted">No favourite channels.</p>}</div>
      <h2 className="mb-2 font-bold">Movies & Series</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{favItems.filter((i) => i!.kind !== 'live').map((i) => <MediaCard key={i!.id} item={i!} />)}</div>
    </div>
  );
}
