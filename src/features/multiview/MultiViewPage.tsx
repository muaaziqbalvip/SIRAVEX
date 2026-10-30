import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight, ExternalLink, Grid2x2, Heart, Maximize, Minimize,
  Plus, Radio, RotateCcw, Search, Trash2, Tv, Volume2, VolumeX, X,
} from 'lucide-react';
import { useStore } from '@/app/store';
import { INITIAL_SNAPSHOT, PlaybackEngine, type PlayerSnapshot } from '@/playback/engine';
import { Button, Card, EmptyState, Input } from '@/components/ui/ui';
import { SafeImage } from '@/components/media/MediaCard';
import { PinModal } from '@/components/ui/PinModal';
import { cleanGroup, cleanTitle } from '@/lib/display';
import { sanitizeUrl } from '@/lib/security';
import { isMediaLocked } from '@/lib/parental';
import { usePageMeta } from '@/lib/seo';
import type { MediaItem } from '@/types/models';

type LayoutMode = '2' | '3' | '4';
const MV_STORAGE_KEY = 'siravex-multiview-slots-v1';

interface SlotConfig {
  itemId?: string;
  customUrl?: string;
  customTitle?: string;
}

function loadSavedSlots(): { layout: LayoutMode; slots: (SlotConfig | null)[] } {
  try {
    const raw = localStorage.getItem(MV_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { layout?: LayoutMode; slots?: (SlotConfig | null)[] };
      if (Array.isArray(parsed.slots)) {
        return {
          layout: parsed.layout === '2' || parsed.layout === '3' || parsed.layout === '4' ? parsed.layout : '4',
          slots: [parsed.slots[0] ?? null, parsed.slots[1] ?? null, parsed.slots[2] ?? null, parsed.slots[3] ?? null],
        };
      }
    }
  } catch { /* ignore */ }
  return { layout: '4', slots: [null, null, null, null] };
}

