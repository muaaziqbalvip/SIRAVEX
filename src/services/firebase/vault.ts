import { getFirebase } from './firebase';
import type { AppSettings, Favourite, PlaylistSource } from '@/types/models';

/**
 * SIRAVEX Cloud Vault (Firebase Firestore + Web Crypto AES-256-GCM)
 *
 * Saves & syncs a user's Xtream Codes accounts, M3U URLs, M3U files (up to 650 KB),
 * Favourites, and Preferences across devices under:
 *   - `users/{uid}/playlists/{playlistId}`
 *   - `users/{uid}/vault/preferences`
 *
 * Security model:
 * 1. Firestore Security Rules (`firestore.rules`) strictly restrict `users/{uid}/**`
 *    to `request.auth.uid == uid`.
 * 2. Sensitive fields (`url`, `server`, `username`, `password`, `rawM3uText`) are
 *    encrypted client-side with AES-256-GCM before leaving the browser.
 */

export const MAX_CLOUD_M3U_CHARS = 650_000; // safe margin under Firestore's 1 MiB doc limit
const ENC_PREFIX = 'enc:v1:';
const keyCache = new Map<string, Promise<CryptoKey>>();

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveVaultKey(uid: string): Promise<CryptoKey> {
  const cached = keyCache.get(uid);
  if (cached) return cached;
  const p = (async () => {
    const enc = new TextEncoder();
    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw',
      enc.encode(`siravex-cloud-vault-v1::${uid}`),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return globalThis.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode(`siravex-salt::${uid.slice(0, 16)}`),
        iterations: 50_000,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  keyCache.set(uid, p);
  return p;
}

export async function encryptSecret(plain: string | undefined, uid: string): Promise<string | undefined> {
  if (!plain) return undefined;
  if (!globalThis.crypto?.subtle) return plain;
  const key = await deriveVaultKey(uid);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plain);
  const buf = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return `${ENC_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(buf))}`;
}

export async function decryptSecret(value: string | undefined, uid: string): Promise<string | undefined> {
  if (!value) return undefined;
  if (!value.startsWith(ENC_PREFIX)) return value;
  if (!globalThis.crypto?.subtle) return undefined;
  const rest = value.slice(ENC_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return undefined;
  try {
    const iv = fromBase64(rest.slice(0, sep));
    const ct = fromBase64(rest.slice(sep + 1));
    const key = await deriveVaultKey(uid);
    const plainBuf = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ct as BufferSource,
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    return undefined;
  }
}

export interface CloudPlaylistDoc {
  id: string;
  name: string;
  type: PlaylistSource['type'];
  encUrl?: string | null;
  encServer?: string | null;
  encUsername?: string | null;
  encPassword?: string | null;
  encRawM3u?: string | null;
  hasPassword: boolean;
  enabled: boolean;
  isDefault: boolean;
  itemCount: number;
  createdAt: number;
  lastImportedAt?: number | null;
  lastEpgAt?: number | null;
  updatedAt: number;
}

export async function serializeCloudPlaylist(p: PlaylistSource, uid: string): Promise<CloudPlaylistDoc> {
  const safeM3u = p.rawM3uText && p.rawM3uText.length <= MAX_CLOUD_M3U_CHARS ? p.rawM3uText : undefined;
  const [encUrl, encServer, encUsername, encPassword, encRawM3u] = await Promise.all([
    encryptSecret(p.url, uid),
    encryptSecret(p.server, uid),
    encryptSecret(p.username, uid),
    encryptSecret(p.password, uid),
    encryptSecret(safeM3u, uid),
  ]);
  return {
    id: p.id,
    name: p.name.slice(0, 120),
    type: p.type,
    encUrl: encUrl ?? null,
    encServer: encServer ?? null,
    encUsername: encUsername ?? null,
    encPassword: encPassword ?? null,
    encRawM3u: encRawM3u ?? null,
    hasPassword: Boolean(p.password || p.hasPassword),
    enabled: p.enabled,
    isDefault: p.isDefault,
    itemCount: p.itemCount ?? 0,
    createdAt: p.createdAt || Date.now(),
    lastImportedAt: p.lastImportedAt ?? null,
    lastEpgAt: p.lastEpgAt ?? null,
    updatedAt: Date.now(),
  };
}

export async function deserializeCloudPlaylist(docData: CloudPlaylistDoc, uid: string): Promise<PlaylistSource> {
  const [url, server, username, password, rawM3uText] = await Promise.all([
    decryptSecret(docData.encUrl ?? undefined, uid),
    decryptSecret(docData.encServer ?? undefined, uid),
    decryptSecret(docData.encUsername ?? undefined, uid),
    decryptSecret(docData.encPassword ?? undefined, uid),
    decryptSecret(docData.encRawM3u ?? undefined, uid),
  ]);
  return {
    id: docData.id,
    name: docData.name || 'Cloud Playlist',
    type: docData.type,
    url,
    server,
    username,
    password,
    rawM3uText,
    hasPassword: Boolean(password || docData.hasPassword),
    enabled: docData.enabled !== false,
    isDefault: Boolean(docData.isDefault),
    itemCount: docData.itemCount ?? 0,
    createdAt: docData.createdAt || Date.now(),
    lastImportedAt: docData.lastImportedAt ?? undefined,
    lastEpgAt: docData.lastEpgAt ?? undefined,
    cloudSynced: true,
    cloudUpdatedAt: docData.updatedAt || Date.now(),
  };
}

async function firestoreApi() {
  const { db } = await getFirebase();
  const m = await import('firebase/firestore');
  return { db, ...m };
}

/** Save or update a single Xtream / M3U playlist in the signed-in user's Firebase Vault. */
export async function saveCloudPlaylist(uid: string, playlist: PlaylistSource): Promise<boolean> {
  if (!uid || playlist.type === 'demo') return false;
  try {
    const payload = await serializeCloudPlaylist(playlist, uid);
    const { db, doc, setDoc } = await firestoreApi();
    await setDoc(doc(db, 'users', uid, 'playlists', playlist.id), payload, { merge: true });
    return true;
  } catch {
    return false;
  }
}

/** Delete a playlist from the signed-in user's Firebase Vault. */
export async function deleteCloudPlaylist(uid: string, playlistId: string): Promise<boolean> {
  if (!uid || !playlistId) return false;
  try {
    const { db, doc, deleteDoc } = await firestoreApi();
    await deleteDoc(doc(db, 'users', uid, 'playlists', playlistId));
    return true;
  } catch {
    return false;
  }
}

/** Fetch & decrypt all saved playlists from the signed-in user's Firebase Vault. */
export async function fetchCloudPlaylists(uid: string): Promise<PlaylistSource[]> {
  if (!uid) return [];
  try {
    const { db, collection, getDocs } = await firestoreApi();
    const snap = await getDocs(collection(db, 'users', uid, 'playlists'));
    const out: PlaylistSource[] = [];
    for (const d of snap.docs) {
      const raw = d.data() as CloudPlaylistDoc;
      if (!raw || !raw.type || raw.type === 'demo') continue;
      const parsed = await deserializeCloudPlaylist({ ...raw, id: d.id }, uid);
      out.push(parsed);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    if (code.includes('permission-denied')) {
      throw new Error('Firebase Firestore rules v4.0 deploy karna baqi hai (firebase deploy --only firestore:rules). Local playlists mehfooz hain.');
    }
    throw err;
  }
}

export interface CloudPreferencesDoc {
  favourites: Favourite[];
  settings: Partial<AppSettings>;
  updatedAt: number;
}

/** Save Favourites + non-ephemeral AppSettings to Firebase Vault. */
export async function saveCloudPreferences(
  uid: string,
  favourites: Favourite[],
  settings: AppSettings,
): Promise<boolean> {
  if (!uid) return false;
  try {
    const { db, doc, setDoc } = await firestoreApi();
    const docBody: CloudPreferencesDoc = {
      favourites: favourites.slice(0, 500),
      settings,
      updatedAt: Date.now(),
    };
    await setDoc(doc(db, 'users', uid, 'vault', 'preferences'), docBody, { merge: true });
    return true;
  } catch {
    return false;
  }
}

/** Load Favourites + AppSettings from Firebase Vault. */
export async function fetchCloudPreferences(uid: string): Promise<CloudPreferencesDoc | null> {
  if (!uid) return null;
  try {
    const { db, doc, getDoc } = await firestoreApi();
    const s = await getDoc(doc(db, 'users', uid, 'vault', 'preferences'));
    if (!s.exists()) return null;
    return s.data() as CloudPreferencesDoc;
  } catch {
    return null;
  }
}
