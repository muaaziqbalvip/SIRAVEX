import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppSettings, EpgProgramme, Favourite, MediaItem, PlaybackDiagnostic, PlaylistSource, WatchProgress } from '@/types/models';
import { DEFAULT_SETTINGS } from '@/types/models';
import { parseM3U, buildDemoPlaylistText } from '@/services/playlist/m3u';
import { parseXmltv } from '@/services/epg/xmltv';
import { connectXtream, fetchSeriesEpisodes, fetchShortEpg, fetchXtreamEpg, type XtreamCreds } from '@/services/xtream/xtream';
import * as db from '@/services/storage/db';
import { downloadJson, redactUrl, sanitizeUrl, validatePlaylistFile } from '@/lib/security';
import { applyFavouriteOrder, nextSortOrder } from '@/lib/favourites-order';

const SETTINGS_KEY = 'siravex-settings-v1';
export interface Toast { id: number; title: string; body?: string; tone: 'success' | 'error' | 'info' }
export interface ImportPreview { name: string; items: Omit<MediaItem, 'id' | 'playlistId'>[]; warnings: string[]; errors: string[]; total: number; epgCount?: number; accountNote?: string }

interface Store {
  ready: boolean; storageError: string | null;
  settings: AppSettings; updateSettings: (p: Partial<AppSettings>) => void; resetSettings: () => void;
  playlists: PlaylistSource[]; items: MediaItem[]; programmes: EpgProgramme[];
  favourites: Favourite[]; progress: WatchProgress[]; diagnostics: PlaybackDiagnostic[];
  toasts: Toast[]; toast: (t: Omit<Toast, 'id'>) => void; dismissToast: (id: number) => void;
  previewFile: (file: File, name: string) => Promise<ImportPreview>;
  commitImport: (name: string, parsed: ImportPreview, type: PlaylistSource['type'], opts?: { url?: string; server?: string; username?: string; password?: string; remember?: boolean }) => Promise<void>;
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
  toggleFavourite: (itemId: string) => Promise<void>;
  reorderFavourites: (orderedItemIds: string[]) => Promise<void>;
  isFavourite: (itemId: string) => boolean;
  saveProgress: (itemId: string, position: number, duration: number) => void;
  removeProgress: (itemId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  logDiagnostic: (category: string, message: string, url?: string) => Promise<void>;
  clearLocalData: () => Promise<void>;
  exportSettings: () => void;
}

const Ctx = createContext<Store | null>(null);
function loadSettings(): AppSettings {
  try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) }; } catch { /* private mode */ }
  return DEFAULT_SETTINGS;
}

