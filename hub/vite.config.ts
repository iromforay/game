import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // 브라우저에서는 CommonJS dist가 아닌 ESM TypeScript 원본을 변환한다.
    // NestJS BE는 기존 CommonJS dist를 계속 사용한다.
    alias: {
      'sweet-shop-contracts': fileURLToPath(new URL('../shared/sweet-shop-contracts/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    fs: {
      allow: ['..'],
    },
  },
  build: {
    // Phaser's SVG loader assumes data: URIs are base64-encoded and calls atob() on
    // them. Vite's default asset inlining produces URL-encoded (non-base64) data URIs
    // for small SVGs, which breaks that assumption. Disable inlining so assets always
    // resolve to a real file URL (relevant for embedded packages like tower-defense).
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    // tower-defense and offense-tower are workspace-linked source, not real
    // dependencies. Without this, Vite pre-bundles and caches them like any
    // other node_modules package, so editing their source doesn't invalidate
    // the cache and changes silently don't show up until node_modules/.vite
    // is deleted by hand. Excluding them keeps them live-transformed and
    // watched, so edits actually hot-reload.
    exclude: ['tower-defense', 'offense-tower', 'strategy-marbles', 'my-room-dungeon', 'spin-gather-king', 'save-a-turby', 'steal_a_kirby'],
  },
})
