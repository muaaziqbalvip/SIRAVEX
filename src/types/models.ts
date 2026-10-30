export type MediaKind = 'live' | 'movie' | 'series';
export type SourceType = 'file' | 'url' | 'xtream' | 'demo';

export interface PlaylistSource {
  id: string;
  name: string;
  type: SourceType;
  url?: string; // never log in full; may contain credentials for xtream-derived urls
  server?: string;
  username?: string;
  /** Password is stored ONLY when the user explicitly opts in ("remember on this device"). Never logged/exported. */
  password?: string;
  hasPassword?: boolean;
  enabled: boolean;
  isDefault: boolean;
  itemCount: number;
  createdAt: number;
  lastImportedAt?: number;
  lastEpgAt?: number;
  lastError?: string;
}

export interface MediaItem {
  id: string;
  playlistId: string;
  kind: MediaKind;
  title: string;
  url: string;
  logo?: string;
  poster?: string;
  backdrop?: string;
  group: string;
  tvgId?: string;
  /** Xtream stream id (used for short-EPG lookups). */
  streamId?: string;
  /** Xtream series id when this item is a series placeholder whose episodes load on demand. */
  seriesId?: string;
  episodesLoaded?: boolean;
  year?: number;
  rating?: number;
  durationLabel?: string;
  genre?: string;
  description?: string;
  seriesTitle?: string;
  season?: number;
  episode?: number;
  /** Optional format/DRM/referrer hints supplied by authorized M3U (#KODIPROP / #EXTVLCOPT). */
  forcedFormat?: string;
  drmClearKeys?: Record<string, string>;
  drmLicenseUrl?: string;
  referrer?: string;
}

export interface EpgProgramme {
  id: string;
  playlistId?: string;
  channelId: string;
  title: string;
  description?: string;
  start: number;
  end: number;
}

export interface Favourite { id: string; itemId: string; createdAt: number; sortOrder?: number }
export interface WatchProgress { itemId: string; position: number; duration: number; updatedAt: number; completed: boolean }
export interface PlaybackDiagnostic { id: string; at: number; category: string; message: string; urlHost?: string }

export interface AppSettings {
  theme: 'dark' | 'light' | 'system';
  accent: 'sky' | 'cyan' | 'violet' | 'emerald';
  density: 'comfortable' | 'compact';
  reducedMotion: boolean;
  autoplay: boolean;
  resumePlayback: boolean;
  defaultVolume: number;
  playbackSpeed: number;
  audioLanguage: string;
  subtitleLanguage: string;
  subtitleSize: 'small' | 'medium' | 'large';
  subtitleColor: string;
  defaultHome: string;
  librarySort: 'title' | 'recent' | 'group';
  liveLayout: 'list' | 'grid';
  showAds: boolean;
  saveRecentSearches: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark', accent: 'sky', density: 'comfortable', reducedMotion: false,
  autoplay: true, resumePlayback: true, defaultVolume: 0.8, playbackSpeed: 1,
  audioLanguage: '', subtitleLanguage: '', subtitleSize: 'medium', subtitleColor: '#ffffff',
  defaultHome: '/', librarySort: 'title', liveLayout: 'list', saveRecentSearches: true, showAds: true,
};

export interface ParseReport { total: number; imported: number; warnings: string[]; errors: string[] }
export interface ParsedPlaylist { items: Omit<MediaItem, 'id' | 'playlistId'>[]; report: ParseReport }
