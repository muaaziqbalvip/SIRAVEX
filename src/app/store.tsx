import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  AppSettings,
  EpgProgramme,
  EpgReminder,
  Favourite,
  MediaItem,
  PlaybackDiagnostic,
  PlaylistSource,
  WatchProgress,
} from '@/types/models';
import { DEFAULT_SETTINGS } from '@/types/models';
import { parseM3U, buildDemoPlaylistText } from '@/services/playlist/m3u';
import { parseXmltv } from '@/services/epg/xmltv';
import { connectXtream, fetchSeriesEpisodes, fetchShortEpg, fetchXtreamEpg, type XtreamCreds } from '@/services/xtream/xtream';
import * as db from '@/services/storage/db';
import { downloadJson, redactUrl, sanitizeUrl, validatePlaylistFile } from '@/lib/security';
import { applyFavouriteOrder, nextSortOrder, sortFavourites } from '@/lib/favourites-order';
import { useAuth } from '@/services/firebase/AuthContext';
import {
  deleteCloudPlaylist,
  fetchCloudPlaylists,
  fetchCloudPreferences,
  MAX_CLOUD_M3U_CHARS,
  saveCloudPlaylist,
  saveCloudPreferences,
} from '@/services/firebase/vault';
import { verifyParentalPin } from '@/lib/parental';

const SETTINGS_KEY = 'siravex-settings-v1';
const REMINDERS_KEY = 'siravex-epg-reminders-v1';

export type CloudSyncState = 'idle' | 'syncing' | 'synced' | 'error';

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: 'success' | 'error' | 'info';
  actionTo?: string;
  actionLabel?: string;
}

export interface ImportPreview {
  name: string;
  items: Omit<MediaItem, 'id' | 'playlistId'>[];
  warnings: string[];
  errors: string[];
  total: number;
  epgCount?: number;
  accountNote?: string;
  rawText?: string;
}

