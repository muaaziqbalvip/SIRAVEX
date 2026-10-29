import { getFirebase, type FbUser } from './firebase';

/**
 * Deep tracking — magar hifazat ke saath:
 *  - Sirf LOGIN users track hote hain (guests kabhi nahi).
 *  - Stream URLs / tokens / passwords KABHI nahi bheje jate — sirf title,
 *    kind (live/movie/series), group. Neeche wala pure builder isay enforce
 *    karta hai aur test se verified hai.
 *  - Har write fail-safe hai: offline/rules error par app par koi asar nahi.
 */
let current: FbUser | null = null;
let ipPromise: Promise<string | null> | null = null;

export function setTrackingUser(u: FbUser | null): void { current = u; }

export interface WatchPayload { title: string; kind: string; group: string; at: number }
const clip = (s: string, n: number) => (s || '').slice(0, n);

/** URL/token wale fields jaan boojh kar shamil NAHI hain. */
export function buildWatchPayload(item: { title: string; kind: string; group?: string }, at = Date.now()): WatchPayload {
  return { title: clip(item.title, 120), kind: clip(item.kind, 24), group: clip(item.group ?? '', 80), at };
}

async function fetchIp(): Promise<string | null> {
  if (!ipPromise) {
    ipPromise = (async () => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const r = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
        clearTimeout(t);
        const j = (await r.json()) as { ip?: string };
        return typeof j.ip === 'string' ? j.ip.slice(0, 45) : null;
      } catch { return null; }
    })();
  }
  return ipPromise;
}

async function fs() {
  const { db } = await getFirebase();
  const m = await import('firebase/firestore');
  return { db, ...m };
}

/** Login par profile + presence (last IP, last seen) upsert. */
export async function recordPresence(user: FbUser): Promise<void> {
  try {
    const { db, doc, setDoc, serverTimestamp } = await fs();
    const ip = await fetchIp();
    await setDoc(doc(db, 'users', user.uid), {
      email: user.email, displayName: user.displayName, photoURL: user.photoURL,
      lastSeenAt: serverTimestamp(), ...(ip ? { lastIp: ip } : {}),
    }, { merge: true });
  } catch { /* rules/offline — khamoshi se skip */ }
}

/** Har 60s heartbeat — admin ko "abhi active" pata chalta hai. */
export async function recordHeartbeat(): Promise<void> {
  if (!current) return;
  try {
    const { db, doc, updateDoc, serverTimestamp } = await fs();
    await updateDoc(doc(db, 'users', current.uid), { lastSeenAt: serverTimestamp() });
  } catch { /* ignore */ }
}

/** Channel/movie chalaya gaya — admin: kis ne, kya, kab (URL kabhi nahi). */
export async function trackWatch(item: { title: string; kind: string; group?: string }): Promise<void> {
  if (!current) return;
  const user = current;
  const payload = buildWatchPayload(item);
  try {
    const { db, doc, setDoc, addDoc, collection, increment, serverTimestamp } = await fs();
    await setDoc(doc(db, 'users', user.uid), {
      lastSeenAt: serverTimestamp(), lastWatched: payload, watchSessions: increment(1),
    }, { merge: true });
    await addDoc(collection(db, 'events'), { uid: user.uid, type: 'watch', ...payload, atServer: serverTimestamp() });
  } catch { /* ignore */ }
}

/** Player heartbeat — har minute dekhne ka waqt jama (seconds). */
export async function trackWatchMinute(item: { title: string; kind: string; group?: string }): Promise<void> {
  if (!current) return;
  try {
    const { db, doc, setDoc, increment, serverTimestamp } = await fs();
    await setDoc(doc(db, 'users', current.uid), {
      lastSeenAt: serverTimestamp(), lastWatched: buildWatchPayload(item), watchSeconds: increment(60),
    }, { merge: true });
  } catch { /* ignore */ }
}

/** Admin: saare users ki list (rules sirf admin ko ijazat deti hain). */
export interface AdminUserRow { uid: string; email?: string; displayName?: string; photoURL?: string; lastIp?: string; watchSessions?: number; watchSeconds?: number; lastWatched?: WatchPayload; lastSeenAt?: { toMillis?: () => number } }
export async function fetchAllUsers(): Promise<AdminUserRow[]> {
  const { db, collection, getDocs, query, orderBy, limit } = await fs();
  const snap = await getDocs(query(collection(db, 'users'), orderBy('lastSeenAt', 'desc'), limit(200)));
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<AdminUserRow, 'uid'>) }));
}

export interface Announcement { title: string; body: string; version?: string; active: boolean; at?: number }
export async function fetchAnnouncement(): Promise<Announcement | null> {
  try {
    const { db, doc, getDoc } = await fs();
    const s = await getDoc(doc(db, 'announcements', 'current'));
    if (!s.exists()) return null;
    const d = s.data() as Announcement;
    return d.active ? d : null;
  } catch { return null; }
}
export async function publishAnnouncement(a: Announcement): Promise<void> {
  const { db, doc, setDoc, serverTimestamp } = await fs();
  await setDoc(doc(db, 'announcements', 'current'), { ...a, atServer: serverTimestamp() });
}
