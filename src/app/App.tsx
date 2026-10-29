import { Component, Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorPanel, Skeleton } from '@/components/ui/ui';
import { useStore } from '@/app/store';

const HomePage = lazy(() => import('@/features/home/HomePage').then((m) => ({ default: m.HomePage })));
const LiveTvPage = lazy(() => import('@/features/live-tv/LiveTvPage').then((m) => ({ default: m.LiveTvPage })));
const MoviesPage = lazy(() => import('@/features/movies/MoviesPage').then((m) => ({ default: m.MoviesPage })));
const SeriesPage = lazy(() => import('@/features/series/SeriesPage').then((m) => ({ default: m.SeriesPage })));
const EpgPage = lazy(() => import('@/features/epg/EpgPage').then((m) => ({ default: m.EpgPage })));
const SearchPage = lazy(() => import('@/features/search/SearchPage').then((m) => ({ default: m.SearchPage })));
const PlaylistsPage = lazy(() => import('@/features/playlists/PlaylistsPage').then((m) => ({ default: m.PlaylistsPage })));
const FavouritesPage = lazy(() => import('@/features/favourites/FavouritesPage').then((m) => ({ default: m.FavouritesPage })));
const HistoryPage = lazy(() => import('@/features/history/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const DiagnosticsPage = lazy(() => import('@/features/diagnostics/DiagnosticsPage').then((m) => ({ default: m.DiagnosticsPage })));
const HelpPage = lazy(() => import('@/features/help/HelpPage').then((m) => ({ default: m.HelpPage })));
const PlayerPage = lazy(() => import('@/features/player/PlayerPage').then((m) => ({ default: m.PlayerPage })));

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  render() {
    if (this.state.failed) return <ErrorPanel title="Something went wrong" body="An unexpected error occurred. Your local playlists and settings were not deleted. Reload the page, or open Diagnostics after reloading." onRetry={() => window.location.reload()} />;
    return this.props.children;
  }
}

function Loading() { return <div className="grid gap-3" aria-busy="true" aria-label="Loading page"><Skeleton className="h-10 w-56" /><Skeleton className="h-64" /></div>; }

export function App() {
  const { storageError } = useStore();
  return (
    <ErrorBoundary>
      {storageError && <div className="fixed inset-x-0 top-0 z-[90] bg-amber-950 px-4 py-2 text-center text-xs text-amber-100" role="alert">{storageError}</div>}
      <Suspense fallback={<div className="p-6"><Loading /></div>}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="live" element={<LiveTvPage />} />
            <Route path="movies" element={<MoviesPage />} />
            <Route path="series" element={<SeriesPage />} />
            <Route path="epg" element={<EpgPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="playlists" element={<PlaylistsPage />} />
            <Route path="favourites" element={<FavouritesPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="diagnostics" element={<DiagnosticsPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="player/:id" element={<PlayerPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
