import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'sweet-shop-contracts': fileURLToPath(new URL('../shared/sweet-shop-contracts/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5186, fs: { allow: ['..'] } },
});