interface Store {
  ready: boolean;
  storageError: string | null;
  settings: AppSettings;
  updateSettings: (p: Partial<AppSettings>) => void;
  resetSettings: () => void;
  playlists: PlaylistSource[];
  items: MediaItem[];
  programmes: EpgProgramme[];
  favourites: Favourite[];
  progress: WatchProgress[];
  diagnostics: PlaybackDiagnostic[];
  toasts: Toast[];
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  previewFile: (file: File, name: string) => Promise<ImportPreview>;
  commitImport: (
    name: string,
    parsed: ImportPreview,
    type: PlaylistSource['type'],
    opts?: { url?: string; server?: string; username?: string; password?: string; remember?: boolean },
  ) => Promise<void>;
  importDemo: () => Promise<void>;
  importUrl: (name: string, url: string) => Promise<ImportPreview>;
  importXtream: (name: string, creds: XtreamCreds) => Promise<ImportPreview>;
  refreshXtreamEpg: (playlistId: string, password?: string) => Promise<number>;
  loadSeriesEpisodes: (item: MediaItem, password?: string) => Promise<number>;
  loadShortEpg: (item: MediaItem, password?: string) => Promise<number>;
  importEpg: (file: File) => Promise<{ count: number; warnings: string[] }>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  togglePlaylist: (id: string) => Promise<void>;
  setDefaultPlaylist: (id: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  refreshPlaylist: (id: string) => Promise<void>;
  hydrateCloudPlaylist: (id: string, password?: string) => Promise<number>;
  toggleFavourite: (itemId: string) => Promise<void>;
  reorderFavourites: (orderedItemIds: string[]) => Promise<void>;
  isFavourite: (itemId: string) => boolean;
  saveProgress: (itemId: string, position: number, duration: number) => void;
  recordLiveWatch: (itemId: string) => void;
  previousLiveId: string | null;
  removeProgress: (itemId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  logDiagnostic: (category: string, message: string, url?: string) => Promise<void>;
  clearLocalData: () => Promise<void>;
  exportSettings: () => void;
  /** Firebase Cloud Vault Sync */
  cloudSyncState: CloudSyncState;
  lastCloudSyncAt: number | null;
  syncCloudNow: () => Promise<{ pushed: number; pulled: number }>;
  /** Parental Controls */
  parentalUnlocked: boolean;
  unlockParental: (pin: string) => Promise<boolean>;
  lockParentalNow: () => void;
  toggleGroupLock: (groupName: string) => void;
  toggleItemLock: (itemId: string) => void;
  /** EPG Reminders */
  reminders: EpgReminder[];
  toggleReminder: (prog: EpgProgramme, channel?: MediaItem) => void;
  hasReminder: (programmeId: string) => boolean;
}

const Ctx = createContext<Store | null>(null);

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch { /* private mode */ }
  return DEFAULT_SETTINGS;
}

function loadReminders(): EpgReminder[] {
  try {
    const raw = localStorage.getItem(REMINDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EpgReminder[];
    const cutoff = Date.now() - 2 * 3600_000;
    return Array.isArray(parsed) ? parsed.filter((r) => r && r.start > cutoff) : [];
  } catch {
    return [];
  }
}

async function fetchRemoteM3uText(clean: string): Promise<string> {
  const isMixedHttp = typeof window !== 'undefined' && window.location?.protocol === 'https:' && /^http:\/\//i.test(clean);
  const relayUrl = `/api/relay?u=${encodeURIComponent(clean)}&raw=1`;
  const attempts = isMixedHttp ? [relayUrl] : [clean, relayUrl];
  let text: string | null = null;
  let lastErr: unknown = null;
  for (const candidate of attempts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 22000);
    try {
      const res = await fetch(candidate, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}.`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 15 * 1024 * 1024) throw new Error('Playlist response exceeds the 15 MB safety limit.');
      text = new TextDecoder().decode(buf);
      break;
    } catch (e) {
      lastErr = e;
      if (e instanceof Error && /exceeds the 15 MB|HTTP (401|403|404)/.test(e.message)) break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (text === null) {
    if (lastErr instanceof DOMException && lastErr.name === 'AbortError') throw new Error('Request timed out after 22 seconds.');
    if (lastErr instanceof Error && /exceeds the 15 MB|HTTP \d+/.test(lastErr.message)) throw lastErr;
    throw new Error('Could not fetch that URL even via relay (commonly provider IP/UA blocking). Download the playlist file from your provider and use local file import instead.');
  }
  return text;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [playlists, setPlaylists] = useState<PlaylistSource[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [programmes, setProgrammes] = useState<EpgProgramme[]>([]);
  const [favourites, setFavourites] = useState<Favourite[]>([]);
  const [progress, setProgress] = useState<WatchProgress[]>([]);
  const [diagnostics, setDiagnostics] = useState<PlaybackDiagnostic[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [cloudSyncState, setCloudSyncState] = useState<CloudSyncState>('idle');
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<number | null>(null);
  const [parentalUnlockedUntil, setParentalUnlockedUntil] = useState<number>(0);
  const [reminders, setReminders] = useState<EpgReminder[]>(loadReminders);
  const [previousLiveId, setPreviousLiveId] = useState<string | null>(null);
  const currentLiveIdRef = useRef<string | null>(null);

  const progressTimer = useRef<number | null>(null);
  const prefSyncTimer = useRef<number | null>(null);
  const progressRef = useRef<Map<string, WatchProgress>>(new Map());
  const pendingEpgRef = useRef<Map<string, Omit<EpgProgramme, 'id' | 'playlistId'>[]>>(new Map());
  const playlistsRef = useRef<PlaylistSource[]>(playlists);
  playlistsRef.current = playlists;
  const itemsRef = useRef<MediaItem[]>(items);
  itemsRef.current = items;
  const favouritesRef = useRef<Favourite[]>(favourites);
  favouritesRef.current = favourites;
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;
  const syncedUidRef = useRef<string | null>(null);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 6500);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((p) => p.filter((x) => x.id !== id)), []);

  useEffect(() => {
    db.loadAll()
      .then((d) => {
        setPlaylists(d.playlists);
        setItems(d.items);
        setProgrammes(d.programmes);
        setFavourites(d.favourites);
        setDiagnostics(d.diagnostics);
        setProgress(d.progress);
        d.progress.forEach((p) => progressRef.current.set(p.itemId, p));
      })
      .catch(() => setStorageError('Local storage (IndexedDB) is unavailable. The app still works, but playlists will not survive a refresh in this browser mode.'))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    const root = document.documentElement;
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('dark', dark);
    root.dataset.accent = settings.accent;
    root.dataset.density = settings.density;
    root.style.setProperty(
      '--svx-accent',
      settings.accent === 'violet' ? '#8b5cf6' : settings.accent === 'emerald' ? '#10b981' : settings.accent === 'cyan' ? '#22d3ee' : '#0ea5e9',
    );
    document.body.classList.toggle('reduce-motion', settings.reducedMotion);
  }, [settings]);

  useEffect(() => {
    try { localStorage.setItem(REMINDERS_KEY, JSON.stringify(reminders)); } catch { /* ignore */ }
  }, [reminders]);

  // EPG Programme Reminder Watcher
  useEffect(() => {
    if (reminders.length === 0) return;
    const check = () => {
      const now = Date.now();
      let changed = false;
      const next = reminders.map((r) => {
        if (!r.notified && now >= r.start - 60_000 && now <= r.start + 15 * 60_000) {
          changed = true;
          toast({
            tone: 'info',
            title: `Reminder: ${r.title}`,
            body: `Starting on ${r.channelTitle}`,
            actionTo: r.channelItemId ? `/player/${encodeURIComponent(r.channelItemId)}` : '/epg',
            actionLabel: 'Watch Now',
          });
          return { ...r, notified: true };
        }
        return r;
      });
      if (changed) setReminders(next);
    };
    check();
    const iv = window.setInterval(check, 20_000);
    return () => window.clearInterval(iv);
  }, [reminders, toast]);

  const scheduleCloudPrefPush = useCallback((nextFavs: Favourite[], nextSettings: AppSettings) => {
    if (!user?.uid || !nextSettings.cloudSyncEnabled) return;
    if (prefSyncTimer.current) window.clearTimeout(prefSyncTimer.current);
    const uid = user.uid;
    prefSyncTimer.current = window.setTimeout(() => {
      void saveCloudPreferences(uid, nextFavs, nextSettings);
    }, 1200);
  }, [user?.uid]);

  const updateSettings = useCallback((p: Partial<AppSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...p };
      scheduleCloudPrefPush(favouritesRef.current, next);
      return next;
    });
  }, [scheduleCloudPrefPush]);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    scheduleCloudPrefPush(favouritesRef.current, DEFAULT_SETTINGS);
  }, [scheduleCloudPrefPush]);

  const logDiagnostic = useCallback(async (category: string, message: string, url?: string) => {
    const diag: PlaybackDiagnostic = { id: db.uid('diag'), at: Date.now(), category, message: message.slice(0, 300), urlHost: url ? redactUrl(url) : undefined };
    setDiagnostics((p) => (p[0]?.message === diag.message ? p : [diag, ...p].slice(0, 100)));
    try { await db.addDiagnostic(diag); } catch { /* ignore */ }
  }, []);

  const persistPlaylistItems = useCallback(async (playlist: PlaylistSource, parsedItems: Omit<MediaItem, 'id' | 'playlistId'>[]) => {
    const full: MediaItem[] = parsedItems.map((it, i) => ({ ...it, id: `${playlist.id}:${i}:${it.title.slice(0, 32)}`, playlistId: playlist.id }));
    try { await db.putPlaylist(playlist); await db.replaceItems(playlist.id, full); } catch { setStorageError('Could not save to IndexedDB (quota or private browsing). Items are kept for this session only.'); }
    setPlaylists((p) => [...p.filter((x) => x.id !== playlist.id), playlist]);
    setItems((p) => [...p.filter((x) => x.playlistId !== playlist.id), ...full]);
    return full;
  }, []);

  const persistProgrammes = useCallback(async (playlistId: string, raw: Omit<EpgProgramme, 'id' | 'playlistId'>[]) => {
    const full: EpgProgramme[] = raw.map((p, i) => ({ ...p, id: `epg:${playlistId}:${i}:${p.channelId}`, playlistId }));
    try { await db.replaceProgrammesForPlaylist(playlistId, full); } catch { /* session only */ }
    setProgrammes((prev) => [...prev.filter((p) => p.playlistId !== playlistId), ...full]);
    return full.length;
  }, []);

  const pushPlaylistToCloudIfEnabled = useCallback(async (playlist: PlaylistSource) => {
    if (!user?.uid || !settingsRef.current.cloudSyncEnabled || playlist.type === 'demo') return;
    const ok = await saveCloudPlaylist(user.uid, playlist);
    if (ok) {
      const marked: PlaylistSource = { ...playlist, cloudSynced: true, cloudUpdatedAt: Date.now() };
      setPlaylists((all) => all.map((x) => (x.id === playlist.id ? marked : x)));
      try { await db.putPlaylist(marked); } catch { /* ignore */ }
      setCloudSyncState('synced');
      setLastCloudSyncAt(Date.now());
    }
  }, [user?.uid]);

  /** Hydrates items (and EPG for Xtream) for a cloud-pulled playlist source. */
  const hydrateSourceInternal = useCallback(async (src: PlaylistSource, overridePass?: string): Promise<number> => {
    if (src.type === 'file' && src.rawM3uText) {
      const parsed = parseM3U(src.rawM3uText);
      const updated: PlaylistSource = { ...src, itemCount: parsed.items.length, lastImportedAt: Date.now(), lastError: undefined };
      await persistPlaylistItems(updated, parsed.items);
      return parsed.items.length;
    }
    if (src.type === 'url' && src.url) {
      const text = await fetchRemoteM3uText(src.url);
      const parsed = parseM3U(text);
      const updated: PlaylistSource = { ...src, itemCount: parsed.items.length, lastImportedAt: Date.now(), lastError: undefined };
      await persistPlaylistItems(updated, parsed.items);
      return parsed.items.length;
    }
    if (src.type === 'xtream' && src.server && src.username) {
      const pw = overridePass ?? src.password;
      if (!pw) {
        // Save metadata shell so user can enter password on this device if they chose not to store password
        await persistPlaylistItems(src, []);
        return 0;
      }
      const res = await connectXtream({ server: src.server, username: src.username, password: pw });
      const updated: PlaylistSource = {
        ...src,
        password: overridePass ? (src.password ? overridePass : undefined) : src.password,
        hasPassword: true,
        itemCount: res.items.length,
        lastImportedAt: Date.now(),
        lastEpgAt: res.programmes.length ? Date.now() : src.lastEpgAt,
        lastError: undefined,
      };
      await persistPlaylistItems(updated, res.items);
      if (res.programmes.length) await persistProgrammes(src.id, res.programmes);
      return res.items.length;
    }
    return 0;
  }, [persistPlaylistItems, persistProgrammes]);

  const hydrateCloudPlaylist = useCallback(async (id: string, password?: string): Promise<number> => {
    const p = playlistsRef.current.find((x) => x.id === id);
    if (!p) throw new Error('Playlist not found.');
    return hydrateSourceInternal(p, password);
  }, [hydrateSourceInternal]);

  const syncCloudNow = useCallback(async (): Promise<{ pushed: number; pulled: number }> => {
    if (!user?.uid) throw new Error('Sign in first to sync playlists with Firebase Cloud.');
    setCloudSyncState('syncing');
    const uid = user.uid;
    let pushed = 0;
    let pulled = 0;
    try {
      const [remotePlaylists, remotePrefs] = await Promise.all([
        fetchCloudPlaylists(uid),
        fetchCloudPreferences(uid),
      ]);

      const remoteMap = new Map(remotePlaylists.map((r) => [r.id, r]));
      const localList = playlistsRef.current.filter((p) => p.type !== 'demo');

      // 1. Push local playlists not yet in cloud (or modified more recently)
      for (const loc of localList) {
        const rem = remoteMap.get(loc.id);
        if (!rem || !loc.cloudSynced) {
          const ok = await saveCloudPlaylist(uid, loc);
          if (ok) {
            pushed++;
            const marked: PlaylistSource = { ...loc, cloudSynced: true, cloudUpdatedAt: Date.now() };
            setPlaylists((all) => all.map((x) => (x.id === loc.id ? marked : x)));
            try { await db.putPlaylist(marked); } catch { /* ignore */ }
          }
        } else if (!loc.cloudSynced) {
          const marked: PlaylistSource = { ...loc, cloudSynced: true };
          setPlaylists((all) => all.map((x) => (x.id === loc.id ? marked : x)));
          try { await db.putPlaylist(marked); } catch { /* ignore */ }
        }
      }

      // 2. Pull cloud playlists missing on this device & auto-hydrate their channels!
      const localIds = new Set(playlistsRef.current.map((p) => p.id));
      for (const rem of remotePlaylists) {
        const existingItemsCount = itemsRef.current.filter((i) => i.playlistId === rem.id).length;
        if (!localIds.has(rem.id) || (existingItemsCount === 0 && rem.itemCount > 0)) {
          try {
            await hydrateSourceInternal(rem);
            pulled++;
          } catch {
            // Keep source metadata locally even if upstream provider is temporarily unreachable
            const fallbackSrc: PlaylistSource = { ...rem, lastError: 'Tap Refresh / Load Channels to fetch streams' };
            try { await db.putPlaylist(fallbackSrc); } catch { /* ignore */ }
            setPlaylists((all) => [...all.filter((x) => x.id !== fallbackSrc.id), fallbackSrc]);
            pulled++;
          }
        }
      }

      // 3. Merge Favourites & Settings
      if (remotePrefs?.favourites?.length) {
        const curFavs = favouritesRef.current;
        const curIds = new Set(curFavs.map((f) => f.itemId));
        const addedFavs = remotePrefs.favourites.filter((rf) => rf?.itemId && !curIds.has(rf.itemId));
        if (addedFavs.length > 0) {
          const merged = sortFavourites([...curFavs, ...addedFavs]);
          setFavourites(merged);
          try { await Promise.all(addedFavs.map((f) => db.putFavourite(f))); } catch { /* ignore */ }
        }
      }
      await saveCloudPreferences(uid, favouritesRef.current, settingsRef.current);

      setCloudSyncState('synced');
      setLastCloudSyncAt(Date.now());
      return { pushed, pulled };
    } catch (err) {
      setCloudSyncState('error');
      throw err;
    }
  }, [user?.uid, hydrateSourceInternal]);

  // Auto-sync once when ready + signed-in user becomes available
  useEffect(() => {
    if (!ready) return;
    if (!user?.uid) {
      syncedUidRef.current = null;
      setCloudSyncState('idle');
      return;
    }
    if (!settings.cloudSyncEnabled) return;
    if (syncedUidRef.current === user.uid) return;
    syncedUidRef.current = user.uid;
    void syncCloudNow()
      .then(({ pulled }) => {
        if (pulled > 0) {
          toast({
            tone: 'success',
            title: 'Cloud Playlists Restored',
            body: `${pulled} playlist source(s) synced from your Firebase Vault.`,
          });
        }
      })
      .catch(() => undefined);
  }, [ready, user?.uid, settings.cloudSyncEnabled, syncCloudNow, toast]);

  const previewFile = useCallback(async (file: File, name: string): Promise<ImportPreview> => {
    const err = validatePlaylistFile(file);
    if (err) throw new Error(err);
    const text = await file.text();
    const parsed = parseM3U(text);
    return {
      name: name || file.name.replace(/\.(m3u8?|txt)$/i, ''),
      items: parsed.items,
      warnings: parsed.report.warnings,
      errors: parsed.report.errors,
      total: parsed.report.total,
      rawText: text.length <= MAX_CLOUD_M3U_CHARS ? text : undefined,
    };
  }, []);

  const commitImport = useCallback(async (
    name: string,
    parsed: ImportPreview,
    type: PlaylistSource['type'],
    opts?: { url?: string; server?: string; username?: string; password?: string; remember?: boolean },
  ) => {
    if (parsed.errors.length && parsed.items.length === 0) throw new Error(parsed.errors[0]);
    const playlist: PlaylistSource = {
      id: db.uid('pl'),
      name: name.trim() || 'My Playlist',
      type,
      url: opts?.url,
      server: opts?.server,
      username: opts?.username,
      password: opts?.remember ? opts?.password : undefined,
      hasPassword: !!opts?.password,
      rawM3uText: type === 'file' ? parsed.rawText : undefined,
      enabled: true,
      isDefault: playlists.length === 0,
      itemCount: parsed.items.length,
      createdAt: Date.now(),
      lastImportedAt: Date.now(),
      lastEpgAt: parsed.epgCount ? Date.now() : undefined,
    };
    await persistPlaylistItems(playlist, parsed.items);
    const pending = pendingEpgRef.current.get(parsed.name);
    if (pending?.length) {
      await persistProgrammes(playlist.id, pending);
      pendingEpgRef.current.delete(parsed.name);
    }
    void pushPlaylistToCloudIfEnabled(playlist);
  }, [persistPlaylistItems, persistProgrammes, playlists.length, pushPlaylistToCloudIfEnabled]);

  const importDemo = useCallback(async () => {
    for (const old of playlists.filter((x) => x.type === 'demo')) {
      try { await db.deletePlaylistCascade(old.id); } catch { /* ignore */ }
    }
    if (playlists.some((x) => x.type === 'demo')) {
      setPlaylists((p) => p.filter((x) => x.type !== 'demo'));
      setItems((p) => p.filter((i) => !playlists.some((x) => x.type === 'demo' && x.id === i.playlistId)));
    }
    const parsed = parseM3U(buildDemoPlaylistText());
    await commitImport('Demo samples (labelled demo)', { name: 'Demo', items: parsed.items, warnings: [], errors: [], total: parsed.items.length }, 'demo');
  }, [commitImport, playlists]);

  const importUrl = useCallback(async (name: string, url: string): Promise<ImportPreview> => {
    const clean = sanitizeUrl(url);
    if (!clean) throw new Error('Enter a valid http(s) playlist URL.');
    const text = await fetchRemoteM3uText(clean);
    const parsed = parseM3U(text);
    return { name: name || 'Remote playlist', items: parsed.items, warnings: parsed.report.warnings, errors: parsed.report.errors, total: parsed.report.total };
  }, []);

  const importXtream = useCallback(async (name: string, creds: XtreamCreds): Promise<ImportPreview> => {
    const result = await connectXtream(creds);
    const preview: ImportPreview = {
      name: name || 'Xtream playlist',
      items: result.items,
      warnings: result.warnings,
      errors: result.items.length === 0 ? ['No live, movie or series items were returned by the provider.'] : [],
      total: result.items.length,
      epgCount: result.programmes.length,
      accountNote: result.accountNote,
    };
    if (result.programmes.length) pendingEpgRef.current.set(preview.name, result.programmes);
    return preview;
  }, []);

  const refreshXtreamEpg = useCallback(async (playlistId: string, password?: string): Promise<number> => {
    const p = playlists.find((x) => x.id === playlistId);
    if (!p?.server || !p.username) throw new Error('This source has no saved Xtream server/username. Reconnect it from Add Source.');
    const pass = password ?? p.password;
    if (!pass) throw new Error('Enter the account password to fetch EPG (it was not saved on this device).');
    const { programmes: progs } = await fetchXtreamEpg({ server: p.server, username: p.username, password: pass });
    if (progs.length === 0) throw new Error('Provider XMLTV returned no programmes.');
    const count = await persistProgrammes(playlistId, progs);
    const updated = { ...p, lastEpgAt: Date.now() };
    setPlaylists((all) => all.map((x) => (x.id === playlistId ? updated : x)));
    try { await db.putPlaylist(updated); } catch { /* ignore */ }
    void pushPlaylistToCloudIfEnabled(updated);
    return count;
  }, [playlists, persistProgrammes, pushPlaylistToCloudIfEnabled]);

  const loadSeriesEpisodes = useCallback(async (item: MediaItem, password?: string): Promise<number> => {
    const p = playlists.find((x) => x.id === item.playlistId);
    if (!item.seriesId) throw new Error('This series has no provider series id.');
    if (!p?.server || !p.username) throw new Error('Episodes load on demand only for Xtream sources. Re-import this series via Xtream to load episodes.');
    const pass = password ?? p.password;
    if (!pass) throw new Error('Enter the account password to load episodes (it was not saved on this device).');
    const eps = await fetchSeriesEpisodes({ server: p.server, username: p.username, password: pass }, item.seriesId, { title: item.seriesTitle ?? item.title, group: item.group, poster: item.poster ?? item.logo });
    if (eps.length === 0) throw new Error('Provider returned no episodes for this series.');
    const startIdx = items.filter((i) => i.playlistId === p.id).length;
    const full: MediaItem[] = eps.map((ep, i) => ({ ...ep, id: `${p.id}:ep${item.seriesId}:${startIdx + i}`, playlistId: p.id }));
    setItems((prev) => [...prev.filter((x) => x.id !== item.id), ...full]);
    try {
      const all = [...items.filter((x) => x.id !== item.id), ...full];
      await db.replaceItems(p.id, all.filter((x) => x.playlistId === p.id));
    } catch { /* session only */ }
    return full.length;
  }, [playlists, items]);

  const loadShortEpg = useCallback(async (item: MediaItem, password?: string): Promise<number> => {
    const p = playlists.find((x) => x.id === item.playlistId);
    if (!item.streamId) throw new Error('Is channel ka provider stream id maujood nahi.');
    if (!p?.server || !p.username) throw new Error('Short EPG sirf Xtream sources ke liye hai. Source ko Xtream tab se reconnect karein.');
    const pass = password ?? p.password;
    if (!pass) throw new Error('Account password darj karein (device par save nahi tha).');
    const rows = await fetchShortEpg({ server: p.server, username: p.username, password: pass }, item.streamId, 12);
    if (rows.length === 0) throw new Error('Provider ne is channel ke liye koi EPG listing nahi bheji.');
    const channelId = item.tvgId ?? item.id;
    const mapped = rows.map((r) => ({ channelId, title: r.title, description: r.description, start: r.start, end: r.end }));
    const merged = [
      ...programmes.filter((pr) => !(pr.playlistId === item.playlistId && pr.channelId === channelId)),
      ...mapped.map((m, i) => ({ ...m, id: `epg:${item.playlistId}:${i}:${channelId}`, playlistId: item.playlistId })),
    ];
    try { await db.replaceProgrammesForPlaylist(item.playlistId, merged.filter((pr) => pr.playlistId === item.playlistId)); } catch { /* session only */ }
    setProgrammes(merged);
    return rows.length;
  }, [playlists, programmes]);

  const importEpg = useCallback(async (file: File): Promise<{ count: number; warnings: string[] }> => {
    if (file.size > 25 * 1024 * 1024) throw new Error('EPG file exceeds the 25 MB safety limit.');
    const text = await file.text();
    const parsed = parseXmltv(text);
    if (parsed.warnings.length && parsed.programmes.length === 0) throw new Error(parsed.warnings[0]);
    const count = await persistProgrammes('file-epg', parsed.programmes);
    return { count, warnings: parsed.warnings };
  }, [persistProgrammes]);

  const renamePlaylist = useCallback(async (id: string, name: string) => {
    const p = playlists.find((x) => x.id === id);
    if (!p || !name.trim()) return;
    const next = { ...p, name: name.trim() };
    setPlaylists((all) => all.map((x) => (x.id === id ? next : x)));
    try { await db.putPlaylist(next); } catch { /* ignore */ }
    void pushPlaylistToCloudIfEnabled(next);
  }, [playlists, pushPlaylistToCloudIfEnabled]);

  const togglePlaylist = useCallback(async (id: string) => {
    const p = playlists.find((x) => x.id === id);
    if (!p) return;
    const next = { ...p, enabled: !p.enabled };
    setPlaylists((all) => all.map((x) => (x.id === id ? next : x)));
    try { await db.putPlaylist(next); } catch { /* ignore */ }
    void pushPlaylistToCloudIfEnabled(next);
  }, [playlists, pushPlaylistToCloudIfEnabled]);

  const setDefaultPlaylist = useCallback(async (id: string) => {
    const next = playlists.map((x) => ({ ...x, isDefault: x.id === id }));
    setPlaylists(next);
    try { for (const p of next) await db.putPlaylist(p); } catch { /* ignore */ }
    const target = next.find((x) => x.id === id);
    if (target) void pushPlaylistToCloudIfEnabled(target);
  }, [playlists, pushPlaylistToCloudIfEnabled]);

  const deletePlaylist = useCallback(async (id: string) => {
    setPlaylists((p) => p.filter((x) => x.id !== id));
    setItems((p) => p.filter((x) => x.playlistId !== id));
    setProgrammes((p) => p.filter((x) => x.playlistId !== id));
    try { await db.deletePlaylistCascade(id); } catch { /* ignore */ }
    if (user?.uid && settingsRef.current.cloudSyncEnabled) {
      void deleteCloudPlaylist(user.uid, id);
    }
  }, [user?.uid]);

  const refreshPlaylist = useCallback(async (id: string) => {
    const p = playlists.find((x) => x.id === id);
    if (!p) return;
    if (p.type === 'xtream') {
      if (p.password && p.server && p.username) {
        await hydrateSourceInternal(p, p.password);
        return;
      }
      throw new Error('Xtream sources without saved password refresh by entering password or reconnecting. Use “Fetch EPG” for guide-only refresh.');
    }
    if (p.type === 'file' && p.rawM3uText) {
      await hydrateSourceInternal(p);
      return;
    }
    if (!p.url) {
      toast({ tone: 'info', title: 'Nothing to refresh', body: 'File and demo playlists without stored text are refreshed by importing the file again.' });
      return;
    }
    const parsed = await importUrl(p.name, p.url);
    const next: PlaylistSource = { ...p, itemCount: parsed.items.length, lastImportedAt: Date.now(), lastError: undefined };
    await persistPlaylistItems(next, parsed.items);
    void pushPlaylistToCloudIfEnabled(next);
  }, [playlists, hydrateSourceInternal, importUrl, persistPlaylistItems, pushPlaylistToCloudIfEnabled, toast]);

  const isFavourite = useCallback((itemId: string) => favourites.some((f) => f.itemId === itemId), [favourites]);

  const toggleFavourite = useCallback(async (itemId: string) => {
    let nextList: Favourite[];
    if (favourites.some((f) => f.itemId === itemId)) {
      nextList = favourites.filter((f) => f.itemId !== itemId);
      setFavourites(nextList);
      try { await db.deleteFavourite(`fav:${itemId}`); } catch { /* ignore */ }
    } else {
      const fav: Favourite = { id: `fav:${itemId}`, itemId, createdAt: Date.now(), sortOrder: nextSortOrder(favourites) };
      nextList = [...favourites, fav];
      setFavourites(nextList);
      try { await db.putFavourite(fav); } catch { /* ignore */ }
    }
    scheduleCloudPrefPush(nextList, settingsRef.current);
  }, [favourites, scheduleCloudPrefPush]);

  const reorderFavourites = useCallback(async (orderedItemIds: string[]) => {
    const next = applyFavouriteOrder(favourites, orderedItemIds);
    setFavourites(next);
    try { await Promise.all(next.map((f) => db.putFavourite(f))); } catch { /* ignore */ }
    scheduleCloudPrefPush(next, settingsRef.current);
  }, [favourites, scheduleCloudPrefPush]);

  const saveProgress = useCallback((itemId: string, position: number, duration: number) => {
    const prev = progressRef.current.get(itemId);
    const completed = duration > 0 && position / duration > 0.95;
    if (prev && !completed && !prev.completed && Math.abs(prev.position - position) < 5) return;
    const entry: WatchProgress = { itemId, position, duration, updatedAt: Date.now(), completed };
    progressRef.current.set(itemId, entry);
    setProgress((p) => [...p.filter((x) => x.itemId !== itemId), entry]);
    if (progressTimer.current) window.clearTimeout(progressTimer.current);
    progressTimer.current = window.setTimeout(() => { void db.putProgress(entry).catch(() => undefined); }, 600);
  }, []);

  /** Records Live TV channel watch + updates Last-Channel Recall without polluting VOD Continue Watching. */
  const recordLiveWatch = useCallback((itemId: string) => {
    if (currentLiveIdRef.current && currentLiveIdRef.current !== itemId) {
      setPreviousLiveId(currentLiveIdRef.current);
    }
    currentLiveIdRef.current = itemId;
    const entry: WatchProgress = { itemId, position: 0, duration: 0, updatedAt: Date.now(), completed: false, kind: 'live' };
    progressRef.current.set(itemId, entry);
    setProgress((p) => [...p.filter((x) => x.itemId !== itemId), entry]);
    void db.putProgress(entry).catch(() => undefined);
  }, []);

  const removeProgress = useCallback(async (itemId: string) => {
    progressRef.current.delete(itemId);
    setProgress((p) => p.filter((x) => x.itemId !== itemId));
    try { await db.deleteProgress(itemId); } catch { /* ignore */ }
  }, []);

  const clearHistory = useCallback(async () => {
    progressRef.current.clear();
    setProgress([]);
    try { await db.clearProgress(); } catch { /* ignore */ }
  }, []);

  const clearLocalData = useCallback(async () => {
    progressRef.current.clear();
    setPlaylists([]); setItems([]); setProgrammes([]); setFavourites([]); setProgress([]);
    try { await db.clearAllData(); } catch { /* ignore */ }
    try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem(REMINDERS_KEY); } catch { /* ignore */ }
  }, []);

  const exportSettings = useCallback(() => {
    downloadJson('siravex-settings.json', {
      version: 2,
      settings: { ...settings, parentalPinHash: undefined },
      playlists: playlists.map((p) => ({ name: p.name, type: p.type, enabled: p.enabled, cloudSynced: p.cloudSynced })),
    });
  }, [settings, playlists]);

  // Parental Controls
  const parentalUnlocked = parentalUnlockedUntil > Date.now();
  const unlockParental = useCallback(async (pin: string): Promise<boolean> => {
    const ok = await verifyParentalPin(pin, settingsRef.current.parentalPinHash);
    if (ok) setParentalUnlockedUntil(Date.now() + 30 * 60_000); // unlock for 30 mins
    return ok;
  }, []);
  const lockParentalNow = useCallback(() => setParentalUnlockedUntil(0), []);

  const toggleGroupLock = useCallback((groupName: string) => {
    const g = groupName.trim();
    if (!g) return;
    const cur = settingsRef.current.lockedGroups;
    const exists = cur.some((x) => x.toLowerCase() === g.toLowerCase());
    updateSettings({
      lockedGroups: exists ? cur.filter((x) => x.toLowerCase() !== g.toLowerCase()) : [...cur, g],
    });
  }, [updateSettings]);

  const toggleItemLock = useCallback((itemId: string) => {
    const cur = settingsRef.current.lockedItemIds;
    const exists = cur.includes(itemId);
    updateSettings({
      lockedItemIds: exists ? cur.filter((x) => x !== itemId) : [...cur, itemId],
    });
  }, [updateSettings]);

  // EPG Reminders
  const hasReminder = useCallback((programmeId: string) => reminders.some((r) => r.programmeId === programmeId), [reminders]);
  const toggleReminder = useCallback((prog: EpgProgramme, channel?: MediaItem) => {
    setReminders((prev) => {
      if (prev.some((r) => r.programmeId === prog.id)) {
        return prev.filter((r) => r.programmeId !== prog.id);
      }
      const next: EpgReminder = {
        id: `rem:${prog.id}`,
        programmeId: prog.id,
        channelId: prog.channelId,
        channelItemId: channel?.id,
        channelTitle: channel?.title ?? prog.channelId,
        title: prog.title,
        start: prog.start,
      };
      return [...prev, next].slice(-60);
    });
  }, []);

  const value = useMemo<Store>(() => ({
    ready, storageError, settings, updateSettings, resetSettings,
    playlists, items, programmes, favourites, progress, diagnostics,
    toasts, toast, dismissToast, previewFile, commitImport, importDemo, importUrl, importXtream,
    refreshXtreamEpg, loadSeriesEpisodes, loadShortEpg, importEpg,
    renamePlaylist, togglePlaylist, setDefaultPlaylist, deletePlaylist, refreshPlaylist, hydrateCloudPlaylist,
    toggleFavourite, reorderFavourites, isFavourite,
    saveProgress, recordLiveWatch, previousLiveId, removeProgress, clearHistory, logDiagnostic, clearLocalData, exportSettings,
    cloudSyncState, lastCloudSyncAt, syncCloudNow,
    parentalUnlocked, unlockParental, lockParentalNow, toggleGroupLock, toggleItemLock,
    reminders, toggleReminder, hasReminder,
  }), [
    ready, storageError, settings, updateSettings, resetSettings,
    playlists, items, programmes, favourites, progress, diagnostics,
    toasts, toast, dismissToast, previewFile, commitImport, importDemo, importUrl, importXtream,
    refreshXtreamEpg, loadSeriesEpisodes, loadShortEpg, importEpg,
    renamePlaylist, togglePlaylist, setDefaultPlaylist, deletePlaylist, refreshPlaylist, hydrateCloudPlaylist,
    toggleFavourite, reorderFavourites, isFavourite,
    saveProgress, recordLiveWatch, previousLiveId, removeProgress, clearHistory, logDiagnostic, clearLocalData, exportSettings,
    cloudSyncState, lastCloudSyncAt, syncCloudNow,
    parentalUnlocked, unlockParental, lockParentalNow, toggleGroupLock, toggleItemLock,
    reminders, toggleReminder, hasReminder,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}
