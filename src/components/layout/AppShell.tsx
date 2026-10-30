import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpen, CalendarDays, CheckCircle2, CircleHelp, Cloud, Film, Grid2x2,
  Heart, History, Home, LayoutGrid, ListVideo, Lock, LockOpen, LogIn,
  MonitorPlay, Newspaper, Radio, RefreshCw, Search, Settings, ShieldCheck,
  Stethoscope, Tv, X,
} from 'lucide-react';
import { Button, Logo } from '@/components/ui/ui';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { PinModal } from '@/components/ui/PinModal';
import { useStore } from '@/app/store';
import { useAuth } from '@/services/firebase/AuthContext';
import { fetchAnnouncement, type Announcement } from '@/services/firebase/tracking';
import { isParentalActive } from '@/lib/parental';
import { consumeVersionChange } from '@/lib/update';
import { APP_VERSION, APP_CODENAME } from '@/lib/version';
import { warmPlaybackEngines } from '@/playback/engine';

const NAV = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/live', label: 'Live TV', icon: Tv },
  { to: '/multiview', label: 'Multi-View', icon: Grid2x2 },
  { to: '/movies', label: 'Movies', icon: Film },
  { to: '/series', label: 'Series', icon: MonitorPlay },
  { to: '/direct', label: 'Play Stream', icon: Radio },
  { to: '/epg', label: 'TV Guide', icon: CalendarDays },
  { to: '/favourites', label: 'Favourites', icon: Heart },
  { to: '/history', label: 'History', icon: History },
  { to: '/playlists', label: 'Playlists & Cloud', icon: ListVideo },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/diagnostics', label: 'Diagnostics', icon: Stethoscope },
  { to: '/help', label: 'Help & About', icon: CircleHelp },
  { to: '/blog', label: 'Blog', icon: Newspaper },
  { to: '/guides', label: 'Guides', icon: BookOpen },
];
const MOBILE_MAIN = [NAV[0], NAV[1], NAV[2], NAV[3]];

