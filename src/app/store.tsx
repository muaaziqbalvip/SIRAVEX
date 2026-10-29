import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppSettings, EpgProgramme, Favourite, MediaItem, PlaybackDiagnostic, PlaylistSource, WatchProgress } from '@/types/models';
import { DEFAULT_SETTINGS } from '@/types/models';
import { parseM3U, buildDemoPlaylistText } from '@/services/playlist/m3u';
import { parseXmltv } from '@/services/epg/xmltv';
import * as db from '@/services/storage/db';
import { downloadJson, redactUrl, sanitizeUrl, validatePlaylistFile } from '@/lib/security';

const SETTINGS_KEY = 'siravex-settings-v1';
export interface Toast { id: number; title: string; body?: string; tone: 'success' | 'error' | 'info' }
interface ImportPreview { name: string; items: Omit<MediaItem, 'id' | 'playlistId'>[]; warnings: string[]; errors: string[]; total: number }

interface Store {
  ready: boolean; storageError: string | null;
  settings: AppSettings; updateSettings: (p: Partial<AppSettings>) => void; resetSettings: () => void;
  playlists: PlaylistSource[]; items: MediaItem[]; programmes: EpgProgramme[];
  favourites: Favourite[]; progress: WatchProgress[]; diagnostics: PlaybackDiagnostic[];
  toasts: Toast[]; toast: (t: Omit<Toast, 'id'>) => void; dismissToast: (id: number) => void;
  previewFile: (file: File, name: string) => Promise<ImportPreview>;
  commitImport: (name: string, parsed: ImportPreview, type: PlaylistSource['type'], url?: string) => Promise<void>;
  importDemo: () => Promise<void>;
  importUrl: (name: string, url: string) => Promise<ImportPreview>;
  importXtream: (name: string, server: string, username: string, password: string) => Promise<ImportPreview>;
  importEpg: (file: File) => Promise<{ count: number; warnings: string[] }>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  togglePlaylist: (id: string) => Promise<void>;
  setDefaultPlaylist: (id: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  refreshPlaylist: (id: string) => Promise<void>;
  toggleFavourite: (itemId: string) => Promise<void>;
  isFavourite: (itemId: string) => boolean;
  saveProgress: (itemId: string, position: number, duration: number) => Promise<void>;
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

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { ...t, id }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 6000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((p) => p.filter((x) => x.id !== id)), []);

