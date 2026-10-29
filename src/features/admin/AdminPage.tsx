import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { Button, Card, EmptyState, Input, Skeleton } from '@/components/ui/ui';
import { useAuth } from '@/services/firebase/AuthContext';
import { fetchAllUsers, publishAnnouncement, type AdminUserRow } from '@/services/firebase/tracking';
import { usePageMeta } from '@/lib/seo';

function ago(ts?: { toMillis?: () => number }): string {
  const ms = ts?.toMillis?.();
  if (!ms) return '—';
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (m < 1) return 'abhi online';
  if (m < 60) return `${m} min pehle`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ghante pehle`;
  return `${Math.round(h / 24)} din pehle`;
}
const fmtSecs = (s?: number) => (s ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : '0m');

export function AdminPage() {
  usePageMeta('Admin — SIRAVEX', 'SIRAVEX admin dashboard: users, activity and update announcements.');
  const { user, loading, isAdmin } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [version, setVersion] = useState('');
  const [annBusy, setAnnBusy] = useState(false);
  const [annNote, setAnnNote] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try { setUsers(await fetchAllUsers()); }
    catch { setErr('Users load nahi hue. Aksar wajah: Firestore Rules deploy nahi huin. Repo ki firestore.rules file ko Firebase Console → Firestore → Rules mein publish karein, aur check karein ke aapka email firebase.ts ke ADMIN_EMAILS mein hai.'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!user) return <EmptyState title="Login required" body="Admin panel dekhne ke liye pehle admin account se login karein." action={<Link to="/login"><Button>Login page</Button></Link>} />;
  if (!isAdmin) return <EmptyState title="Admin access nahi hai" body={`Aap ${user.email ?? 'is account'} se login hain, jo admin list mein nahi hai. Admin emails src/services/firebase/firebase.ts mein ADMIN_EMAILS se control hote hain (aur Firestore rules se enforce hote hain).`} action={<Link to="/"><Button>Home</Button></Link>} />;

  const online = (users ?? []).filter((u) => { const ms = u.lastSeenAt?.toMillis?.(); return ms && Date.now() - ms < 2 * 60000; }).length;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-500/20 text-violet-300"><ShieldCheck size={22} aria-hidden /></span>
        <div className="min-w-0 flex-1"><h1 className="text-xl font-extrabold sm:text-2xl">Admin Dashboard</h1><p className="truncate text-sm text-muted">{user.email} · sirf admin ko nazar aata hai</p></div>
        <Button variant="outline" onClick={() => void load()} disabled={busy}><RefreshCw size={16} aria-hidden />{busy ? 'Loading…' : 'Refresh'}</Button>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        {[['Total users', String(users?.length ?? '—')], ['Abhi online', String(users ? online : '—')], ['Total watch sessions', String((users ?? []).reduce((a, u) => a + (u.watchSessions ?? 0), 0))]].map(([k, v]) => (
          <Card key={k} className="p-3 text-center sm:p-4"><p className="text-lg font-extrabold sm:text-2xl">{v}</p><p className="text-[11px] uppercase tracking-wide text-muted">{k}</p></Card>
        ))}
      </div>

      <Card className="mb-4">
        <h2 className="flex items-center gap-2 font-extrabold"><Users size={18} className="text-cyanx" aria-hidden />Users — kis ne kya dekha, kab active tha</h2>
        {err && <p className="mt-3 rounded-xl bg-amber-950/60 p-3 text-sm leading-6 text-amber-200" role="alert">{err}</p>}
        {busy && !users && <div className="mt-4 grid gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
        {users && users.length === 0 && !err && <p className="mt-3 text-sm text-muted">Abhi koi login user record nahi hua. Jab koi Google/email se login karega, woh yahan nazar ayega.</p>}
        {users && users.length > 0 && (
          <div className="nice-scroll mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead><tr className="border-b border-border text-xs uppercase tracking-wide text-muted">{['User', 'IP address', 'Last watched', 'Sessions', 'Watch time', 'Last active'].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.uid} className="border-b border-border/60 align-top">
                    <td className="px-2 py-2.5"><span className="flex items-center gap-2">{u.photoURL ? <img src={u.photoURL} alt="" width={28} height={28} className="h-7 w-7 rounded-full" loading="lazy" /> : <span className="grid h-7 w-7 place-items-center rounded-full bg-sky-500/25 text-xs font-bold">{(u.displayName || u.email || '?').slice(0, 1).toUpperCase()}</span>}<span className="min-w-0"><span className="block max-w-[180px] truncate font-semibold">{u.displayName || '—'}</span><span className="block max-w-[180px] truncate text-xs text-muted">{u.email || u.uid.slice(0, 8)}</span></span></span></td>
                    <td className="px-2 py-2.5 font-mono text-xs">{u.lastIp || '—'}</td>
                    <td className="px-2 py-2.5"><span className="block max-w-[220px] truncate font-medium" title={u.lastWatched?.title}>{u.lastWatched?.title || '—'}</span><span className="text-xs text-muted">{u.lastWatched ? `${u.lastWatched.kind}${u.lastWatched.group ? ` · ${u.lastWatched.group}` : ''}` : ''}</span></td>
                    <td className="px-2 py-2.5 tabular-nums">{u.watchSessions ?? 0}</td>
                    <td className="px-2 py-2.5 tabular-nums">{fmtSecs(u.watchSeconds)}</td>
                    <td className="px-2 py-2.5 text-xs">{ago(u.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-5 text-muted">Privacy: stream URLs/tokens kabhi track nahi hote — sirf channel ke naam, qisam aur waqt. IP address sirf admin ko nazar aata hai aur login par update hota hai.</p>
      </Card>

      <Card>
        <h2 className="flex items-center gap-2 font-extrabold"><Megaphone size={18} className="text-cyanx" aria-hidden />Update announcement — tamam users ko banner nazar ayega</h2>
        <form className="mt-3 grid gap-3" onSubmit={(e) => { e.preventDefault(); setAnnBusy(true); setAnnNote(''); void publishAnnouncement({ title: title.trim(), body: body.trim(), version: version.trim() || undefined, active: true }).then(() => { setAnnNote('Announcement live ho gaya — users ko agli dafa app kholne par banner nazar ayega.'); setTitle(''); setBody(''); setVersion(''); }).catch(() => setAnnNote('Publish nahi hua — Firestore rules check karein (announcements par admin write).')).finally(() => setAnnBusy(false)); }}>
          <label className="block text-sm font-semibold">Title<Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="SIRAVEX v3.1 aa gaya!" className="mt-1.5" /></label>
          <label className="block text-sm font-semibold">Message<Input value={body} onChange={(e) => setBody(e.target.value)} required placeholder="Naye features: …" className="mt-1.5" /></label>
          <label className="block max-w-[220px] text-sm font-semibold">Version (optional)<Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="3.1.0" className="mt-1.5" /></label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={annBusy}>{annBusy ? 'Publishing…' : 'Publish announcement'}</Button>
            <Button type="button" variant="outline" disabled={annBusy} onClick={() => { setAnnBusy(true); void publishAnnouncement({ title: '', body: '', active: false }).then(() => setAnnNote('Announcement band kar diya gaya.')).catch(() => setAnnNote('Band nahi hua — rules check karein.')).finally(() => setAnnBusy(false)); }}>Announcement band karein</Button>
          </div>
          {annNote && <p className="text-sm text-cyanx" role="status">{annNote}</p>}
        </form>
      </Card>
    </div>
  );
}
