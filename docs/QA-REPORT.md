# SIRAVEX — QA, UI/UX Audit & Security Review (Phases 7–8 + audits)

Generated at handover. Only claims verified in this environment are marked passed.

## Commands actually run

| Command | Result |
|---|---|
| `npm install` | ✅ 516 packages, success |
| `npx tsc -p tsconfig.app.json --noEmit` / `npm run typecheck` | ✅ pass (strict) |
| `npm test` (Vitest) | ✅ **21 passed, 0 failed** (5 files: m3u 4, xmltv 6, security 5, error-mapper 4, UI 2) |
| `npm run build` (`tsc -b && vite build`) | ✅ pass — route-level lazy chunks; HLS (599 kB) and Shaka (778 kB) load only on demand; vendor 214 kB |
| `npm audit --omit=dev` | ⚠️ 2 moderate (react-router, see Security) |
| `npm audit` (all) | ⚠️ 12 total incl. dev-only Vitest/tinypool chain |
| Production preview smoke test | See below — run before handover, result recorded in final message |

## Feature status (honest matrix)

| Area | Status | Evidence |
|---|---|---|
| Foundation, design tokens, app shell, 13 routes, responsive nav | ✅ Implemented | `src/app`, `src/components/layout/AppShell.tsx`; desktop sidebar + mobile bottom nav (5 destinations), skip link, focus rings, toasts |
| Local data (IndexedDB v1, versioned stores, migration hook via `upgrade`) | ✅ Implemented | `src/services/storage/db.ts`; storage failure degrades to session-only with banner |
| M3U file/URL import, preview, warnings, rename/enable/disable/default/refresh/delete | ✅ Implemented + tested | `src/services/playlist/m3u.ts`, Playlists page; fixtures in `src/test/fixtures/` |
| Xtream Codes import | ⚠️ Best-effort | Standard `get.php` flow isolated in store; success depends on provider CORS/browser policy — failure states explain this, nothing is faked |
| XMLTV EPG + now/next + timeline | ✅ Implemented + tested | `src/services/epg/xmltv.ts` (timezone-aware) |
| Playback engine (HTML5/HLS.js/Shaka), retry, error mapping, cleanup | ✅ Implemented | `src/playback/engine.ts` — single video owner, adapters destroyed on switch/unmount; dynamic imports verified in build chunks |
| Player controls, keyboard shortcuts, PiP, theatre, speed | ✅ Implemented | `PlayerShell.tsx`; seek rendered only when seekable & non-live |
| Audio/subtitle/quality menus | ✅ Real-data only | Populated from HLS levels/tracks, Shaka variants, native textTracks; empty state says “managed by stream” |
| Live TV / Movies / Series / EPG / Search / Favourites / History | ✅ Implemented | All read real imported data; empty states explain setup; no fabricated ratings/schedules |
| Settings (theme/accent/density/motion/playback/subtitles/privacy) + reset with confirm | ✅ Implemented | Persisted to localStorage; reset/clear use ConfirmDialog |
| Diagnostics (capabilities, SW, storage, sanitized errors, copy report) | ✅ Implemented | Host-only redaction (`redactUrl`) unit-tested |
| PWA (manifest, 192/512 icons, SW, offline.html, update prompt) | ✅ Build-verified | `dist/manifest.webmanifest`, `dist/sw.js` generated; prompt-update flow via `virtual:pwa-register`. Install itself needs a real HTTPS device check |
| Downloads/offline video | ❌ Not supported (by design) | Documented in Help matrix; offline = shell + local data |
| E2E (Playwright) | ⚠️ Not run | Not bundled to avoid heavyweight browser downloads in CI-less env; manual checklist below |

## UI/UX audit summary

Fixed/applied during build: consistent tokens (ink/panel/card/border/sky-cyan, 44px+ touch targets, `focus-visible` rings), no hover-only actions (favourite/play buttons always visible & focusable), aspect-2/3 cards with lazy images + contained channel logos, capped grids to avoid layout shift, skeleton + empty + error state on every main route, safe-area bottom padding, `overflow-x: hidden` guard, reduced-motion honoured (setting + OS media query), light theme token overrides. Every visible control has a handler — verified by grep-driven review; “More” mobile tab routes to Settings where all secondary pages are linked in the desktop-equivalent list. Remaining polish: virtualized rendering for >1,000-item playlists (currently capped rendering: search 120, EPG 60, lists render fully — acceptable to a few thousand items), richer artwork when providers supply it.

## Security & privacy review

Checked: env usage (none required; `.env.example` documents the no-secrets rule), bundle secrets (no keys committed; build output contains only public sample-stream URLs), logs (single `console.warn` for SW registration, no URLs/credentials), storage (IndexedDB + settings only; Xtream password held in component state, cleared after connect, never persisted), import validation (15/25 MB caps, scheme allowlist rejecting `javascript:`/`data:`, malformed-line warnings), XML (DOMParser + parsererror check, text-only rendering, no XXE surface in browser parsers), fetching (AbortController timeouts 20–25 s, size caps, bounded single retry, no proxy/SSRF surface — no backend exists), SW caching (precache = app shell JS/CSS/HTML/SVG only; images CacheFirst; **no** playlist/stream/auth responses cached), exports (settings + names/types only). Findings: (1) `react-router-dom@6` moderate advisories (open-redirect/SSR hydration) — SIRAVEX is a non-SSR SPA using hash routing, so exploitability is minimal; upgrade to Router 7 is a breaking change deferred deliberately, not force-applied. (2) Dev-only `tinypool`/Vitest advisories do not ship to production. SIRAVEX is **not** claimed “completely secure”; a pre-launch dependency upgrade pass and a real-device PWA/DRM-provider review remain recommended.

