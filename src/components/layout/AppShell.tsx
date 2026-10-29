import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CalendarDays, CircleHelp, Film, Heart, History, Home, ListVideo, MonitorPlay, Search, Settings, Stethoscope, Tv } from 'lucide-react';
import { Button, Logo } from '@/components/ui/ui';
import { useStore } from '@/app/store';

const NAV = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/live', label: 'Live TV', icon: Tv },
  { to: '/movies', label: 'Movies', icon: Film },
  { to: '/series', label: 'Series', icon: MonitorPlay },
  { to: '/epg', label: 'EPG', icon: CalendarDays },
  { to: '/favourites', label: 'Favourites', icon: Heart },
  { to: '/history', label: 'History', icon: History },
  { to: '/playlists', label: 'Playlists', icon: ListVideo },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope },
  { to: '/help', label: 'Help & About', icon: CircleHelp },
];
const MOBILE = NAV.slice(0, 4);

function linkCls({ isActive }: { isActive: boolean }): string {
  return `flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${isActive ? 'bg-sky-500 text-white shadow-glow' : 'text-muted hover:bg-card hover:text-silver'}`;
}

export function AppShell() {
  const navigate = useNavigate();
  const { playlists, items, toasts, dismissToast } = useStore();
  const [q, setQ] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [installEvt, setInstallEvt] = useState<Event | null>(null);
  const [swUpdate, setSwUpdate] = useState(false);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const bip = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', bip);
    const upd = () => setSwUpdate(true);
    window.addEventListener('siravex-sw-update', upd);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('beforeinstallprompt', bip); window.removeEventListener('siravex-sw-update', upd); };
  }, []);
  return (
    <div className="min-h-screen bg-ink text-silver">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-sky-500 focus:px-3 focus:py-2">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-panel px-3 py-4 lg:flex" aria-label="Primary">
        <NavLink to="/" className="mb-6 px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx rounded-xl"><Logo /></NavLink>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">{NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={linkCls}><n.icon size={19} aria-hidden />{n.label}</NavLink>)}</nav>
        <div className="mt-4 rounded-xl border border-border bg-card p-3 text-xs leading-5 text-muted"><p className="font-semibold text-silver">Stay Connected</p><p className="mt-1">Enjoy your own authorized content, anytime, anywhere.</p><p className="mt-2">{playlists.length} source(s) · {items.length} item(s)</p></div>
      </aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-border bg-ink/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-3 py-3 sm:px-5">
            <NavLink to="/" className="lg:hidden"><Logo compact /></NavLink>
            <form className="flex min-w-0 flex-1 items-center gap-2" role="search" onSubmit={(e) => { e.preventDefault(); navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search'); }}>
              <label className="sr-only" htmlFor="global-search">Search channels, movies, series</label>
              <div className="relative min-w-0 flex-1 sm:max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} aria-hidden /><input id="global-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channels, movies, series…" className="min-h-[44px] w-full rounded-full border border-border bg-panel py-2 pl-10 pr-4 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40" /></div>
              <Button type="submit" className="hidden sm:inline-flex">Search</Button>
            </form>
            <span className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs sm:inline-flex ${online ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'}`} role="status"><span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400'}`} />{online ? 'Online' : 'Offline'}</span>
            <span className="hidden rounded-full border border-border px-3 py-1.5 text-xs text-muted md:inline">Guest · local profile</span>
          </div>
          {!online && <div className="bg-amber-950/60 px-4 py-2 text-center text-xs text-amber-200" role="alert">You are offline. Cached app screens remain available; live streams need a connection.</div>}
          {installEvt && <div className="flex flex-wrap items-center justify-center gap-2 bg-sky-950/70 px-4 py-2 text-sm"><span>Install SIRAVEX for an app-like experience.</span><Button onClick={async () => { const ev = installEvt as unknown as { prompt(): Promise<void> }; await ev.prompt(); setInstallEvt(null); }}>Install app</Button><Button variant="ghost" onClick={() => setInstallEvt(null)}>Not now</Button></div>}
          {swUpdate && <div className="flex flex-wrap items-center justify-center gap-2 bg-violet-950/70 px-4 py-2 text-sm"><span>Update available.</span><Button onClick={() => window.dispatchEvent(new Event('siravex-sw-update-accepted'))}>Refresh to update</Button></div>}
        </header>
        <main id="main" className="mx-auto w-full max-w-[1500px] px-3 pb-24 pt-5 sm:px-5 lg:pb-8" tabIndex={-1}><Outlet /></main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Mobile">
        {[...MOBILE, { to: '/more', label: 'More', icon: Settings }].map((n) => (
          n.to === '/more'
            ? <NavLink key="more" to="/settings" className={({ isActive }) => `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${isActive ? 'text-cyanx' : 'text-muted'}`}><Settings size={20} aria-hidden />More</NavLink>
            : <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${isActive ? 'text-cyanx' : 'text-muted'}`}><n.icon size={20} aria-hidden />{n.label}</NavLink>
        ))}
      </nav>
      <div className="pointer-events-none fixed bottom-20 right-3 z-[60] flex w-[min(92vw,360px)] flex-col gap-2 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`pointer-events-auto rounded-xl border p-3 shadow-card ${t.tone === 'error' ? 'border-red-500/50 bg-red-950' : t.tone === 'success' ? 'border-emerald-500/50 bg-emerald-950' : 'border-border bg-panel'}`} role="status"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-bold">{t.title}</p>{t.body && <p className="mt-1 text-xs leading-5 text-muted">{t.body}</p>}</div><button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification" className="grid h-9 w-9 place-items-center rounded-full hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">×</button></div></div>)}
      </div>
    </div>
  );
}
