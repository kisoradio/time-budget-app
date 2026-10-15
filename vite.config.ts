/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages で /time-budget-app/ 配下に公開する前提
export default defineConfig({
  base: '/time-budget-app/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '時間予算',
        short_name: '時間予算',
        description: '1日24時間を先に配分し、起床から積み上げて管理する時間予算管理アプリ',
        lang: 'ja',
        start_url: '/time-budget-app/',
        scope: '/time-budget-app/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f7f5',
        theme_color: '#f7f7f5',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/time-budget-app/index.html',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
})
