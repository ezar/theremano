/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * `BASE_PATH` permite el mismo build en Vercel (raiz) y en GitHub Pages
 * (subcarpeta `/theremano/`). Todo el codigo referencia los activos con
 * `import.meta.env.BASE_URL`, nunca con rutas absolutas escritas a mano.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
  build: {
    target: 'es2022',
    // El modelo y el WASM ya viven en public/: no queremos que rollup los toque.
    assetsInlineLimit: 4096,
  },
  server: {
    host: true,
    // getUserMedia exige contexto seguro; en localhost basta con http.
    port: 5173,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'theremano',
        short_name: 'theremano',
        description: 'Instrumento musical controlado con las manos a traves de la camara.',
        lang: 'es',
        start_url: base,
        scope: base,
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#05070c',
        theme_color: '#05070c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // El shell precachea; los 20 MB de modelo + WASM se cachean en runtime,
        // exactamente cuando la aplicacion los pide por primera vez. Precachearlos
        // convertiria la primera visita en una descarga en frio de 20 MB.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        globIgnores: ['**/models/**', '**/wasm/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/\/(models|wasm)\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/models\/[^/]+\.task$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'theremano-model',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
          {
            urlPattern: ({ url }) => /\/wasm\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'theremano-wasm',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