function MultiViewTile({
  index,
  item,
  audioActive,
  globalMuted,
  isPrimaryLarge,
  reloadNonce,
  onSelectAudio,
  onPickChannel,
  onSwapPrimary,
  onClear,
  onOpenFull,
}: {
  index: number;
  item: MediaItem | null;
  audioActive: boolean;
  globalMuted: boolean;
  isPrimaryLarge: boolean;
  reloadNonce: number;
  onSelectAudio: () => void;
  onPickChannel: () => void;
  onSwapPrimary: () => void;
  onClear: () => void;
  onOpenFull: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const [snap, setSnap] = useState<PlayerSnapshot>(INITIAL_SNAPSHOT);
  const { settings } = useStore();

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !item) {
      setSnap(INITIAL_SNAPSHOT);
      return;
    }
    const eng = new PlaybackEngine(video);
    engineRef.current = eng;
    const unsub = eng.subscribe(setSnap);
    video.muted = true; // start muted so all 4 tiles autoplay simultaneously without browser block!
    video.volume = settings.defaultVolume;
    void eng.load(item.url, {
      forcedFormat: item.forcedFormat,
      clearKeys: item.drmClearKeys,
      licenseUrl: item.drmLicenseUrl,
      referrer: item.referrer,
      autoplay: true,
      isLiveHint: true,
      preferredAudioLang: settings.audioLanguage || undefined,
    });
    return () => {
      unsub();
      eng.destroy();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.url, reloadNonce]);

  // Sync audio focus cleanly across tiles
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !item) return;
    const shouldMute = globalMuted || !audioActive;
    video.muted = shouldMute;
    if (!shouldMute && video.volume === 0) {
      video.volume = settings.defaultVolume || 0.8;
    }
  }, [audioActive, globalMuted, item, settings.defaultVolume]);

  if (!item) {
    return (
      <div
        className={`flex min-h-[190px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-4 text-center transition hover:border-sky-400/60 ${isPrimaryLarge ? 'lg:row-span-2 lg:min-h-[400px]' : ''}`}
      >
        <span className="mb-2 grid h-12 w-12 place-items-center rounded-2xl bg-sky-500/15 text-cyanx">
          <Plus size={22} aria-hidden />
        </span>
        <p className="text-sm font-bold text-silver">Screen #{index + 1} Empty</p>
        <p className="mt-0.5 max-w-[220px] text-xs text-muted">Live channel ya direct stream link is screen mein chunein</p>
        <Button className="mt-3 min-h-[38px] px-4 text-xs" onClick={onPickChannel}>
          Select Channel
        </Button>
      </div>
    );
  }

  return (
    <div
      onClick={onSelectAudio}
      className={`group relative flex min-h-[190px] cursor-pointer overflow-hidden rounded-2xl bg-black transition ${isPrimaryLarge ? 'lg:row-span-2 lg:min-h-[400px]' : 'aspect-video'} ${
        audioActive && !globalMuted
          ? 'ring-2 ring-cyan-400 shadow-glow'
          : 'border border-border hover:border-sky-500/50'
      }`}
    >
      <video
        ref={videoRef}
        playsInline
        muted={globalMuted || !audioActive}
        className="h-full w-full bg-black object-contain"
      />

      {/* Top HUD */}
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-1.5 bg-gradient-to-b from-black/85 to-transparent p-2.5 transition-opacity sm:opacity-95 group-hover:opacity-100">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/15 font-mono text-[11px] font-extrabold text-white">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-white">
          {cleanTitle(item.title)}
        </span>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
            audioActive && !globalMuted ? 'bg-cyan-400 text-slate-950' : 'bg-black/65 text-white/70'
          }`}
        >
          {audioActive && !globalMuted ? <Volume2 size={11} aria-hidden /> : <VolumeX size={11} aria-hidden />}
          {audioActive && !globalMuted ? 'AUDIO' : 'MUTED'}
        </span>
      </div>

      {/* Loading / Error State */}
      {(snap.state === 'loading' || snap.state === 'buffering') && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/30">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-cyan-300" />
        </div>
      )}

      {snap.state === 'error' && (
        <div
          className="absolute inset-0 z-10 grid place-items-center bg-black/85 p-3 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div>
            <p className="text-xs font-bold text-red-300">Stream error ({snap.error?.category ?? 'failed'})</p>
            <div className="mt-2 flex justify-center gap-1.5">
              <button
                type="button"
                onClick={() => void engineRef.current?.reconnectNow()}
                className="rounded-lg bg-sky-500 px-2.5 py-1 text-[11px] font-bold text-white"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onPickChannel}
                className="rounded-lg border border-white/20 px-2.5 py-1 text-[11px] font-semibold text-white"
              >
                Change
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Action Strip */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-1 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPickChannel}
            className="rounded-lg bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-500"
          >
            Change
          </button>
          <button
            type="button"
            onClick={() => void engineRef.current?.reconnectNow()}
            title="Reconnect stream"
            aria-label={`Reconnect screen ${index + 1}`}
            className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20"
          >
            <RotateCcw size={13} />
          </button>
          {index > 0 && (
            <button
              type="button"
              onClick={onSwapPrimary}
              title="Swap to Screen #1"
              aria-label="Swap to primary screen"
              className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20"
            >
              <ArrowLeftRight size={13} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {snap.resolution !== '—' && (
            <span className="hidden rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300 sm:inline">
              {snap.resolution}
            </span>
          )}
          {!item.id.startsWith('mv-custom:') && (
            <button
              type="button"
              onClick={onOpenFull}
              title="Open in single Pro Player"
              aria-label="Open in full player"
              className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-white hover:bg-sky-500"
            >
              <ExternalLink size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={onClear}
            title="Clear screen"
            aria-label={`Remove channel from screen ${index + 1}`}
            className="grid h-7 w-7 place-items-center rounded-lg bg-white/10 text-red-300 hover:bg-red-500/25"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function MultiViewPage() {
  usePageMeta('Multi-View 4-Screen Studio — SIRAVEX', 'Watch up to 4 Live TV channels simultaneously with instant audio focus switching.');
  const { items, playlists, isFavourite, settings, parentalUnlocked } = useStore();
  const navigate = useNavigate();
  const wallRef = useRef<HTMLDivElement>(null);

  const initial = useMemo(loadSavedSlots, []);
  const [layout, setLayout] = useState<LayoutMode>(initial.layout);
  const [slots, setSlots] = useState<(SlotConfig | null)[]>(initial.slots);
  const [activeAudioIdx, setActiveAudioIdx] = useState(0);
  const [globalMuted, setGlobalMuted] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [directUrl, setDirectUrl] = useState('');
  const [directTitle, setDirectTitle] = useState('');
  const [pinItem, setPinItem] = useState<{ slot: number; item: MediaItem } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(MV_STORAGE_KEY, JSON.stringify({ layout, slots })); } catch { /* ignore */ }
  }, [layout, slots]);

  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);
  const liveChannels = useMemo(
    () => items.filter((i) => i.kind === 'live' && enabled.has(i.playlistId)),
    [items, enabled],
  );

  // Auto-populate first 2 channels if user opens Multi-View for the first time with live channels loaded
  const autoSeeded = useRef(false);
  useEffect(() => {
    if (autoSeeded.current) return;
    if (slots.every((s) => s === null) && liveChannels.length > 0) {
      autoSeeded.current = true;
      const unlockedLive = liveChannels.filter((c) => !isMediaLocked(c, settings, parentalUnlocked));
      if (unlockedLive.length > 0) {
        setSlots([
          unlockedLive[0] ? { itemId: unlockedLive[0].id } : null,
          unlockedLive[1] ? { itemId: unlockedLive[1].id } : null,
          unlockedLive[2] ? { itemId: unlockedLive[2].id } : null,
          unlockedLive[3] ? { itemId: unlockedLive[3].id } : null,
        ]);
      }
    }
  }, [liveChannels, slots, settings, parentalUnlocked]);

  const visibleCount = Number(layout);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Keyboard shortcuts 1-4 to switch active audio screen, M to mute all
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input,textarea,select')) return;
      if (['1', '2', '3', '4'].includes(e.key)) {
        const idx = Number(e.key) - 1;
        if (idx < visibleCount) {
          setActiveAudioIdx(idx);
          setGlobalMuted(false);
        }
      } else if (e.key === 'm' || e.key === 'M') {
        setGlobalMuted((m) => !m);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleCount]);

  const toggleWallFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wallRef.current?.requestFullscreen();
    } catch { /* ignore */ }
  }, []);

  const resolveSlotItem = (cfg: SlotConfig | null, idx: number): MediaItem | null => {
    if (!cfg) return null;
    if (cfg.customUrl) {
      return {
        id: `mv-custom:${idx}:${cfg.customUrl}`,
        playlistId: 'direct',
        kind: 'live',
        title: cfg.customTitle || `Direct Stream #${idx + 1}`,
        url: cfg.customUrl,
        group: 'Direct Stream',
      };
    }
    if (cfg.itemId) {
      const found = items.find((i) => i.id === cfg.itemId);
      if (found && !isMediaLocked(found, settings, parentalUnlocked)) return found;
    }
    return null;
  };

  const assignChannel = (slotIdx: number, ch: MediaItem) => {
    if (isMediaLocked(ch, settings, parentalUnlocked)) {
      setPinItem({ slot: slotIdx, item: ch });
      return;
    }
    setSlots((prev) => prev.map((s, i) => (i === slotIdx ? { itemId: ch.id } : s)));
    setPickerSlot(null);
  };

  const assignDirectUrl = (slotIdx: number) => {
    const clean = sanitizeUrl(directUrl.trim());
    if (!clean) return;
    setSlots((prev) =>
      prev.map((s, i) => (i === slotIdx ? { customUrl: clean, customTitle: directTitle.trim() || undefined } : s)),
    );
    setDirectUrl('');
    setDirectTitle('');
    setPickerSlot(null);
  };

  const swapWithPrimary = (idx: number) => {
    setSlots((prev) => {
      const next = [...prev];
      const tmp = next[0];
      next[0] = next[idx];
      next[idx] = tmp;
      return next;
    });
    setActiveAudioIdx(0);
  };

  const filteredChannels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return liveChannels
      .filter((c) => (!onlyFavs || isFavourite(c.id)) && (!q || c.title.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)))
      .slice(0, 120);
  }, [liveChannels, search, onlyFavs, isFavourite]);

  const gridClass =
    layout === '2'
      ? 'grid-cols-1 md:grid-cols-2'
      : layout === '3'
        ? 'grid-cols-1 lg:grid-cols-3'
        : 'grid-cols-1 sm:grid-cols-2';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-500/15 text-cyanx shadow-glow">
            <Grid2x2 size={22} aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-extrabold sm:text-2xl">Multi-View Broadcast Studio</h1>
            <p className="text-xs text-muted sm:text-sm">
              Ek saath 2, 3 ya 4 Live matches aur news channels dekhein — kisi bhi screen par click karein ya <code className="text-cyanx">1–4</code> dabayein sound switch karne ke liye.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {([
            ['2', '2-Split'],
            ['3', '1+2 Studio'],
            ['4', '4-Quad'],
          ] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setLayout(m);
                if (activeAudioIdx >= Number(m)) setActiveAudioIdx(0);
              }}
              aria-pressed={layout === m}
              className={`min-h-[38px] rounded-full px-3.5 text-xs font-extrabold transition ${
                layout === m ? 'bg-sky-500 text-white shadow-glow' : 'border border-border bg-card text-silver'
              }`}
            >
              {label}
            </button>
          ))}
          <Button variant="outline" className="min-h-[38px] px-3 text-xs" onClick={() => setGlobalMuted((m) => !m)}>
            {globalMuted ? <VolumeX size={15} aria-hidden /> : <Volume2 size={15} aria-hidden />}
            {globalMuted ? 'Unmute Active' : 'Mute All'}
          </Button>
          <Button variant="outline" className="min-h-[38px] px-3 text-xs" onClick={() => setReloadNonce((n) => n + 1)}>
            <RotateCcw size={15} aria-hidden />Reload All
          </Button>
          <Button className="min-h-[38px] px-3 text-xs" onClick={() => void toggleWallFullscreen()}>
            {isFullscreen ? <Minimize size={15} aria-hidden /> : <Maximize size={15} aria-hidden />}
            Wall Fullscreen
          </Button>
        </div>
      </div>

      {playlists.length === 0 && slots.every((s) => !s) ? (
        <EmptyState
          title="Multi-View Studio Ready"
          body="Apni Xtream ya M3U playlist add karein (ya har slot mein direct stream URL lagayein) taake 4 channels ek saath live chal sakein."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/playlists"><Button>Add Playlist / Xtream</Button></Link>
              <Button variant="outline" onClick={() => setPickerSlot(0)}>Paste Direct Stream URL</Button>
            </div>
          }
        />
      ) : (
        <div
          ref={wallRef}
          className={`grid gap-2.5 ${gridClass} ${isFullscreen ? 'h-screen w-screen items-center bg-black p-3' : ''}`}
        >
          {Array.from({ length: visibleCount }, (_, idx) => {
            const resolved = resolveSlotItem(slots[idx], idx);
            const isPrimaryLarge = layout === '3' && idx === 0;
            return (
              <div key={idx} className={isPrimaryLarge ? 'lg:col-span-2 lg:row-span-2' : ''}>
                <MultiViewTile
                  index={idx}
                  item={resolved}
                  audioActive={activeAudioIdx === idx}
                  globalMuted={globalMuted}
                  isPrimaryLarge={isPrimaryLarge}
                  reloadNonce={reloadNonce}
                  onSelectAudio={() => {
                    setActiveAudioIdx(idx);
                    setGlobalMuted(false);
                  }}
                  onPickChannel={() => setPickerSlot(idx)}
                  onSwapPrimary={() => swapWithPrimary(idx)}
                  onClear={() => setSlots((prev) => prev.map((s, i) => (i === idx ? null : s)))}
                  onOpenFull={() => resolved && navigate(`/player/${encodeURIComponent(resolved.id)}`)}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Channel Picker Drawer/Modal */}
      {pickerSlot !== null && (
        <div
          className="fixed inset-0 z-[75] grid place-items-center bg-black/75 p-3 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Select channel for screen ${pickerSlot + 1}`}
          onClick={() => setPickerSlot(null)}
        >
          <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <Card className="flex max-h-[82vh] w-full flex-col overflow-hidden p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-extrabold">
                <Tv size={18} className="text-cyanx" aria-hidden />
                Select Stream for Screen #{pickerSlot + 1}
              </h2>
              <button
                type="button"
                onClick={() => setPickerSlot(null)}
                aria-label="Close channel picker"
                className="grid h-9 w-9 place-items-center rounded-full bg-panel text-silver hover:bg-white/10"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${liveChannels.length} live channels…`}
                  autoFocus
                  className="min-h-[42px] w-full rounded-xl border border-border bg-ink pl-9 pr-3 text-sm focus:border-sky-400 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onClick={() => setOnlyFavs(!onlyFavs)}
                aria-pressed={onlyFavs}
                className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-xl px-3 text-xs font-bold ${
                  onlyFavs ? 'bg-red-500/20 text-red-300 ring-1 ring-red-400/40' : 'border border-border bg-panel text-silver'
                }`}
              >
                <Heart size={14} className={onlyFavs ? 'fill-red-400 text-red-400' : ''} />
                Favourites
              </button>
            </div>

            <div className="nice-scroll min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-ink/60 p-1.5">
              {filteredChannels.length === 0 ? (
                <p className="p-6 text-center text-xs text-muted">Koi live channel nahi mila — neeche direct stream URL bhi paste kar sakte hain.</p>
              ) : (
                <div className="grid gap-1">
                  {filteredChannels.map((ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => assignChannel(pickerSlot, ch)}
                      className="flex min-h-[46px] w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left hover:bg-white/10"
                    >
                      <span className="grid h-9 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-panel p-1">
                        <SafeImage src={ch.logo} title={ch.title} contain className="max-h-full max-w-full" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-silver">{cleanTitle(ch.title)}</span>
                        <span className="block truncate text-[11px] text-muted">{cleanGroup(ch.group)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <details className="mt-3 rounded-xl border border-border bg-panel p-3">
              <summary className="cursor-pointer text-xs font-bold text-cyanx">
                <Radio size={13} className="mr-1 inline" aria-hidden />
                Ya koi Direct Stream URL (.m3u8 / .mpd / .ts) lagayein
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                <Input
                  value={directUrl}
                  onChange={(e) => setDirectUrl(e.target.value)}
                  placeholder="https://…/stream.m3u8"
                  inputMode="url"
                />
                <Input
                  value={directTitle}
                  onChange={(e) => setDirectTitle(e.target.value)}
                  placeholder="Label (optional)"
                />
                <Button onClick={() => assignDirectUrl(pickerSlot)} disabled={!directUrl.trim()}>
                  Load
                </Button>
              </div>
            </details>
          </Card>
          </div>
        </div>
      )}

      <PinModal
        open={Boolean(pinItem)}
        onClose={() => setPinItem(null)}
        onSuccess={() => {
          if (pinItem) {
            setSlots((prev) => prev.map((s, i) => (i === pinItem.slot ? { itemId: pinItem.item.id } : s)));
            setPickerSlot(null);
          }
        }}
      />
    </div>
  );
}