## Manual tests still required (cannot be verified headlessly here)

Real-device install (Android Chrome, iOS Safari Add-to-Home-Screen), playback of a user's own authorized provider stream incl. track switching, screen-reader pass (NVDA/VoiceOver), 320/375/430/768/1366/1440 px visual pass, offline reload on device, Vercel preview deep-link refresh. E2E flows to script when Playwright is adopted: open app → import `src/test/fixtures/valid.m3u` → invalid playlist warnings → search → favourite toggle → settings persist → player unsupported-source error → nested-route refresh → manifest/SW presence.

## Known limitations

Xtream/DASH track APIs vary by provider/build; subtitle styling applies to native-rendered cues; very large playlists are capped in search/EPG rendering; hash routing is used deliberately for bulletproof static hosting; light theme is a token-level override of the dark-first design.

## v1.1 — Field-fix release (user-reported: mobile glitch, home/movies/channels, audio/quality, Xtream EPG, brand icon)

Root causes found & fixed:
1. **Mobile screen glitch/flicker** — `saveProgress` created a new store array on every `timeupdate` (4x/sec) re-rendering the whole app during playback. Now: store writes only on >=5s movement/completion flip, DB debounced; cards memoized (`React.memo`); broken provider images render a branded initials fallback instead of a blank box.
2. **Black/frozen video** — engine called `video.load()` after attaching HLS.js MSE, destroying the source buffer. Removed; handlers now register before `loadSource` via `MEDIA_ATTACHED`.
3. **Quality "nahi pakadta"** — Shaka ABR overrode manual picks. Now selecting a rendition disables ABR and locks the matching height; HLS uses `currentLevel` locking + `LEVEL_SWITCHED` shows the real playing rendition (e.g. "Auto · 720p").
4. **Audio tracks missing** — lists now sync on `AUDIO_TRACKS_UPDATED`/`SUBTITLE_TRACKS_UPDATED` (not only manifest parse), with Safari native `audioTracks` fallback; track UI is a touch-friendly sheet, incl. Speed/Theatre/PiP.
5. **Xtream EPG "nahi pakadta"** — old code only fetched `get.php ... output=ts` and never touched EPG. Replaced with the real XC API: `player_api.php` auth/categories/live/VOD/series (+ bounded episode fetch, on-demand placeholders), HLS stream URLs, and `xmltv.php` EPG at connect + "Fetch EPG" per source (Playlists & Guide pages). Short-EPG base64 decoding implemented for fallback data.
6. **Unplayable Xtream/M3U .ts links** — Xtream-shaped `/live|movie|series/.../*.ts` URLs normalize to the provider's own `.m3u8` HLS output; generic .ts remains honestly unsupported.
7. **Brand icon** — the user's supplied logo is now the actual logo everywhere: sidebar, mobile header, more-sheet, home hero, player error, favicon (32/64), apple-touch-icon 180, PWA 192/512 + maskable 512 (generated from the original 1254px artwork).
8. **Mobile navigation** — "More" no longer dumps users into Settings; it opens a bottom sheet with Guide/Favourites/History/Playlists/Settings/Diagnostics/Help. Home rebuilt as OTT rows (rotating hero, Continue Watching, Live horizontal rail with Now titles, Movies/Series/Favourites grids); Live got category chips + capped rendering (400) for huge playlists; Movies got year-from-title, sort (A-Z/year/rating), provider posters/ratings; Series got expandable show cards with on-demand episode loading.

Verification: `npm run typecheck` ✅ · `npm test` ✅ 26/26 (new xtream suite: server normalize, HLS URL building, base64 UTF-8, .ts→.m3u8, year extraction) · `npm run build` ✅ (manifest with new icons, sw.js generated).
Still manual: real-provider Xtream login + EPG on a user account (no credentials available in this sandbox), real-device PWA install, physical-device playback/codec check.

## v2.0 — Layout overhaul + Universal Engine (user screenshots + reference-player parity)

Screenshot-driven layout repairs: provider titles/groups are display-cleaned (VIP tags, crowns, WhatsApp/contact spam stripped — stored data untouched) so long unbroken strings can no longer push cards off-screen; hero title/description clamp with anywhere-wrapping; every grid/flex root carries min-w-0 + w-full + max-w-full; Live/Movies chips are a single scroll rail on all sizes (no 3-row wrap on desktop); sidebar got a thin custom scrollbar; html/body use overflow-x: clip. New: **Play Any Stream** page (auto-detect + forced format, tokenized `render.mpd?auth=…&q=auto` DASH links, optional provider ClearKey/Widevine config, recent hosts redacted). Engine v3 adds **mpegts.js** (MPEG-TS + FLV, lazy 272 kB chunk), Shaka stats (resolution, real bitrate kbps, audio language, dropped frames via getVideoPlaybackQuality), FIT/FILL, snapshot (CORS-permitting), share-title (never shares private URLs), -10s/+10s. Version bumped to 2.0.0 with badge README.
Verification: typecheck ✅ · tests 33/33 ✅ (incl. tokenized-MPD detection + title cleaning) · production build ✅ (37 precache entries). Auth-token stream itself was never fetched, stored or logged during development — only its URL *shape* was tested with a synthetic host.
