import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useStore } from '@/app/store';
import { Button, ConfirmDialog, EmptyState, formatTime } from '@/components/ui/ui';
import { ChannelCard, MediaCard } from '@/components/media/MediaCard';
import { isMediaLocked } from '@/lib/parental';

export function HistoryPage() {
  const { progress, items, settings, parentalUnlocked, removeProgress, clearHistory, toast } = useStore();
  const [confirm, setConfirm] = useState(false);

  const entries = progress
    .map((p) => ({ p, item: items.find((i) => i.id === p.itemId) }))
    .filter((x) => x.item && !isMediaLocked(x.item, settings, parentalUnlocked))
    .sort((a, b) => b.p.updatedAt - a.p.updatedAt);

  const recentLive = entries.filter((x) => x.item!.kind === 'live');
  const cont = entries.filter((x) => x.item!.kind !== 'live' && !x.p.completed && x.p.position > 5);
  const rest = entries.filter((x) => x.item!.kind !== 'live' && (x.p.completed || x.p.position <= 5));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold">Watch History &amp; Continue Watching</h1>
        {entries.length > 0 && <Button variant="danger" onClick={() => setConfirm(true)}>Clear all history</Button>}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No playback history yet"
          body="Live channels you watch and movies/episodes you start are remembered automatically so you can jump right back in."
          action={<Link to="/"><Button>Explore Home</Button></Link>}
        />
      ) : (
        <>
          {recentLive.length > 0 && (
            <section className="mb-7">
              <h2 className="mb-3 text-lg font-bold">Recently Watched Live Channels</h2>
              <div className="flex flex-wrap gap-2.5">
                {recentLive.slice(0, 24).map(({ item }) => (
                  <div key={item!.id} className="relative">
                    <ChannelCard item={item!} />
                    <button
                      type="button"
                      onClick={() => void removeProgress(item!.id)}
                      aria-label={`Remove ${item!.title} from history`}
                      className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/75 text-white hover:bg-red-600"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {cont.length > 0 && (
            <section className="mb-7">
              <h2 className="mb-3 text-lg font-bold">Continue Watching (VOD &amp; Series)</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {cont.map(({ p, item }) => (
                  <div key={item!.id} className="relative">
                    <MediaCard item={item!} progressPct={p.duration ? (p.position / p.duration) * 100 : 0} />
                    <p className="mt-1 text-xs text-muted">{formatTime(p.position)} / {formatTime(p.duration)}</p>
                    <button
                      type="button"
                      onClick={() => void removeProgress(item!.id)}
                      aria-label={`Remove ${item!.title} from history`}
                      className="absolute left-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/70 text-white"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {rest.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-bold">Recently Watched Movies &amp; Episodes</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {rest.map(({ item }) => (
                  <div key={item!.id} className="relative">
                    <MediaCard item={item!} />
                    <button
                      type="button"
                      onClick={() => void removeProgress(item!.id)}
                      aria-label={`Remove ${item!.title} from history`}
                      className="absolute left-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/70 text-white"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title="Clear all watch history?"
        body="All saved resume positions and recent live channel entries will be removed from this device."
        confirmLabel="Clear history"
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          await clearHistory();
          setConfirm(false);
          toast({ tone: 'success', title: 'History cleared' });
        }}
      />
    </div>
  );
}
