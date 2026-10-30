import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarDays, Cloud, Film, Grid2x2, Lock, MonitorPlay, Play,
  Radio, Search, Settings, Tv, X,
} from 'lucide-react';
import { useStore } from '@/app/store';
import { cleanGroup, cleanTitle } from '@/lib/display';
import { searchLibrary } from '@/lib/search';
import { isMediaLocked } from '@/lib/parental';

interface PaletteAction {
  id: string;
  label: string;
  sub: string;
  kind: 'action' | 'live' | 'movie' | 'series';
  locked?: boolean;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { items, playlists, settings, parentalUnlocked, syncCloudNow, toast } = useStore();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const enabled = useMemo(() => new Set(playlists.filter((p) => p.enabled).map((p) => p.id)), [playlists]);

  const entries = useMemo<PaletteAction[]>(() => {
    const go = (to: string) => () => { onClose(); navigate(to); };
    const baseActions: PaletteAction[] = [
      { id: 'act-mv', label: 'Multi-View 4-Screen Broadcast Wall', sub: 'Ek saath 2, 3 ya 4 Live TV channels chalayein', kind: 'action', run: go('/multiview') },
      { id: 'act-cloud', label: 'Sync Playlists with Firebase Cloud', sub: 'Xtream aur M3U playlists cloud se sync karein', kind: 'action', run: () => { onClose(); void syncCloudNow().then(({ pushed, pulled }) => toast({ tone: 'success', title: 'Firebase Cloud Synced', body: `Pushed ${pushed} · Restored ${pulled}` })).catch((e) => toast({ tone: 'error', title: 'Cloud Sync', body: e instanceof Error ? e.message : 'Sign in required' })); } },
      { id: 'act-direct', label: 'Play Any Stream URL', sub: 'HLS, DASH, MPEG-TS, FLV ya ClearKey test karein', kind: 'action', run: go('/direct') },
      { id: 'act-epg', label: 'TV Guide (EPG Timeline Matrix)', sub: 'Live schedule grid aur reminders dekhein', kind: 'action', run: go('/epg') },
      { id: 'act-pl', label: 'Playlists & Xtream Sources', sub: 'Nayi playlist jorein ya cloud vault manage karein', kind: 'action', run: go('/playlists') },
      { id: 'act-set', label: 'Settings & Parental Lock', sub: 'Audio language, Picture EQ aur PIN lock configure karein', kind: 'action', run: go('/settings') },
    ];

    if (!query.trim()) {
      const quickLive = items
        .filter((i) => i.kind === 'live' && enabled.has(i.playlistId))
        .slice(0, 6)
        .map((ch): PaletteAction => ({
          id: ch.id,
          label: cleanTitle(ch.title),
          sub: `Live TV · ${cleanGroup(ch.group)}`,
          kind: 'live',
          locked: isMediaLocked(ch, settings, parentalUnlocked),
          run: go(`/player/${encodeURIComponent(ch.id)}`),
        }));
      return [...baseActions, ...quickLive];
    }

    const q = query.trim().toLowerCase();
    const matchedActions = baseActions.filter(
      (a) => a.label.toLowerCase().includes(q) || a.sub.toLowerCase().includes(q),
    );
    const lib = searchLibrary(items, query, { enabledPlaylistIds: enabled, limitPerKind: 10 });
    const mediaRows: PaletteAction[] = lib.items.slice(0, 14).map((it) => ({
      id: it.id,
      label: cleanTitle(it.title),
      sub: `${it.kind === 'live' ? 'Live TV' : it.kind === 'movie' ? 'Movie' : 'Series'} · ${cleanGroup(it.group)}`,
      kind: it.kind,
      locked: isMediaLocked(it, settings, parentalUnlocked),
      run: go(`/player/${encodeURIComponent(it.id)}`),
    }));
    return [...matchedActions, ...mediaRows];
  }, [query, items, enabled, settings, parentalUnlocked, navigate, onClose, syncCloudNow, toast]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (entries.length ? (c + 1) % entries.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (entries.length ? (c - 1 + entries.length) % entries.length : 0)); }
    else if (e.key === 'Enter' && entries[cursor]) { e.preventDefault(); entries[cursor].run(); }
  };

  const iconFor = (e: PaletteAction) => {
    if (e.id === 'act-mv') return <Grid2x2 size={17} className="text-cyanx" />;
    if (e.id === 'act-cloud') return <Cloud size={17} className="text-emerald-300" />;
    if (e.id === 'act-direct') return <Radio size={17} className="text-sky-400" />;
    if (e.id === 'act-epg') return <CalendarDays size={17} className="text-violet-300" />;
    if (e.id === 'act-set') return <Settings size={17} className="text-amber-300" />;
    if (e.kind === 'live') return <Tv size={17} className="text-red-400" />;
    if (e.kind === 'movie') return <Film size={17} className="text-sky-300" />;
    if (e.kind === 'series') return <MonitorPlay size={17} className="text-violet-300" />;
    return <Play size={17} className="text-cyanx" />;
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/75 p-3 pt-[10vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Quick Command Palette"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-sky-500/35 bg-[#091126] shadow-card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search size={18} className="shrink-0 text-cyanx" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to any channel, movie, Multi-View, Cloud Sync… (↑↓ Enter)"
            aria-label="Command palette search"
            className="min-h-[36px] flex-1 bg-transparent text-sm text-white placeholder:text-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="nice-scroll max-h-[60vh] overflow-y-auto p-2" role="listbox">
          {entries.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Koi channel ya command match nahi hua.</p>
          ) : (
            entries.map((entry, idx) => (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={idx === cursor}
                onMouseEnter={() => setCursor(idx)}
                onClick={entry.run}
                className={`flex min-h-[50px] w-full items-center gap-3 rounded-2xl px-3.5 py-2 text-left transition ${idx === cursor ? 'bg-sky-500/20 text-white ring-1 ring-sky-400/50' : 'text-silver hover:bg-white/5'}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5">
                  {iconFor(entry)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-sm font-bold">
                    <span className="truncate">{entry.label}</span>
                    {entry.locked && <Lock size={13} className="shrink-0 text-amber-300" aria-label="PIN Locked" />}
                  </span>
                  <span className="block truncate text-xs text-muted">{entry.sub}</span>
                </span>
                <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] text-muted">↵</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-black/30 px-4 py-2 text-[11px] text-muted">
          <span>↑↓ Navigate · Enter Open · Esc Close</span>
          <span className="font-mono text-cyanx">SIRAVEX Pro Palette</span>
        </div>
      </div>
    </div>
  );
}
