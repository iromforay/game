import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
})
