export interface BlogPost {
  slug: string; title: string; description: string; date: string; tags: string[];
  /** Simple blocks: '## ' heading, '- ' list item, warna paragraph. */
  body: string[];
}

export const POSTS: BlogPost[] = [
  {
    slug: 'how-to-add-your-iptv-playlist',
    title: 'How to Add Your IPTV Playlist to SIRAVEX (M3U & Xtream Codes)',
    description: 'Step-by-step: import an M3U file or URL, or connect an Xtream Codes account, and start watching in under a minute — no sign-up needed for local playlists.',
    date: '2026-10-29', tags: ['guide', 'iptv', 'm3u', 'xtream'],
    body: [
      'SIRAVEX plays your own authorized sources. Nothing is bundled and nothing is uploaded anywhere — your playlist is parsed on your device and stored only in your browser.',
      '## Option 1: M3U file (recommended)',
      '- Open Playlists → M3U File and choose your .m3u or .m3u8 file (up to 15 MB).',
      '- Review the preview: item counts, warnings and any broken entries are shown before anything is saved.',
      '- Confirm the import. Channels, movies and series are grouped automatically.',
      '## Option 2: M3U URL',
      '- Open Playlists → M3U URL and paste the playlist link your provider gave you.',
      '- If the fetch fails, it is almost always the provider blocking browser access (CORS). Download the file from your provider and use Option 1 instead — no web app can legally bypass that.',
      '## Option 3: Xtream Codes',
      '- Open Playlists → Xtream Codes and enter server, username and password.',
      '- SIRAVEX connects to the real provider API: live channels, movies with posters and ratings, series with episodes, and the full TV guide are fetched for you.',
      '- Your password is used only for that connection. It is stored on your device only if you explicitly tick “remember password”.',
      '## Then just press play',
      'Open Live TV, Movies or Series and pick anything. Quality, audio track and subtitles can be changed from the player — you only ever see renditions your source actually sends.',
    ],
  },
  {
    slug: 'hls-vs-dash-vs-mpegts-explained',
    title: 'HLS vs DASH vs MPEG-TS: Which Stream Format Should You Use?',
    description: 'A plain-language guide to the streaming formats SIRAVEX supports, why some links play instantly and others cannot play in any browser.',
    date: '2026-10-26', tags: ['guide', 'formats', 'hls', 'dash'],
    body: [
      'Every IPTV link ends in a format, and the format decides whether your browser can play it at all. SIRAVEX auto-detects the format from the link itself — even tokenized links like render.mpd?auth=… are recognised correctly.',
      '## HLS (.m3u8) — the browser favourite',
      'HLS works everywhere: natively on Safari and iPhone, and via HLS.js on Chrome, Edge and Firefox. If your provider offers .m3u8, choose it. It supports multiple qualities and audio tracks, which is why the Quality and Audio menus light up on HLS streams.',
      '## DASH (.mpd) — powerful, sometimes protected',
      'DASH (played here by Shaka Player) also supports adaptive quality and multiple audio languages. Some DASH streams are DRM-encrypted: those only play with the licence or ClearKey your provider issued, which you can add under Play Stream → Advanced. Encrypted streams without a licence cannot play in any honest player.',
      '## MPEG-TS (.ts) and FLV (.flv)',
      'Many IPTV servers still serve raw .ts. Browsers cannot play that natively, so SIRAVEX decodes it in-page with mpegts.js. You get one rendition and the embedded audio track — that is a property of the format, not a missing feature.',
      '## RTSP / RTMP — cannot play in a browser',
      'No browser on Earth plays RTSP or RTMP directly. If your provider gives you those, ask them for the HLS or DASH version, or use their own app. Any website claiming otherwise is hiding a server-side relay.',
      '## MP4 / WebM files',
      'Direct video files play natively. Quality and track menus stay simple because a single file has a single rendition.',
    ],
  },
  {
    slug: 'fix-playback-errors-error-codes',
    title: 'Playback Failed? Read the Error Code (DASH 1001, 6xxx, CORS…)',
    description: 'SIRAVEX shows the real engine error code instead of a vague failure. Here is what the common codes mean and exactly what to do about each one.',
    date: '2026-10-22', tags: ['help', 'troubleshooting', 'errors'],
    body: [
      'When a stream fails in SIRAVEX, the player names the category and shows the engine code, for example “DASH error 1002”. That code tells you who owns the problem — and it is rarely the player.',
      '## DASH error 1001 / 1002 — server refused or token expired',
      'Tokenized links expire, and servers answer 401/403/404 when they do. Get a fresh link from your provider, or re-import the playlist so new tokens are generated. Retrying an expired link will never revive it.',
      '## DASH error 6xxx — DRM protected',
      'The stream is encrypted. It plays only with the licence URL or ClearKey (kid:key) your provider issued: open Play Stream → Advanced and paste it there. Keys are configured into the player only — SIRAVEX never extracts or bypasses DRM.',
      '## DASH error 4xxx — manifest problem',
      'The .mpd file is invalid, empty, or uses features browsers cannot handle. Ask your provider for the HLS version of the same channel.',
      '## CORS / network errors on many channels at once',
      'Your provider does not allow browser playback. This is a server policy, not a bug: use the provider’s app or ask them to enable web access. Playing the same list in a desktop player works because desktop apps ignore CORS — browsers cannot.',
      '## “Only Auto in the Quality menu”',
      'Your source sends a single rendition. The panel tells you the real resolution and bitrate it detected. Multiple qualities only exist when the provider encodes them.',
      'Still stuck? Note the exact code and your browser name — that is everything a developer needs to help you.',
    ],
  },
  {
    slug: 'install-siravex-app-pwa-guide',
    title: 'Install SIRAVEX Like a Real App (Android, iPhone, Desktop)',
    description: 'SIRAVEX is a full PWA: install it to your home screen for a full-screen, app-like experience with your library stored on-device.',
    date: '2026-10-18', tags: ['guide', 'pwa', 'install'],
    body: [
      'SIRAVEX installs like a native app — no app store, no account needed, and your playlists stay on your device.',
      '## Android (Chrome / Edge)',
      '- Open SIRAVEX and tap “Install” when the install banner appears, or open the browser menu → Install app.',
      '- The icon lands on your home screen and opens full-screen.',
      '## iPhone / iPad (Safari)',
      '- Tap the Share button → Add to Home Screen → Add.',
      '- Apple does not allow automatic install prompts, which is why the manual step exists.',
      '## Desktop (Windows / Mac / Linux)',
      '- Use the install icon in the address bar, or the “Install SIRAVEX” banner inside the app.',
      '## Good to know',
      '- Updates arrive automatically: when a new version is ready, SIRAVEX tells you and refreshes cleanly — old caches are cleared for you.',
      '- Your library works offline to browse, but live streams always need an internet connection.',
      '- Uninstalling the app or clearing site data removes your local playlists, so keep your original M3U file safe.',
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined { return POSTS.find((p) => p.slug === slug); }