function linkCls({ isActive }: { isActive: boolean }): string {
  return `flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${isActive ? 'bg-sky-500 text-white shadow-glow' : 'text-muted hover:bg-card hover:text-silver'}`;
}

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    playlists, items, toasts, dismissToast, settings, toast,
    cloudSyncState, syncCloudNow, parentalUnlocked, lockParentalNow,
  } = useStore();
  const { user, isAdmin } = useAuth();
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [q, setQ] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [installEvt, setInstallEvt] = useState<Event | null>(null);
  const [installDismissed, setInstallDismissed] = useState(() => {
    try { return sessionStorage.getItem('siravex-install-dismissed') === '1'; } catch { return false; }
  });
  const [swUpdate, setSwUpdate] = useState(false);

  useEffect(() => {
    warmPlaybackEngines();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const bip = (e: Event) => { e.preventDefault(); setInstallEvt(e); };
    window.addEventListener('beforeinstallprompt', bip);
    const upd = () => setSwUpdate(true);
    window.addEventListener('siravex-sw-update', upd);
    if (settings.defaultHome && settings.defaultHome !== '/' && window.location.pathname === '/') {
      navigate(settings.defaultHome, { replace: true });
    }
    if (consumeVersionChange()) {
      toast({
        tone: 'success',
        title: `SIRAVEX v${APP_VERSION} (${APP_CODENAME}) active`,
        body: 'Turbo Channel Zapping, Full-View Mobile Player Dock aur Clean Home Layout ab live hain.',
      });
    }
    void fetchAnnouncement().then((a) => {
      if (!a) return;
      try { if (sessionStorage.getItem('siravex-ann-dismissed') === `${a.title}|${a.version ?? ''}`) return; } catch { /* ignore */ }
      setAnnouncement(a);
    });
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('beforeinstallprompt', bip);
      window.removeEventListener('siravex-sw-update', upd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global Ctrl+K / Cmd+K Command Palette shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (location.pathname === '/search') {
      const sp = new URLSearchParams(location.search);
      setQ(sp.get('q') ?? '');
    }
  }, [location.pathname, location.search]);

  const parentalOn = isParentalActive(settings);

  return (
    <div className="min-h-screen bg-ink text-silver">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-sky-500 focus:px-3 focus:py-2">Skip to content</a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-panel px-3 py-4 lg:flex" aria-label="Primary">
        <NavLink to="/" className="mb-5 rounded-xl px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><Logo /></NavLink>
        <nav className="nice-scroll flex flex-1 flex-col gap-1 overflow-y-auto pr-0.5">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={linkCls}>
              <n.icon size={19} aria-hidden />
              <span className="truncate">{n.label}</span>
              {n.to === '/multiview' && (
                <span className="ml-auto rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-cyanx">
                  PRO
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <img src="/icons/logo-256.png" alt="" width={40} height={40} className="h-10 w-10 rounded-[10px]" loading="lazy" />
          <div className="min-w-0 flex-1 text-xs leading-5 text-muted">
            <p className="flex items-center justify-between font-semibold text-silver">
              <span>SIRAVEX {APP_VERSION}</span>
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-extrabold text-cyanx">ULTRA</span>
            </p>
            <p className="truncate">{playlists.length} source(s) · {items.length.toLocaleString()} item(s)</p>
          </div>
        </div>
      </aside>

      <div className="min-w-0 lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-border bg-ink/95 backdrop-blur">
          <div className="mx-auto flex w-full min-w-0 max-w-[1500px] items-center gap-2 px-3 py-2.5 sm:gap-2.5 sm:px-5">
            <NavLink to="/" className="shrink-0 lg:hidden" aria-label="SIRAVEX home"><Logo compact /></NavLink>

            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search');
              }}
            >
              <label className="sr-only" htmlFor="global-search">Search channels, movies, series</label>
              <div className="relative min-w-0 flex-1 sm:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={17} aria-hidden />
                <input
                  id="global-search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search channels, movies…"
                  className="min-h-[40px] w-full rounded-full border border-border bg-panel py-1.5 pl-9 pr-3 text-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 sm:min-h-[42px] sm:pl-10 sm:pr-14"
                />
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  title="Open Quick Command Palette (Ctrl+K)"
                  aria-label="Open Quick Command Palette"
                  className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full border border-border bg-card px-2 py-0.5 font-mono text-[10px] font-bold text-cyanx hover:border-sky-400 sm:inline-flex"
                >
                  ⌘K
                </button>
              </div>
              <Button type="submit" className="hidden min-h-[42px] sm:inline-flex">Search</Button>
            </form>

            {/* Parental Lock Status Pill */}
            {parentalOn && (
              <button
                type="button"
                onClick={() => (parentalUnlocked ? lockParentalNow() : setPinModalOpen(true))}
                title={parentalUnlocked ? 'Parental Lock unlocked — click to re-lock immediately' : 'Parental Lock active — click to enter PIN'}
                className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition ${
                  parentalUnlocked
                    ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-950/40 text-amber-300'
                }`}
              >
                {parentalUnlocked ? <LockOpen size={14} aria-hidden /> : <Lock size={14} aria-hidden />}
                <span className="hidden md:inline">{parentalUnlocked ? 'Unlocked' : 'PIN Locked'}</span>
              </button>
            )}

            {/* Firebase Cloud Sync Status Pill */}
            {user && settings.cloudSyncEnabled && (
              <button
                type="button"
                onClick={() => {
                  void syncCloudNow()
                    .then(({ pushed, pulled }) => toast({ tone: 'success', title: 'Firebase Cloud Vault Synced', body: `Saved ${pushed} · Restored ${pulled} playlist(s).` }))
                    .catch((e) => toast({ tone: 'error', title: 'Cloud Sync Error', body: e instanceof Error ? e.message : 'Sync failed' }));
                }}
                title="Sync playlists & Xtream accounts with Firebase Cloud"
                className="hidden min-h-[38px] shrink-0 items-center gap-1.5 rounded-full border border-sky-500/35 bg-sky-950/35 px-3 text-xs font-semibold text-cyanx hover:border-sky-400 sm:inline-flex"
              >
                {cloudSyncState === 'syncing' ? (
                  <RefreshCw size={13} className="animate-spin" aria-hidden />
                ) : cloudSyncState === 'synced' ? (
                  <CheckCircle2 size={14} className="text-emerald-300" aria-hidden />
                ) : (
                  <Cloud size={14} aria-hidden />
                )}
                <span className="hidden xl:inline">{cloudSyncState === 'syncing' ? 'Syncing…' : 'Cloud Vault'}</span>
              </button>
            )}

            <span className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs md:inline-flex ${online ? 'border-emerald-500/40 text-emerald-300' : 'border-amber-500/40 text-amber-300'}`} role="status">
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {online ? 'Online' : 'Offline'}
            </span>

            {isAdmin && (
              <button type="button" onClick={() => navigate('/admin')} aria-label="Admin dashboard" className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full border border-violet-500/50 text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">
                <ShieldCheck size={19} />
              </button>
            )}

            {user ? (
              <button type="button" onClick={() => navigate('/login')} aria-label="My account" className="flex shrink-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" width={38} height={38} className="h-[38px] w-[38px] rounded-full border border-border" />
                ) : (
                  <span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-sky-500 text-sm font-extrabold text-white">
                    {(user.displayName || user.email || 'S').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="hidden max-w-[110px] truncate text-left text-xs font-semibold xl:block">{user.displayName || 'Account'}</span>
              </button>
            ) : (
              <Button className="min-h-[42px] shrink-0 px-3.5" onClick={() => navigate('/login')}>
                <LogIn size={16} aria-hidden /><span className="hidden sm:inline">Login</span>
              </Button>
            )}
          </div>

          {!online && <div className="bg-amber-950/60 px-4 py-2 text-center text-xs text-amber-200" role="alert">You are offline. Cached app screens remain available; live streams need a connection.</div>}
          {installEvt && !installDismissed && (
            <div className="flex items-center gap-2 bg-sky-950/90 px-3 py-1.5 text-xs sm:justify-center sm:text-sm" role="region" aria-label="Install SIRAVEX">
              <img src="/icons/logo-256.png" alt="" width={22} height={22} className="h-[22px] w-[22px] shrink-0 rounded-md" />
              <span className="min-w-0 flex-1 truncate sm:flex-none">Install SIRAVEX — fast, app-like Pro IPTV experience.</span>
              <Button className="min-h-[36px] shrink-0 px-3 py-1 text-xs" onClick={async () => { const ev = installEvt as unknown as { prompt(): Promise<void> }; await ev.prompt(); setInstallEvt(null); }}>Install</Button>
              <button type="button" aria-label="Dismiss install prompt" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10" onClick={() => { setInstallDismissed(true); try { sessionStorage.setItem('siravex-install-dismissed', '1'); } catch { /* ignore */ } }}>✕</button>
            </div>
          )}
          {swUpdate && (
            <div className="flex flex-wrap items-center justify-center gap-2 bg-violet-950/70 px-4 py-2 text-sm">
              <span>A new version of SIRAVEX is ready.</span>
              <Button onClick={() => window.dispatchEvent(new Event('siravex-sw-update-accepted'))}>Refresh to update</Button>
            </div>
          )}
          {announcement && (
            <div className="flex items-center gap-2 bg-emerald-950/80 px-3 py-2 text-xs sm:justify-center sm:text-sm" role="region" aria-label="Announcement">
              <span className="min-w-0 flex-1 sm:flex-none"><strong>{announcement.title}</strong>{announcement.body ? <span className="text-silver/85"> — {announcement.body}</span> : null}</span>
              <button type="button" aria-label="Dismiss announcement" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/10" onClick={() => { setAnnouncement(null); try { sessionStorage.setItem('siravex-ann-dismissed', `${announcement.title}|${announcement.version ?? ''}`); } catch { /* ignore */ } }}>✕</button>
            </div>
          )}
        </header>

        <main id="main" className="mx-auto w-full min-w-0 max-w-[1500px] px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-3.5 sm:px-5 sm:pt-5 lg:pb-8" tabIndex={-1}>
          {/* Keep /player/* mounted across channel switches so Fullscreen & GPU video pipeline stay hot! */}
          <div key={location.pathname.startsWith('/player/') ? '/player' : location.pathname} className="svx-page"><Outlet /></div>
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-panel/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Mobile">
        {MOBILE_MAIN.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `flex min-h-[54px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${isActive ? 'text-cyanx' : 'text-muted'}`}
          >
            <n.icon size={21} aria-hidden />{n.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen} className="flex min-h-[54px] flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">
          <LayoutGrid size={21} aria-hidden />More
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-[65] lg:hidden" role="dialog" aria-modal="true" aria-label="More menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/70" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[78vh] overflow-y-auto rounded-t-3xl border-t border-border bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <Logo />
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="Close" autoFocus className="grid h-11 w-11 place-items-center rounded-full bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx"><X size={20} /></button>
            </div>
            <nav className="grid grid-cols-2 gap-2">
              {NAV.slice(4).map((n) => (
                <NavLink key={n.to} to={n.to} onClick={() => setMoreOpen(false)} className={({ isActive }) => `flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${isActive ? 'bg-sky-500 text-white' : 'bg-card text-silver'}`}>
                  <n.icon size={19} aria-hidden />{n.label}
                </NavLink>
              ))}
            </nav>
            <p className="mt-3 text-center text-xs text-muted">{playlists.length} source(s) · {items.length.toLocaleString()} item(s)</p>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-20 right-3 z-[60] flex w-[min(92vw,360px)] flex-col gap-2 lg:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-xl border p-3 shadow-card ${t.tone === 'error' ? 'border-red-500/50 bg-red-950' : t.tone === 'success' ? 'border-emerald-500/50 bg-emerald-950' : 'border-border bg-panel'}`} role="status">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{t.title}</p>
                {t.body && <p className="mt-1 text-xs leading-5 text-muted">{t.body}</p>}
                {t.actionTo && (
                  <Link
                    to={t.actionTo}
                    onClick={() => dismissToast(t.id)}
                    className="mt-2 inline-flex rounded-lg bg-sky-500 px-3 py-1 text-xs font-extrabold text-white hover:bg-sky-400"
                  >
                    {t.actionLabel || 'Open'}
                  </Link>
                )}
              </div>
              <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx">×</button>
            </div>
          </div>
        ))}
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <PinModal open={pinModalOpen} onClose={() => setPinModalOpen(false)} />
    </div>
  );
}
