/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mounts the Edge Web-Standard `/api/relay` handler inside local Vite dev & preview servers
 * so `http://` & `https://` stream bridging behaves 100% identically to Vercel Edge production.
 */
function siravexRelayPlugin(): Plugin {
  const attach = (middlewares: { use: (route: string, fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) => {
    middlewares.use('/api/relay', async (req, res, next) => {
      if (!req.url) return next();
      const origUrl = req.url.startsWith('/api/relay') ? req.url : `/api/relay${req.url.startsWith('/') ? '' : '/'}${req.url}`;
      const abortCtrl = new AbortController();
      req.once('close', () => abortCtrl.abort());
      try {
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers.set(k, v);
          else if (Array.isArray(v)) headers.set(k, v.join(', '));
        }
        const webReq = new Request(`http://localhost${origUrl}`, {
          method: req.method || 'GET',
          headers,
          signal: abortCtrl.signal,
        });
        const mod = await import('./api/relay.js');
        const webRes: Response = await mod.default(webReq);
        res.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => res.setHeader(key, val));
        res.flushHeaders?.();
        if (!webRes.body || req.method === 'HEAD') {
          res.end();
          return;
        }
        const reader = webRes.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done || !value || res.writableEnded || res.destroyed) break;
          const ok = res.write(value);
          if (!ok) {
            await new Promise<void>((resolve) => {
              const onReady = () => {
                res.off('drain', onReady);
                res.off('close', onReady);
                resolve();
              };
              res.once('drain', onReady);
              res.once('close', onReady);
            });
          }
        }
        if (!res.writableEnded) res.end();
      } catch {
        if (!res.headersSent) { res.statusCode = 502; res.end('relay error'); }
        else if (!res.writableEnded) res.end();
      }
    });
  };
  return {
    name: 'siravex-local-relay',
    configureServer(server) { attach(server.middlewares); },
    configurePreviewServer(server) { attach(server.middlewares); },
  };
}

export default defineConfig({
  plugins: [
    siravexRelayPlugin(),
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/favicon-32.png', 'icons/favicon-64.png', 'icons/apple-touch-icon.png', 'offline.html'],
      manifest: {
        name: 'SIRAVEX', short_name: 'SIRAVEX',
        description: 'Premium IPTV & Universal Media Player — play your own authorized HTTP & HTTPS sources.',
        theme_color: '#050816', background_color: '#050816', display: 'standalone',
        scope: '/', start_url: '/', orientation: 'portrait-primary', categories: ['entertainment', 'video'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,woff2}'], maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Only cache HTTPS / same-origin non-API images so Service Worker never triggers Mixed-Content fetch errors on http:// logos!
            urlPattern: ({ request, url, sameOrigin }) =>
              request.destination === 'image' &&
              !url.pathname.startsWith('/api/') &&
              (url.protocol === 'https:' || sameOrigin),
            handler: 'CacheFirst',
            options: { cacheName: 'siravex-images', expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: {
    sourcemap: false, chunkSizeWarningLimit: 1200, reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/hls.js')) return 'vendor-hls';
          if (id.includes('node_modules/shaka-player')) return 'vendor-shaka';
          if (id.includes('node_modules/mpegts.js')) return 'vendor-mpegts';
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) return 'vendor-firebase';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
});
