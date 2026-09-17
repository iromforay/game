import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5178,
    fs: {
      allow: ['..'],
    },
  },
  build: {
    assetsInlineLimit: 0,
  },
});