export function AppProvider({ children }: { children: ReactNode }) {
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
  const progressTimer = useRef<number | null>(null);
  const progressRef = useRef<Map<string, WatchProgress>>(new Map());
  const pendingEpgRef = useRef<Map<string, Omit<EpgProgramme, 'id' | 'playlistId'>[]>>(new Map());

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 6000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((p) => p.filter((x) => x.id !== id)), []);

  useEffect(() => {
    db.loadAll().then((d) => {
      setPlaylists(d.playlists); setItems(d.items); setProgrammes(d.programmes); setFavourites(d.favourites); setDiagnostics(d.diagnostics);
      setProgress(d.progress); d.progress.forEach((p) => progressRef.current.set(p.itemId, p));
    })
      .catch(() => setStorageError('Local storage (IndexedDB) is unavailable. The app still works, but playlists will not survive a refresh in this browser mode.'))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    const root = document.documentElement;
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('dark', dark);
    root.dataset.accent = settings.accent; root.dataset.density = settings.density;
    root.style.setProperty('--svx-accent', settings.accent === 'violet' ? '#8b5cf6' : settings.accent === 'emerald' ? '#10b981' : settings.accent === 'cyan' ? '#22d3ee' : '#0ea5e9');
    document.body.classList.toggle('reduce-motion', settings.reducedMotion);
  }, [settings]);

  const updateSettings = useCallback((p: Partial<AppSettings>) => setSettings((s) => ({ ...s, ...p })), []);
  const resetSettings = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

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

  const previewFile = useCallback(async (file: File, name: string): Promise<ImportPreview> => {
    const err = validatePlaylistFile(file);
    if (err) throw new Error(err);
    const text = await file.text();
    const parsed = parseM3U(text);
    return { name: name || file.name.replace(/\.(m3u8?|txt)$/i, ''), items: parsed.items, warnings: parsed.report.warnings, errors: parsed.report.errors, total: parsed.report.total };
  }, []);

  const commitImport = useCallback(async (name: string, parsed: ImportPreview, type: PlaylistSource['type'], opts?: { url?: string; server?: string; username?: string; password?: string; remember?: boolean }) => {
    if (parsed.errors.length && parsed.items.length === 0) throw new Error(parsed.errors[0]);
    const playlist: PlaylistSource = {
      id: db.uid('pl'), name: name.trim() || 'My Playlist', type,
      url: opts?.url, server: opts?.server, username: opts?.username,
      password: opts?.remember ? opts?.password : undefined, hasPassword: !!opts?.password,
      enabled: true, isDefault: playlists.length === 0, itemCount: parsed.items.length,
      createdAt: Date.now(), lastImportedAt: Date.now(), lastEpgAt: parsed.epgCount ? Date.now() : undefined,
    };
    await persistPlaylistItems(playlist, parsed.items);
    const pending = pendingEpgRef.current.get(parsed.name);
    if (pending?.length) { await persistProgrammes(playlist.id, pending); pendingEpgRef.current.delete(parsed.name); }
  }, [persistPlaylistItems, persistProgrammes, playlists.length]);

  const importDemo = useCallback(async () => {
    // Dobara Add dabane se duplicate demo playlists nahi banti.
    for (const old of playlists.filter((x) => x.type === 'demo')) { try { await db.deletePlaylistCascade(old.id); } catch { /* ignore */ } }
    if (playlists.some((x) => x.type === 'demo')) { setPlaylists((p) => p.filter((x) => x.type !== 'demo')); setItems((p) => p.filter((i) => !playlists.some((x) => x.type === 'demo' && x.id === i.playlistId))); }
    const parsed = parseM3U(buildDemoPlaylistText());
    await commitImport('Demo samples (labelled demo)', { name: 'Demo', items: parsed.items, warnings: [], errors: [], total: parsed.items.length }, 'demo');
  }, [commitImport, playlists]);

  const importUrl = useCallback(async (name: string, url: string): Promise<ImportPreview> => {
    const clean = sanitizeUrl(url);
    if (!clean) throw new Error('Enter a valid http(s) playlist URL.');
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
    const parsed = parseM3U(text);
    return { name: name || 'Remote playlist', items: parsed.items, warnings: parsed.report.warnings, errors: parsed.report.errors, total: parsed.report.total };
  }, []);

  /** Real Xtream Codes API connect (player_api.php + xmltv.php) — replaces the old get.php/ts flow. */
  const importXtream = useCallback(async (name: string, creds: XtreamCreds): Promise<ImportPreview> => {
    const result = await connectXtream(creds);
    const preview: ImportPreview = { name: name || 'Xtream playlist', items: result.items, warnings: result.warnings, errors: result.items.length === 0 ? ['No live, movie or series items were returned by the provider.'] : [], total: result.items.length, epgCount: result.programmes.length, accountNote: result.accountNote };
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
    return count;
  }, [playlists, persistProgrammes]);

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
    try { const all = [...items.filter((x) => x.id !== item.id), ...full]; await db.replaceItems(p.id, all.filter((x) => x.playlistId === p.id)); } catch { /* session only */ }
    return full.length;
  }, [playlists, items]);

  /** Short EPG fallback: XMLTV na mile to provider se is channel ki now/next + upcoming listings. */
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
    // Maujooda usi channel ki listings hata kar fresh daalo (duplicates nahi).
    const merged = [...programmes.filter((pr) => !(pr.playlistId === item.playlistId && pr.channelId === channelId)), ...mapped.map((m, i) => ({ ...m, id: `epg:${item.playlistId}:${i}:${channelId}`, playlistId: item.playlistId }))];
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
    const p = playlists.find((x) => x.id === id); if (!p || !name.trim()) return;
    const next = { ...p, name: name.trim() };
    setPlaylists((all) => all.map((x) => (x.id === id ? next : x)));
    try { await db.putPlaylist(next); } catch { /* ignore */ }
  }, [playlists]);
  const togglePlaylist = useCallback(async (id: string) => {
    const p = playlists.find((x) => x.id === id); if (!p) return;
    const next = { ...p, enabled: !p.enabled };
    setPlaylists((all) => all.map((x) => (x.id === id ? next : x)));
    try { await db.putPlaylist(next); } catch { /* ignore */ }
  }, [playlists]);
  const setDefaultPlaylist = useCallback(async (id: string) => {
    const next = playlists.map((x) => ({ ...x, isDefault: x.id === id }));
    setPlaylists(next);
    try { for (const p of next) await db.putPlaylist(p); } catch { /* ignore */ }
  }, [playlists]);
  const deletePlaylist = useCallback(async (id: string) => {
    setPlaylists((p) => p.filter((x) => x.id !== id));
    setItems((p) => p.filter((x) => x.playlistId !== id));
    setProgrammes((p) => p.filter((x) => x.playlistId !== id));
    try { await db.deletePlaylistCascade(id); } catch { /* ignore */ }
  }, []);
  const refreshPlaylist = useCallback(async (id: string) => {
    const p = playlists.find((x) => x.id === id);
    if (!p) return;
    if (p.type === 'xtream') throw new Error('Xtream sources refresh by reconnecting (server + password) so new categories/EPG are fetched. Use “Fetch EPG” for guide-only refresh.');
    if (!p.url) { toast({ tone: 'info', title: 'Nothing to refresh', body: 'File and demo playlists are refreshed by importing the file again.' }); return; }
    const parsed = await importUrl(p.name, p.url);
    const next: PlaylistSource = { ...p, itemCount: parsed.items.length, lastImportedAt: Date.now(), lastError: undefined };
    await persistPlaylistItems(next, parsed.items);
  }, [playlists, importUrl, persistPlaylistItems, toast]);

  const isFavourite = useCallback((itemId: string) => favourites.some((f) => f.itemId === itemId), [favourites]);
  const toggleFavourite = useCallback(async (itemId: string) => {
    if (favourites.some((f) => f.itemId === itemId)) {
      setFavourites((p) => p.filter((f) => f.itemId !== itemId));
      try { await db.deleteFavourite(`fav:${itemId}`); } catch { /* ignore */ }
    } else {
      const fav: Favourite = { id: `fav:${itemId}`, itemId, createdAt: Date.now(), sortOrder: nextSortOrder(favourites) };
      setFavourites((p) => [...p, fav]);
      try { await db.putFavourite(fav); } catch { /* ignore */ }
    }
  }, [favourites]);

  const reorderFavourites = useCallback(async (orderedItemIds: string[]) => {
    const next = applyFavouriteOrder(favourites, orderedItemIds);
    setFavourites(next);
    try { await Promise.all(next.map((f) => db.putFavourite(f))); } catch { /* ignore */ }
  }, [favourites]);

  /**
   * GLITCH FIX: previously every `timeupdate` (4x/sec) created a new progress array ->
   * the ENTIRE app re-rendered 4x/sec during playback (mobile flicker + battery drain).
   * Now state only changes when position moved >= 5s or completion flipped; DB writes
   * are debounced. Playback UI keeps its own high-frequency state inside PlayerShell.
   */
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
  const removeProgress = useCallback(async (itemId: string) => { progressRef.current.delete(itemId); setProgress((p) => p.filter((x) => x.itemId !== itemId)); try { await db.deleteProgress(itemId); } catch { /* ignore */ } }, []);
  const clearHistory = useCallback(async () => { progressRef.current.clear(); setProgress([]); try { await db.clearProgress(); } catch { /* ignore */ } }, []);
  const clearLocalData = useCallback(async () => {
    progressRef.current.clear();
    setPlaylists([]); setItems([]); setProgrammes([]); setFavourites([]); setProgress([]);
    try { await db.clearAllData(); } catch { /* ignore */ }
    try { localStorage.removeItem(SETTINGS_KEY); } catch { /* ignore */ }
  }, []);
  const exportSettings = useCallback(() => {
    downloadJson('siravex-settings.json', { version: 1, settings, playlists: playlists.map((p) => ({ name: p.name, type: p.type, enabled: p.enabled })) });
  }, [settings, playlists]);

  const value = useMemo<Store>(() => ({
    ready, storageError, settings, updateSettings, resetSettings, playlists, items, programmes, favourites, progress, diagnostics,
    toasts, toast, dismissToast, previewFile, commitImport, importDemo, importUrl, importXtream, refreshXtreamEpg, loadSeriesEpisodes, loadShortEpg, importEpg,
    renamePlaylist, togglePlaylist, setDefaultPlaylist, deletePlaylist, refreshPlaylist,
    toggleFavourite, reorderFavourites, isFavourite, saveProgress, removeProgress, clearHistory, logDiagnostic, clearLocalData, exportSettings,
  }), [ready, storageError, settings, updateSettings, resetSettings, playlists, items, programmes, favourites, progress, diagnostics, toasts, toast, dismissToast, previewFile, commitImport, importDemo, importUrl, importXtream, refreshXtreamEpg, loadSeriesEpisodes, loadShortEpg, importEpg, renamePlaylist, togglePlaylist, setDefaultPlaylist, deletePlaylist, refreshPlaylist, toggleFavourite, reorderFavourites, isFavourite, saveProgress, removeProgress, clearHistory, logDiagnostic, clearLocalData, exportSettings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useStore(): Store { const s = useContext(Ctx); if (!s) throw new Error('useStore outside provider'); return s; }
