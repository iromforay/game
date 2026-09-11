import { defineConfig } from 'vite';

// Phaser's SVG loader assumes data: URIs are base64-encoded and calls atob() on them.
// Vite's default asset inlining produces URL-encoded (non-base64) data URIs for small
// SVGs, which breaks that assumption. Disable inlining so assets always resolve to a
// real file URL.
export default defineConfig({
  server: {
    port: 5175,
    fs: {
      allow: ['..'],
    },
  },
  build: {
    assetsInlineLimit: 0,
  },
  optimizeDeps: {
    // tower-defense is workspace-linked source, not a real dependency - see
    // hub/vite.config.ts for why this must stay excluded from pre-bundling.
    exclude: ['tower-defense'],
  },
});
