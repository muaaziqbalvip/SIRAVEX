<div align="center">

<img src="public/icons/icon-512.png" alt="SIRAVEX" width="128" />

# 📺 SIRAVEX

### Premium IPTV & Universal Media Player

**Live TV · Movies · Series · EPG Guide · Xtream Codes · Play Any Stream**

[![Version](https://img.shields.io/badge/version-3.0.0-0ea5e9?style=for-the-badge&logo=semver&logoColor=white)](https://github.com/muaaziqbalvip/SIRAVEX/releases)
[![Build](https://img.shields.io/badge/build-passing-22c55e?style=for-the-badge&logo=vite&logoColor=white)](#-testing--qa)
[![Tests](https://img.shields.io/badge/tests-46%20passing-22c55e?style=for-the-badge&logo=vitest&logoColor=white)](#-testing--qa)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![PWA](https://img.shields.io/badge/PWA-installable-7c3aed?style=for-the-badge&logo=pwa&logoColor=white)](#-install-pwa)
[![HLS.js](https://img.shields.io/badge/HLS.js-HLS-f59e0b?style=for-the-badge)](https://github.com/video-dev/hls.js)
[![Shaka Player](https://img.shields.io/badge/Shaka-DASH-ef4444?style=for-the-badge)](https://github.com/shaka-project/shaka-player)
[![mpegts.js](https://img.shields.io/badge/mpegts.js-TS%20%2F%20FLV-06b6d4?style=for-the-badge)](https://github.com/xqq/mpegts.js)
[![Vercel](https://img.shields.io/badge/deploy-Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)](#-deploy-to-vercel)
[![License](https://img.shields.io/badge/license-MIT-94a3b8?style=for-the-badge)](#-license)

**Designed & engineered by [Muaaz Iqbal](https://github.com/muaaziqbalvip) — Kasur, Punjab, Pakistan 🇵🇰**

</div>

---

## ✨ What is SIRAVEX?

SIRAVEX is an **installable PWA** for playing **your own authorized** IPTV and media sources — no bundled channels, no credentials, no fake content. Import an M3U file/URL or connect an Xtream Codes account, and get a premium OTT-style player with **real** quality / audio / subtitle switching, a live EPG guide, favourites, watch history with resume, and honest, human-readable playback errors.

> 🔒 **Privacy first:** everything lives in your browser (IndexedDB). Diagnostics and exports show **hosts only** — never full private URLs, tokens, or passwords.

---

## 🔥 v3.0 “Live” — Firebase, accounts, admin, blog & SEO

- **Accounts:** Google sign-in + Email/Password (Firebase Auth). Login is optional — the player and your local library work fully without it.
- **Deep tracking (privacy-bounded):** logged-in users' presence (last active, last IP), last watched channel/movie (title + kind only) and watch time sync to Firestore. **Stream URLs/tokens are never tracked** — enforced by a tested payload builder.
- **Admin dashboard (`/admin`):** user table (IP, last watched, sessions, watch time, last active), live-online counter, and an **announcement publisher** — write an update note once and every user sees the banner.
- **Blog & SEO:** real routes (`/blog`, `/blog/:slug`), OpenGraph/Twitter meta + JSON-LD, `sitemap.xml`, `robots.txt`, `rss.xml`, and per-page titles/descriptions (BrowserRouter).
- **Update system:** new-version toasts with automatic old-cache cleanup, the service-worker "new version ready" banner, and a Settings → *Clear app cache & reload* button.

### Firebase setup (one-time, 5 minutes)

1. Firebase Console → **Authentication → Sign-in method**: enable **Google** and **Email/Password**.
2. **Authentication → Settings → Authorized domains**: add your domain (e.g. `siravex.vercel.app`, `localhost` is pre-added).
3. **Firestore Database → Rules**: paste the repo's [`firestore.rules`](firestore.rules) and Publish (or `firebase deploy --only firestore:rules`). Without this, the admin user list stays empty — by design.
4. Admin access = your email in `ADMIN_EMAILS` (`src/services/firebase/firebase.ts`) **and** in `firestore.rules`. The web `firebaseConfig` in code is a public client identifier — your data is protected by the rules, not by hiding the key.

## 🚀 v2.2 “Nexus” — full playback audit

This release is the result of a **line-by-line audit** of the whole project. Every bug below was reproduced in code review against the installed hls.js / Shaka Player APIs and fixed:

| # | Bug (what you experienced) | Root cause | Fix |
|---|---|---|---|
| 1 | Player showed an error screen for streams that would have recovered | Shaka fires `error` for **RECOVERABLE** problems too — the overlay opened on all of them | Only `severity = CRITICAL` opens the error state; recoverable errors let Shaka retry silently |
| 2 | Subtitles never turned on (HLS/DASH) | `setSubtitle` ran HLS + Shaka + raw `textTracks` handling together; the last loop disabled the track the engine had just enabled | Subtitle routing is now exclusive to the **active engine**; external files get their own path |
| 3 | DASH subtitle panel was always empty | Shaka text tracks don't appear in `video.textTracks` before selection | Panel is built from `player.getTextTracks()` with real selection by track id |
| 4 | Switching channels quickly played the wrong channel / random errors | Async loads raced — a slow previous load attached after the new one | Every load carries a generation number; stale loads can never touch state or the video element |
| 5 | Movies briefly showed a LIVE badge and no seek bar | `duration = NaN` (before metadata) was treated as live | Live only when `duration === Infinity` |
| 6 | Reload loops after switching away from native playback | `<video>` error events fired by adapter teardown triggered a full reload | Video-error handling restricted to native playback only |
| 7 | Random extension-less links failed as “DASH” | URLs containing `/stream`, `/live`, `/playlist` were guessed as DASH | Only explicit DASH hints (`render`, `?format=mpd`, …) classify as DASH |
| 8 | iPhone/Safari showed an empty Audio panel | Native HLS never published its audio renditions | Safari `video.audioTracks` are now listed and switchable |
| 9 | Refreshing a deep route in the installed PWA showed the offline page | `navigateFallback` pointed at `offline.html` | SPA fallback now serves the app shell (`index.html`) — verified in the generated `sw.js` |
| 10 | Tokenized links were stored on disk | “Recent streams” persisted full URLs in `localStorage` | Recents are session-memory only; old persisted entries are deleted on startup |
| 11 | Forced-format TS links broke in Play Stream | The Xtream `.ts → .m3u8` rewrite also rewrote user-forced formats | Rewrite is skipped when you force a format |

**Plus:** Xtream **short EPG fallback** (per-channel Now/Next loader when XMLTV has no match), manual-quality fallback is now detected honestly (if hls.js falls back to Auto, the UI says so), and demo imports no longer duplicate.

### Earlier highlights

- **v2.1** — in-player bottom-sheet panels (never clipped), real Shaka error codes (`DASH error 1002`…) instead of “unknown”, Go Live, sleep timer, stats overlay, external `.srt`/`.vtt` subtitles, honest single-rendition quality notes.
- **v2.0** — Universal Engine (MPEG-TS/FLV, tokenized `render.mpd?auth=…` DASH), Play Any Stream page, layout-overflow overhaul, live status chips.
- **v1.1** — real Xtream Codes API (Live/VOD/Series + XMLTV EPG), brand icons, mobile glitch fixes.

---

## 🎬 Player guide — how tracks really work

| Feature | HLS (hls.js) | HLS (Safari native) | DASH (Shaka) | MPEG-TS / FLV (mpegts.js) | MP4/WebM |
|---|---|---|---|---|---|
| Quality | All renditions + Auto, bitrate labels (`720p · 2500k`), manual lock | Auto only (browser-managed) | All heights + Auto (ABR), manual variant lock | Single rendition | Single file |
| Audio | Every audio rendition, switches instantly | Every rendition via `audioTracks` | Every language/role (`en · main`) | Embedded track only | Embedded track only |
| Subtitles | Embedded tracks + your `.srt`/`.vtt` file | Embedded + file | Embedded (Shaka text tracks) + file | File only | File / embedded |

Rules the player follows: **nothing is faked.** If a source sends one rendition or one audio track, the menu says exactly that instead of pretending. If playback fails, you get the real category (network / auth / CORS / DRM / codec / manifest) **with the engine's error code** and the next step to try.

**Keyboard:** `Space` play/pause · `←/→` ∓10s · `↑/↓` volume · `M` mute · `F` fullscreen · `Esc` close panel.

---

## ⚡ Quick start

```bash
npm install        # deps
npm run dev        # http://localhost:5173
npm test           # 46 tests
npm run typecheck  # strict TypeScript
npm run build      # production build → dist/
```

- **Node.js 20+** (verified on Node 22), npm 10+. No env vars, API keys or backend required (see `.env.example`). Never prefix secrets with `VITE_`.

## 📖 Using SIRAVEX

1. **Add a source** — Playlists → **M3U file** (≤15 MB, on-device preview + warnings), **M3U URL**, or **Xtream Codes** (real `player_api.php` + `xmltv.php`; password stored only if you tick “remember”).
2. **Watch** — Live TV / Movies / Series auto-group your library. Series episodes load on demand; movies keep posters, year, rating and duration from the provider.
3. **Guide** — full XMLTV EPG auto-fetches for Xtream sources; any channel page can also load that channel's **short EPG** directly from the provider.
4. **Play Any Stream** — paste any authorized URL (HLS, DASH incl. tokenized `render.mpd?auth=…`, TS, FLV, MP4). Force a format if auto-detect guesses wrong; add provider-issued ClearKey / Widevine licence under *Advanced* if your DASH stream is encrypted.
5. **Install** — Chrome/Edge: install prompt or menu → *Install app*. iOS Safari: Share → *Add to Home Screen*.

---

## 👨‍💻 Meet the Developer

<div align="center">

<img src="https://avatars.githubusercontent.com/u/246672383?v=4" alt="Muaaz Iqbal" width="96" style="border-radius: 50%" />

### Muaaz Iqbal

**Founder & Lead Developer — SIRAVEX** · Kasur, Punjab, Pakistan 🇵🇰

[![GitHub](https://img.shields.io/badge/GitHub-muaaziqbalvip-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/muaaziqbalvip)
[![Website](https://img.shields.io/badge/Website-muaaziqbalvip.github.io-0ea5e9?style=for-the-badge&logo=googlechrome&logoColor=white)](https://muaaziqbalvip.github.io)
[![Hireable](https://img.shields.io/badge/status-open%20to%20work-22c55e?style=for-the-badge)](https://github.com/muaaziqbalvip)

</div>

Muaaz Iqbal is an independent software developer from **Kasur, Punjab, Pakistan**, building open-source media and AI products under the **Mizanora Projects** ecosystem. His public work spans Android development (Kotlin/Java), AI & trading applications, and web streaming platforms — including **MI Trade Master**, **BarakatWave TV**, **Mizanora TV** and the **Asaan Lang** programming language. SIRAVEX is his flagship web IPTV player: designed, engineered and maintained solo, with a strict rule — *real features only, nothing faked, user privacy never traded.*

> Want a feature, or found a bug? Open an issue on [GitHub](https://github.com/muaaziqbalvip/SIRAVEX/issues) — playback reports are most useful with the error code shown on the player (e.g. `DASH error 1002`) and your browser name. **Never paste private stream links or passwords into issues.**

---

## 🧱 Architecture

```
src/app/            router (HashRouter), global store, settings
src/components/     UI kit · app shell · media cards
src/features/       one folder per route (home, live-tv, movies, series, epg, player, direct, …)
src/playback/       PlaybackEngine v4 (single owner of the <video> element)
                    ├─ adapters: HLS.js · Shaka · mpegts.js · native — lazy-loaded chunks
                    ├─ capabilities/  pathname-only format detection
                    └─ errors/        Shaka/HLS/native error decoding with codes + actions
src/services/       M3U parser · XMLTV · Xtream Codes API · IndexedDB (versioned)
src/lib/            security (redaction) · display cleaning · subtitle converter · version
```

Enforced in code: one player instance with full cleanup, generation-guarded loads, bounded retries, engine-exclusive track routing, menus built only from real engine data, sanitized diagnostics (host only).

## 🌐 Deploy to Vercel

1. Import the GitHub repo in Vercel — preset **Vite**, build `npm run build`, output `dist` (pinned in `vercel.json`).
2. No environment variables needed. Hash-based routes (`/#/live`) make deep links refresh-safe anywhere.
3. After deploy, verify: home, a nested route refresh, `/manifest.webmanifest`, `/sw.js`, `/icons/icon-192.png`, playlist import, and demo playback.

## 🛠 Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| `DASH error 1001/1002` | Token expired or server refused (401/403/404) | Get a fresh link / re-import the source |
| `DASH error 6xxx` (DRM) | Stream is encrypted | Play Stream → Advanced → add the licence/ClearKey **your provider issued** |
| CORS / network error on many channels | Provider doesn't allow browser playback | Use the provider's app or ask them for web access — no legal in-browser workaround exists |
| Quality menu shows one entry | Source sends a single rendition | Normal — the panel states the real resolution/bitrate |
| Subtitles missing | Source has no text tracks | Load your own `.srt`/`.vtt` from the Subtitles panel |
| Nothing imports from a URL | Playlist CORS | Download the `.m3u` file and import it locally instead |

Full QA history, audits and honest limitations: [`docs/QA-REPORT.md`](docs/QA-REPORT.md).

## 🧪 Testing & QA

`npm test` — **46 Vitest tests** (M3U/XMLTV parsing, security helpers, format detection incl. audit regressions, Shaka error mapping + severity gate, subtitle conversion, UI primitives). `npm run typecheck` and `npm run build` are green; the generated service worker is inspected after every build.

## 📄 License

MIT © **Muaaz Iqbal** — use it, learn from it, build on it. SIRAVEX ships with **no** channels, playlists or credentials; only add sources you are authorized to use.
