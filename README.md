<div align="center">

<img src="public/icons/icon-512.png" alt="SIRAVEX" width="120" />

# SIRAVEX — Premium IPTV & Universal Media Player

**Live TV · Movies · Series · EPG · Xtream Codes · Play Any Stream**

[![Version](https://img.shields.io/badge/version-2.0.0-0ea5e9?style=for-the-badge&logo=semver&logoColor=white)](https://github.com/muaaziqbalvip/SIRAVEX)
[![Build](https://img.shields.io/badge/build-passing-22c55e?style=for-the-badge&logo=vite&logoColor=white)](#testing--qa)
[![Tests](https://img.shields.io/badge/tests-33%20passing-22c55e?style=for-the-badge&logo=vitest&logoColor=white)](#testing--qa)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![PWA](https://img.shields.io/badge/PWA-installable-7c3aed?style=for-the-badge&logo=pwa&logoColor=white)](#install-pwa)
[![HLS.js](https://img.shields.io/badge/HLS.js-HLS-f59e0b?style=for-the-badge)](https://github.com/video-dev/hls.js)
[![Shaka Player](https://img.shields.io/badge/Shaka-DASH-ef4444?style=for-the-badge)](https://github.com/shaka-project/shaka-player)
[![mpegts.js](https://img.shields.io/badge/mpegts.js-TS%20%2F%20FLV-06b6d4?style=for-the-badge)](https://github.com/xqq/mpegts.js)
[![Vercel](https://img.shields.io/badge/deploy-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](#deploy-to-vercel)
[![License](https://img.shields.io/badge/license-MIT-94a3b8?style=for-the-badge)](#security-notes)

</div>

Installable PWA for playing **your own authorized** IPTV and media sources. SIRAVEX bundles **no** channels, movies, credentials or playlists. Demo content is limited to clearly labelled, legally usable sample streams (Big Buck Bunny / Tears of Steel test streams).

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
4. **Playback formats (v2):** HLS `.m3u8` (native Safari or HLS.js) · DASH `.mpd` — **including token links like `…/render.mpd?auth=…&channel_id=…&q=auto`** (detection reads the pathname, so auth queries never break it) · **MPEG-TS `.ts` and FLV `.flv` via mpegts.js** · MP4/WebM/MOV/MKV (native attempt). RTSP/RTMP still cannot play in any browser without an authorized gateway.
5. **Play Any Stream:** the *Play Stream* page plays any single authorized URL with Auto-Detect or a forced format chip, plus optional provider-issued ClearKey (`kid:key`) / Widevine licence configuration for DASH — keys are only configured into the player, never extracted or bypassed. The player shows live Format / Quality (+kbps) / Resolution / Audio / Subtitles / Buffer / Dropped-frames chips, all from the real engine.
6. **Xtream Codes:** Playlists → Xtream Codes uses the real `player_api.php` API (Live + VOD with posters/ratings + Series episodes) and fetches the full `xmltv.php` EPG automatically, with a per-source **Fetch EPG** refresh.
7. **Install (PWA):** Chrome/Edge on Android/desktop: Install prompt or browser menu → Install. Safari iOS/iPadOS: Share → Add to Home Screen. Offline keeps the app shell + local data; live streams need internet.
8. **Privacy:** Everything (playlists, EPG, favourites, progress, settings) lives only in this browser (IndexedDB + local settings). Diagnostics and exports show hosts only — never full private URLs, tokens or passwords.

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
