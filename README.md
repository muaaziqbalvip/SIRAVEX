# SIRAVEX — Premium IPTV & Universal Media Player

Installable PWA for playing **your own authorized** IPTV and media sources. SIRAVEX bundles **no** channels, movies, credentials or playlists. Demo content is limited to clearly labelled, legally usable sample streams (Big Buck Bunny / Tears of Steel test streams).

![Brand direction](public/icons/icon-512.png)

## Quick start

- **Node.js:** 20+ (built and verified on Node 22), npm 10+
- Install: `npm install`
- Dev server: `npm run dev` → http://localhost:5173
- Tests: `npm test`
- Type check / lint: `npm run typecheck` (strict TypeScript; `npm run lint` is the same gate)
- Production build: `npm run build` → output in `dist/`
- Preview build: `npm run preview`

No environment variables, API keys or backend are required. See `.env.example`. Never prefix secrets with `VITE_` — Vite exposes those to the browser bundle.

## Using SIRAVEX

1. **Import a playlist:** Playlists → M3U file (≤15 MB, parsed on-device with preview + warnings), M3U URL (browser fetch; may be blocked by CORS), or Xtream Codes (server/username/password, used only for that request, never stored or logged). Or add the **labelled demo samples**.
2. **Watch:** Live TV / Movies / Series group your items automatically. Series episodes group via `S01E02` titles or `/series/` URLs; movies via groups or `/movie/` URLs. Open any item for the real player.
3. **EPG:** EPG page → Import XMLTV file (≤25 MB). Programmes match channels by `tvg-id`; times honour XMLTV timezone offsets. No EPG is ever invented.
4. **Playback formats:** HLS `.m3u8` (native Safari or HLS.js), DASH `.mpd` (Shaka Player, loaded on demand), MP4/WebM (native). RTSP/RTMP/raw `.ts` cannot play in browsers — your provider must supply HLS/DASH or an authorized gateway. Test playback with the demo samples before using your own source.
5. **Install (PWA):** Chrome/Edge on Android/desktop: Install prompt or browser menu → Install. Safari iOS/iPadOS: Share → Add to Home Screen. Offline keeps the app shell + local data; live streams need internet.
6. **Privacy:** Everything (playlists, EPG, favourites, progress, settings) lives only in this browser (IndexedDB + local settings). Diagnostics and exports show hosts only — never full private URLs, tokens or passwords.

## Architecture

```
src/app (router, store) · src/components (ui, layout, media) · src/features/* (one folder per route)
src/playback/engine.ts (single-owner PlaybackEngine; lazy HLS.js/Shaka adapters, error mapper, capabilities)
src/services/playlist/m3u.ts · src/services/epg/xmltv.ts · src/services/storage/db.ts (versioned IndexedDB v1)
```

Key rules enforced in code: one player instance with full cleanup, bounded retry (×1 reload then mapped error), seek only when seekable, no fake Live seek bar, track/quality menus built only from real engine data, keyboard shortcuts ignored while typing.

## Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (New Project → Import Git Repository).
2. Framework preset: **Vite**. Build command `npm run build`, output directory `dist` (also pinned in `vercel.json`). No environment variables needed.
3. Deploy. `vercel.json` provides the SPA fallback and basic security headers. SIRAVEX uses hash-based routes, so deep links (e.g. `/#/live`) refresh correctly even without rewrites; verify after deploy: homepage, a nested route refresh, `/manifest.webmanifest`, `/sw.js`, `/icons/icon-192.png`, playlist import, demo playback, and the production console.
4. Preview deployments: every pull request/branch gets a Vercel preview URL automatically with Git integration. The service worker only registers over HTTPS (or localhost).

## Troubleshooting

- **URL import fails / “could not fetch”:** usually CORS or provider browser-blocking. Frontend header changes cannot bypass CORS; SIRAVEX offers no unrestricted proxy. Download the M3U file from your provider and import it locally. Stream CORS is separate from playlist CORS.
- **“Unsupported format”:** RTSP/RTMP/.ts or unsupported codec (prefer H.264/AAC). Ask your provider for HLS/DASH.
- **No EPG:** import XMLTV and ensure channel `tvg-id`s match XMLTV channel ids.
- **No install prompt:** iOS Safari has no programmatic prompt (Share → Add to Home Screen); the service worker requires HTTPS in production.
- **Storage errors:** private browsing/quota — the app keeps working for the session and says so instead of crashing.

## Testing & QA

`npm test` runs 21 Vitest tests (M3U parsing, XMLTV/timezones, URL/security helpers, playback error mapping, UI primitives) against synthetic fixtures in `src/test/fixtures/`. Playwright E2E is not bundled — the 11 manual E2E flows are listed in `docs/QA-REPORT.md`. See that file for the full QA, UI/UX audit, security review, feature matrix and known limitations.

## Security notes

No `eval`, no provider HTML rendering, no credentials in logs/diagnostics/exports, bounded fetch timeouts (20–25 s) and file-size limits, client-only architecture (no server fetch endpoint, therefore no SSRF surface). Report details: `docs/QA-REPORT.md`.
