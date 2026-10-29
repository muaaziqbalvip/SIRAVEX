import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getFirebase, isAdminEmail, startAnalytics, toFbUser, type FbUser } from './firebase';
import { recordHeartbeat, recordPresence, setTrackingUser } from './tracking';

interface AuthState {
  user: FbUser | null;
  loading: boolean;
  isAdmin: boolean;
}
const Ctx = createContext<AuthState>({ user: null, loading: true, isAdmin: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<FbUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub: () => void = () => undefined;
    let heartbeat: number | null = null;
    let alive = true;
    void (async () => {
      try {
        const { auth } = await getFirebase();
        const { onAuthStateChanged } = await import('firebase/auth');
        if (!alive) return;
        unsub = onAuthStateChanged(auth, (u) => {
          const fb = u ? toFbUser(u) : null;
          setUser(fb);
          setTrackingUser(fb);
          setLoading(false);
          if (heartbeat) { window.clearInterval(heartbeat); heartbeat = null; }
          if (fb) {
            void recordPresence(fb);
            heartbeat = window.setInterval(() => void recordHeartbeat(), 60000);
          }
        });
        void startAnalytics();
      } catch {
        if (alive) setLoading(false); // Firebase na mile to bhi app chalta rahe
      }
    })();
    return () => { alive = false; unsub(); if (heartbeat) window.clearInterval(heartbeat); };
  }, []);

  const value = useMemo<AuthState>(() => ({ user, loading, isAdmin: isAdminEmail(user?.email) }), [user, loading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAuth(): AuthState { return useContext(Ctx); }
