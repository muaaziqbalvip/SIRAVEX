import { openDB, type IDBPDatabase } from 'idb';
import type { EpgProgramme, Favourite, MediaItem, PlaybackDiagnostic, PlaylistSource, WatchProgress } from '@/types/models';
import { sortFavourites } from '@/lib/favourites-order';

const DB_NAME = 'siravex';
export const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('playlists')) database.createObjectStore('playlists', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('items')) { const s = database.createObjectStore('items', { keyPath: 'id' }); s.createIndex('by-playlist', 'playlistId'); s.createIndex('by-kind', 'kind'); }
        if (!database.objectStoreNames.contains('programmes')) { const s = database.createObjectStore('programmes', { keyPath: 'id' }); s.createIndex('by-channel', 'channelId'); }
        if (!database.objectStoreNames.contains('favourites')) database.createObjectStore('favourites', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('progress')) database.createObjectStore('progress', { keyPath: 'itemId' });
        if (!database.objectStoreNames.contains('diagnostics')) database.createObjectStore('diagnostics', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function storageAvailable(): Promise<boolean> {
  try { await db(); return true; } catch { return false; }
}
export async function loadAll(): Promise<{ playlists: PlaylistSource[]; items: MediaItem[]; programmes: EpgProgramme[]; favourites: Favourite[]; progress: WatchProgress[]; diagnostics: PlaybackDiagnostic[] }> {
  const d = await db();
  const [playlists, items, programmes, favourites, progress, diagnostics] = await Promise.all([
    d.getAll('playlists'), d.getAll('items'), d.getAll('programmes'), d.getAll('favourites'), d.getAll('progress'), d.getAll('diagnostics'),
  ]);
  return { playlists: playlists as PlaylistSource[], items: items as MediaItem[], programmes: programmes as EpgProgramme[], favourites: sortFavourites(favourites as Favourite[]), progress: progress as WatchProgress[], diagnostics: (diagnostics as PlaybackDiagnostic[]).sort((a, b) => b.at - a.at).slice(0, 100) };
}
export async function putPlaylist(p: PlaylistSource): Promise<void> { await (await db()).put('playlists', p); }
export async function deletePlaylistCascade(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['playlists', 'items', 'favourites', 'progress', 'programmes'], 'readwrite');
  await tx.objectStore('playlists').delete(id);
  const items = await tx.objectStore('items').index('by-playlist').getAll(id) as unknown as MediaItem[];
  for (const it of items) {
    await tx.objectStore('items').delete(it.id);
    await tx.objectStore('favourites').delete(`fav:${it.id}`);
    await tx.objectStore('progress').delete(it.id);
  }
  const progs = (await tx.objectStore('programmes').getAll()) as unknown as EpgProgramme[];
  for (const p of progs) if (p.playlistId === id) await tx.objectStore('programmes').delete(p.id);
  await tx.done;
}
export async function replaceItems(playlistId: string, items: MediaItem[]): Promise<void> {
  const d = await db();
  const old = await d.getAll('items');
  const tx = d.transaction('items', 'readwrite');
  for (const o of old as unknown as MediaItem[]) if (o.playlistId === playlistId) await tx.store.delete(o.id);
  for (const it of items) await tx.store.put(it);
  await tx.done;
}
export async function putProgrammes(programmes: EpgProgramme[]): Promise<void> {
  const d = await db();
  const tx = d.transaction('programmes', 'readwrite');
  await tx.store.clear();
  for (const p of programmes) await tx.store.put(p);
  await tx.done;
}
/** v2: replace only one playlist's EPG so multiple Xtream/file sources can coexist. */
export async function replaceProgrammesForPlaylist(playlistId: string, programmes: EpgProgramme[]): Promise<void> {
  const d = await db();
  const all = (await d.getAll('programmes')) as unknown as EpgProgramme[];
  const tx = d.transaction('programmes', 'readwrite');
  for (const p of all) if (p.playlistId === playlistId || (!p.playlistId && playlistId === 'file-epg')) await tx.store.delete(p.id);
  for (const p of programmes) await tx.store.put(p);
  await tx.done;
}
export async function deleteProgrammesForPlaylist(playlistId: string): Promise<void> {
  const d = await db();
  const all = (await d.getAll('programmes')) as unknown as EpgProgramme[];
  const tx = d.transaction('programmes', 'readwrite');
  for (const p of all) if (p.playlistId === playlistId) await tx.store.delete(p.id);
  await tx.done;
}
export async function putFavourite(f: Favourite): Promise<void> { await (await db()).put('favourites', f); }
export async function deleteFavourite(id: string): Promise<void> { await (await db()).delete('favourites', id); }
export async function putProgress(p: WatchProgress): Promise<void> { await (await db()).put('progress', p); }
export async function deleteProgress(itemId: string): Promise<void> { await (await db()).delete('progress', itemId); }
export async function clearProgress(): Promise<void> { await (await db()).clear('progress'); }
export async function addDiagnostic(diag: PlaybackDiagnostic): Promise<void> { await (await db()).put('diagnostics', diag); }
export async function clearAllData(): Promise<void> {
  const d = await db();
  for (const s of ['playlists', 'items', 'programmes', 'favourites', 'progress', 'diagnostics'] as const) await d.clear(s);
}
export async function estimateStorage(): Promise<{ usage?: number; quota?: number }> {
  try { const est = await navigator.storage.estimate(); return { usage: est.usage, quota: est.quota }; } catch { return {}; }
}
export function uid(prefix = 'id'): string { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }
