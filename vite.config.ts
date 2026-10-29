/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/favicon-32.png', 'icons/favicon-64.png', 'icons/apple-touch-icon.png', 'offline.html'],
      manifest: {
        name: 'SIRAVEX', short_name: 'SIRAVEX',
        description: 'Premium IPTV & Universal Media Player — play your own authorized sources.',
        theme_color: '#050816', background_color: '#050816', display: 'standalone',
        scope: '/', start_url: '/', orientation: 'portrait-primary', categories: ['entertainment','video'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,woff2}'], maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: '/offline.html', navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{ urlPattern: ({ request }) => request.destination === 'image', handler: 'CacheFirst', options: { cacheName: 'siravex-images', expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 } } }],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: { sourcemap: false, chunkSizeWarningLimit: 1200 },
});
