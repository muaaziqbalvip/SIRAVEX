/**
 * SIRAVEX cloud layer — Firebase (project: siravex-b6f72).
 * Config yahan public client config hai (Firebase web apiKey secret nahi hota;
 * asal hifazat Firestore Security Rules se aati hai — repo mein firestore.rules).
 * Saare Firebase modules LAZY import hote hain taake player bundle halka rahe,
 * aur agar Firebase kabhi unavailable ho to app (local playlists/player) phir
 * bhi poori tarah chalta hai — cloud sirf login/tracking/admin ke liye hai.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyA-iC-3QwjAD8YNHufIzmgBbGRmXOzWThk',
  authDomain: 'siravex-b6f72.firebaseapp.com',
  projectId: 'siravex-b6f72',
  storageBucket: 'siravex-b6f72.firebasestorage.app',
  messagingSenderId: '104169708633',
  appId: '1:104169708633:web:e6db7e0d7868916c12e548',
  measurementId: 'G-S17ZLR118X',
};

/** Admin emails — sirf ye accounts /admin dekh sakte hain. Apna email yahan badlein. */
export const ADMIN_EMAILS = ['muaaziqbal.vip@gmail.com'];

export interface FbUser { uid: string; email: string | null; displayName: string | null; photoURL: string | null }

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let cache: { app: Any; auth: Any; db: Any } | null = null;
let analyticsStarted = false;

/** Firebase app/auth/firestore — aik dafa initialize, phir cached. */
export async function getFirebase(): Promise<{ app: Any; auth: Any; db: Any }> {
  if (cache) return cache;
  const [{ initializeApp, getApps }, { getAuth }, { getFirestore }] = await Promise.all([
    import('firebase/app'), import('firebase/auth'), import('firebase/firestore'),
  ]);
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  cache = { app, auth: getAuth(app), db: getFirestore(app) };
  return cache;
}

/** Google Analytics — sirf supported browser mein, kabhi fail nahi karta. */
export async function startAnalytics(): Promise<void> {
  if (analyticsStarted) return;
  analyticsStarted = true;
  try {
    const { getAnalytics, isSupported, logEvent } = await import('firebase/analytics');
    const { app } = await getFirebase();
    if (await isSupported()) logEvent(getAnalytics(app), 'app_open', { version: '3.2.0' });
  } catch { /* analytics optional hai */ }
}

export async function signInWithGoogle(): Promise<FbUser> {
  const { auth } = await getFirebase();
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const cred = await signInWithPopup(auth, new GoogleAuthProvider());
  return toFbUser(cred.user);
}
export async function signInWithEmail(email: string, password: string): Promise<FbUser> {
  const { auth } = await getFirebase();
  const { signInWithEmailAndPassword } = await import('firebase/auth');
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return toFbUser(cred.user);
}
export async function registerWithEmail(name: string, email: string, password: string): Promise<FbUser> {
  const { auth } = await getFirebase();
  const { createUserWithEmailAndPassword, updateProfile } = await import('firebase/auth');
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
  return toFbUser(cred.user);
}
export async function signOutUser(): Promise<void> {
  const { auth } = await getFirebase();
  const { signOut } = await import('firebase/auth');
  await signOut(auth);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toFbUser(u: any): FbUser {
  return { uid: u.uid, email: u.email ?? null, displayName: u.displayName ?? null, photoURL: u.photoURL ?? null };
}
/** Firebase auth error ko insani zubaan mein. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) return 'Email ya password ghalat hai.';
  if (code.includes('email-already-in-use')) return 'Is email se account pehle se maujood hai — Login karein.';
  if (code.includes('weak-password')) return 'Password kam az kam 6 characters ka rakhein.';
  if (code.includes('invalid-email')) return 'Email ka format durust nahi hai.';
  if (code.includes('popup-closed')) return 'Google login window band ho gaya — dobara koshish karein.';
  if (code.includes('unauthorized-domain')) return 'Is domain se login Firebase Console mein allowed nahi hai. Console → Authentication → Settings → Authorized domains mein apna domain (masalan siravex.vercel.app) add karein.';
  if (code.includes('operation-not-allowed')) return 'Ye login tareeqa Firebase Console mein ON nahi hai. Console → Authentication → Sign-in method mein Google aur Email/Password enable karein.';
  return 'Login mein masla hua. Internet check kar ke dobara koshish karein.';
}
