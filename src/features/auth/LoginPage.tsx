import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, ListVideo, LogIn, RefreshCw, UserPlus } from 'lucide-react';
import { Button, Card, Input } from '@/components/ui/ui';
import { useAuth } from '@/services/firebase/AuthContext';
import { useStore } from '@/app/store';
import { authErrorMessage, signInWithEmail, signInWithGoogle, registerWithEmail, signOutUser } from '@/services/firebase/firebase';
import { usePageMeta } from '@/lib/seo';

export function LoginPage() {
  usePageMeta('Account & Cloud Sync — SIRAVEX', 'Sign in to SIRAVEX with Google or email to back up Xtream & M3U playlists in Firebase Cloud across devices.');
  const { user, loading } = useAuth();
  const { playlists, favourites, cloudSyncState, lastCloudSyncAt, syncCloudNow, toast } = useStore();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); navigate('/playlists'); } catch (e) { setError(authErrorMessage(e)); } finally { setBusy(false); }
  };

  if (!loading && user) {
    const cloudCount = playlists.filter((p) => p.type !== 'demo' && p.cloudSynced).length;
    return (
      <div className="mx-auto w-full max-w-lg">
        <Card className="text-center">
          {user.photoURL ? (
            <img src={user.photoURL} alt="" width={68} height={68} className="mx-auto h-[68px] w-[68px] rounded-full border border-sky-400/40" />
          ) : (
            <img src="/icons/logo-256.png" alt="" width={68} height={68} className="mx-auto h-[68px] w-[68px] rounded-2xl" />
          )}
          <h1 className="mt-3 text-xl font-extrabold">{user.displayName || 'SIRAVEX Pro User'}</h1>
          <p className="mt-1 text-sm text-muted">{user.email}</p>

          <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-3.5 text-left">
            <p className="flex items-center gap-2 text-sm font-extrabold text-emerald-300">
              <CheckCircle2 size={17} aria-hidden />Firebase Cloud Vault Active
            </p>
            <p className="mt-1 text-xs leading-5 text-silver/85">
              <strong>{cloudCount}</strong> playlist(s) aur <strong>{favourites.length}</strong> favourite(s) AES-256 encryption ke saath aapke Firebase account mein mehfooz hain.
              {lastCloudSyncAt ? ` Last synced ${new Date(lastCloudSyncAt).toLocaleTimeString()}.` : ''}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              disabled={cloudSyncState === 'syncing'}
              onClick={async () => {
                try {
                  const { pushed, pulled } = await syncCloudNow();
                  toast({ tone: 'success', title: 'Cloud Synced', body: `Pushed ${pushed} · Restored ${pulled}` });
                } catch (e) {
                  toast({ tone: 'error', title: 'Sync Error', body: e instanceof Error ? e.message : 'Failed' });
                }
              }}
            >
              <RefreshCw size={15} className={cloudSyncState === 'syncing' ? 'animate-spin' : ''} aria-hidden />
              {cloudSyncState === 'syncing' ? 'Syncing…' : 'Sync Cloud Now'}
            </Button>
            <Link to="/playlists"><Button><ListVideo size={16} aria-hidden />Manage Playlists</Button></Link>
            <Button variant="ghost" onClick={() => void signOutUser()}>Logout</Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="mb-4 text-center">
        <img src="/icons/logo-256.png" alt="SIRAVEX" width={60} height={60} className="mx-auto h-[60px] w-[60px] rounded-2xl shadow-glow" />
        <h1 className="mt-3 text-2xl font-extrabold">{mode === 'login' ? 'Sign in to Cloud Vault' : 'Create Cloud Account'}</h1>
        <p className="mt-1 text-sm text-muted">
          Apni Xtream Codes aur M3U playlists encrypted Firebase Cloud mein save karein taake kisi bhi device par login karte hi aapke channels ajayein.
        </p>
      </div>
      <Card>
        <Button className="w-full" disabled={busy} onClick={() => void run(signInWithGoogle)}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.6h3.2c1.9-1.8 3-4.4 3-7.5Z"/><path fill="#fff" opacity=".85" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.2H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#fff" opacity=".7" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z"/><path fill="#fff" opacity=".55" d="M12 5.9c1.5 0 2.8.5 3.8 1.5L18.6 4A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.7 9.4 5.9 12 5.9Z"/></svg>
          Google se {mode === 'login' ? 'login' : 'sign up'} karein
        </Button>
        <div className="my-4 flex items-center gap-3 text-xs text-muted" aria-hidden><span className="h-px flex-1 bg-border" />ya email se<span className="h-px flex-1 bg-border" /></div>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void run(() => (mode === 'login' ? signInWithEmail(email, password) : registerWithEmail(name, email, password))); }}>
          {mode === 'register' && <label className="block text-sm font-semibold">Naam<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aapka naam" autoComplete="name" className="mt-1.5" /></label>}
          <label className="block text-sm font-semibold">Email<Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" className="mt-1.5" /></label>
          <label className="block text-sm font-semibold">Password<Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} className="mt-1.5" /></label>
          {error && <p className="rounded-xl bg-red-950/50 p-3 text-sm text-red-200" role="alert">{error}</p>}
          <Button type="submit" disabled={busy}>{mode === 'login' ? <><LogIn size={17} aria-hidden />Login</> : <><UserPlus size={17} aria-hidden />Account banayein</>}</Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          {mode === 'login' ? <>Account nahi hai? <button type="button" className="font-semibold text-cyanx hover:underline" onClick={() => setMode('register')}>Sign up karein</button></> : <>Pehle se account hai? <button type="button" className="font-semibold text-cyanx hover:underline" onClick={() => setMode('login')}>Login karein</button></>}
        </p>
        <p className="mt-3 border-t border-border pt-3 text-[11px] leading-5 text-muted">
          Security: aapke Xtream aur M3U credentials browser ke andar AES-256-GCM se encrypt ho kar aapke private <code>users/&#123;uid&#125;/playlists</code> vault mein save hote hain, jise sirf aapka account khol sakta hai.
        </p>
      </Card>
    </div>
  );
}