  useEffect(() => {
    db.loadAll().then((d) => { setPlaylists(d.playlists); setItems(d.items); setProgrammes(d.programmes); setFavourites(d.favourites); setProgress(d.progress); setDiagnostics(d.diagnostics); })
      .catch(() => setStorageError('Local storage (IndexedDB) is unavailable. The app still works, but playlists will not survive a refresh in this browser mode.'))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore quota/private mode */ }
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
    setDiagnostics((p) => [diag, ...p].slice(0, 100));
    try { await db.addDiagnostic(diag); } catch { /* storage unavailable */ }
  }, []);

  const persistPlaylistItems = useCallback(async (playlist: PlaylistSource, parsedItems: Omit<MediaItem, 'id' | 'playlistId'>[]) => {
    const full: MediaItem[] = parsedItems.map((it, i) => ({ ...it, id: `${playlist.id}:${i}:${it.title.slice(0, 32)}`, playlistId: playlist.id }));
    try { await db.putPlaylist(playlist); await db.replaceItems(playlist.id, full); } catch { setStorageError('Could not save to IndexedDB (quota or private browsing). Items are kept for this session only.'); }
    setPlaylists((p) => { const without = p.filter((x) => x.id !== playlist.id); return [...without, playlist]; });
    setItems((p) => [...p.filter((x) => x.playlistId !== playlist.id), ...full]);
    return full;
  }, []);

  const previewFile = useCallback(async (file: File, name: string): Promise<ImportPreview> => {
    const err = validatePlaylistFile(file);
    if (err) throw new Error(err);
    const text = await file.text();
    const parsed = parseM3U(text);
    return { name: name || file.name.replace(/\.(m3u8?|txt)$/i, ''), items: parsed.items, warnings: parsed.report.warnings, errors: parsed.report.errors, total: parsed.report.total };
  }, []);

  const commitImport = useCallback(async (name: string, parsed: ImportPreview, type: PlaylistSource['type'], url?: string) => {
    if (parsed.errors.length && parsed.items.length === 0) throw new Error(parsed.errors[0]);
    const playlist: PlaylistSource = { id: db.uid('pl'), name: name.trim() || 'My Playlist', type, url, enabled: true, isDefault: playlists.length === 0, itemCount: parsed.items.length, createdAt: Date.now(), lastImportedAt: Date.now() };
    await persistPlaylistItems(playlist, parsed.items);
  }, [persistPlaylistItems, playlists.length]);

  const importDemo = useCallback(async () => {
    const parsed = parseM3U(buildDemoPlaylistText());
    await commitImport('Demo samples (labelled demo)', { name: 'Demo', items: parsed.items, warnings: [], errors: [], total: parsed.items.length }, 'demo');
  }, [commitImport]);

  const importUrl = useCallback(async (name: string, url: string): Promise<ImportPreview> => {
    const clean = sanitizeUrl(url);
    if (!clean) throw new Error('Enter a valid http(s) playlist URL.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let text: string;
    try {
      const res = await fetch(clean, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}.`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 15 * 1024 * 1024) throw new Error('Playlist response exceeds the 15 MB safety limit.');
      text = new TextDecoder().decode(buf);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new Error('Request timed out after 20 seconds.');
      throw new Error('Could not fetch that URL from the browser. This is commonly a CORS or provider restriction — changing browser headers cannot bypass CORS. Download the playlist file from your provider and use local file import instead.');
    } finally { clearTimeout(timer); }
    const parsed = parseM3U(text);
    return { name: name || 'Remote playlist', items: parsed.items, warnings: parsed.report.warnings, errors: parsed.report.errors, total: parsed.report.total };
  }, []);

  const importXtream = useCallback(async (name: string, server: string, username: string, password: string): Promise<ImportPreview> => {
    const base = sanitizeUrl(server);
    if (!base || !username.trim() || !password) throw new Error('Server address, username and password are required.');
    // Isolated provider service: builds the standard get.php M3U endpoint. Credentials are used only for this request and never logged.
    const u = new URL(base); u.pathname = u.pathname.replace(/\/?$/, '/') + 'get.php';
    u.searchParams.set('username', username.trim()); u.searchParams.set('password', password); u.searchParams.set('type', 'm3u_plus'); u.searchParams.set('output', 'ts');
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 25000);
    let text: string;
    try {
      const res = await fetch(u.toString(), { signal: ctrl.signal });
      if (res.status === 401 || res.status === 403) throw new Error('Provider rejected the credentials (HTTP ' + res.status + '). Check username, password and account expiry.');
      if (!res.ok) throw new Error(`Provider returned HTTP ${res.status}. Not every Xtream-compatible panel allows browser access.`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 15 * 1024 * 1024) throw new Error('Playlist response exceeds the 15 MB safety limit.');
      text = new TextDecoder().decode(buf);
    } catch (e) {
      if (e instanceof Error && /Provider|credentials/.test(e.message)) throw e;
      throw new Error('Could not reach the provider from the browser (commonly CORS or provider browser-blocking). SIRAVEX cannot bypass provider restrictions — ask your provider for an M3U file download and import it locally.');
    } finally { clearTimeout(timer); }
    const parsed = parseM3U(text);
    return { name: name || 'Xtream playlist', items: parsed.items, warnings: parsed.report.warnings, errors: parsed.report.errors, total: parsed.report.total };
  }, []);

  const importEpg = useCallback(async (file: File): Promise<{ count: number; warnings: string[] }> => {
    if (file.size > 25 * 1024 * 1024) throw new Error('EPG file exceeds the 25 MB safety limit.');
    const text = await file.text();
    const parsed = parseXmltv(text);
    if (parsed.warnings.length && parsed.programmes.length === 0) throw new Error(parsed.warnings[0]);
    const full: EpgProgramme[] = parsed.programmes.map((p, i) => ({ ...p, id: `epg:${i}:${p.channelId}` }));
    try { await db.putProgrammes(full); } catch { setStorageError('EPG imported for this session but could not be saved (storage unavailable).'); }
    setProgrammes(full);
    return { count: full.length, warnings: parsed.warnings };
  }, []);

  const renamePlaylist = useCallback(async (id: string, name: string) => {
    const p = playlists.find((x) => x.id === id); if (!p || !name.trim()) return;
    const next = { ...p, name: name.trim() };
    setPlaylists((all) => all.map((x) => (x.id === id ? next : x)));
    try { await db.putPlaylist(next); } catch { /* session only */ }
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
    try { await db.deletePlaylistCascade(id); } catch { /* ignore */ }
  }, []);
  const refreshPlaylist = useCallback(async (id: string) => {
    const p = playlists.find((x) => x.id === id);
    if (!p) return;
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
      const fav: Favourite = { id: `fav:${itemId}`, itemId, createdAt: Date.now() };
      setFavourites((p) => [...p, fav]);
      try { await db.putFavourite(fav); } catch { /* ignore */ }
    }
  }, [favourites]);

  const saveProgress = useCallback(async (itemId: string, position: number, duration: number) => {
    const entry: WatchProgress = { itemId, position, duration, updatedAt: Date.now(), completed: duration > 0 && position / duration > 0.95 };
    setProgress((p) => [...p.filter((x) => x.itemId !== itemId), entry]);
    if (progressTimer.current) window.clearTimeout(progressTimer.current);
    progressTimer.current = window.setTimeout(() => { void db.putProgress(entry).catch(() => undefined); }, 400);
  }, []);
  const removeProgress = useCallback(async (itemId: string) => { setProgress((p) => p.filter((x) => x.itemId !== itemId)); try { await db.deleteProgress(itemId); } catch { /* ignore */ } }, []);
  const clearHistory = useCallback(async () => { setProgress([]); try { await db.clearProgress(); } catch { /* ignore */ } }, []);
  const clearLocalData = useCallback(async () => {
    setPlaylists([]); setItems([]); setProgrammes([]); setFavourites([]); setProgress([]);
    try { await db.clearAllData(); } catch { /* ignore */ }
    try { localStorage.removeItem(SETTINGS_KEY); } catch { /* ignore */ }
  }, []);
  const exportSettings = useCallback(() => {
    // Non-sensitive export only: preferences + playlist names/types. URLs, usernames and passwords are excluded by default.
    downloadJson('siravex-settings.json', { version: 1, settings, playlists: playlists.map((p) => ({ name: p.name, type: p.type, enabled: p.enabled })) });
  }, [settings, playlists]);

  const value = useMemo<Store>(() => ({
    ready, storageError, settings, updateSettings, resetSettings, playlists, items, programmes, favourites, progress, diagnostics,
    toasts, toast, dismissToast, previewFile, commitImport, importDemo, importUrl, importXtream, importEpg,
    renamePlaylist, togglePlaylist, setDefaultPlaylist, deletePlaylist, refreshPlaylist,
    toggleFavourite, isFavourite, saveProgress, removeProgress, clearHistory, logDiagnostic, clearLocalData, exportSettings,
  }), [ready, storageError, settings, updateSettings, resetSettings, playlists, items, programmes, favourites, progress, diagnostics, toasts, toast, dismissToast, previewFile, commitImport, importDemo, importUrl, importXtream, importEpg, renamePlaylist, togglePlaylist, setDefaultPlaylist, deletePlaylist, refreshPlaylist, toggleFavourite, isFavourite, saveProgress, removeProgress, clearHistory, logDiagnostic, clearLocalData, exportSettings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useStore(): Store { const s = useContext(Ctx); if (!s) throw new Error('useStore outside provider'); return s; }
