/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

import { themeBootScript } from './src/theme/boot.ts'

/** Inline the theme boot script so the stored theme applies before first paint. */
function themeBoot(): Plugin {
  return {
    name: 'tiller:theme-boot',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!html.includes('<!--theme-boot-->')) throw new Error('index.html is missing <!--theme-boot-->')
        return html.replace('<!--theme-boot-->', `<script>${themeBootScript}</script>`)
      },
    },
  }
}

// `npm run dev` proxies the API to the Go server (`make dev` starts both);
// point TILLER_BACKEND elsewhere to use another instance.
const backend = process.env.TILLER_BACKEND ?? 'http://127.0.0.1:8080'

export default defineConfig({
  plugins: [
    themeBoot(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Tiller',
        short_name: 'Tiller',
        description: 'Proxmox VE 移动优先管理界面',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#07080a',
        theme_color: '#07080a',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        // The API and standalone documentation must reach their own handlers.
        navigateFallbackDenylist: [/^\/api2\//, /^\/api\//, /^\/docs(?:\/|$)/],
        globIgnores: ['docs/**'],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api2': { target: backend, ws: true, changeOrigin: false },
      // Tiller endpoints and scoped PVE APIs, including console WebSockets.
      '/api/': { target: backend, ws: true, changeOrigin: false },
      '/docs': { target: backend, changeOrigin: false },
    },
  },
  preview: { host: '0.0.0.0', port: 4173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Group shared dependencies instead of preloading hundreds of tiny
            // icon, primitive and API chunks over HTTP/1.1.
            { name: 'framework', test: /node_modules\/(?:react(?:-dom|-router|-is)?|scheduler|use-sync-external-store|@tanstack\/[^/]+)\//, priority: 50 },
            { name: 'ui', test: /node_modules\/(?:@radix-ui\/[^/]+|radix-ui|@floating-ui\/[^/]+|lucide-react|vaul|cmdk|sonner)\//, priority: 40 },
            { name: 'utilities', test: /node_modules\/(?:clsx|tailwind-merge|class-variance-authority)\//, priority: 40 },
            // These large libraries must stay out of the initial app shell.
            { name: 'charts', test: /node_modules\/recharts\//, priority: 30 },
            { name: 'terminal', test: /node_modules\/@xterm\//, priority: 30 },
            { name: 'vnc', test: /node_modules\/@novnc\//, priority: 30 },
            { name: 'shared', test: /\/src\/(?:(?:api|lib|hooks|theme)\/|components\/(?!charts\/))/, minShareCount: 2, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
  },
})
