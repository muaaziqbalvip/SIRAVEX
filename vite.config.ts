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
        navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{ urlPattern: ({ request }) => request.destination === 'image', handler: 'CacheFirst', options: { cacheName: 'siravex-images', expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 7 } } }],
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
        // Vendor splitting: browser in chunks ko alag cache karta hai — app
        // update par sirf chhota app chunk dobara download hota hai, speed up.
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
