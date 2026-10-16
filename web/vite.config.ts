import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Locally the browser calls /api/* on the Vite server, the same single site CloudFront gives on AWS (D-G5).
// The proxy strips /api and sends each path to the service that owns it (G21).
const strip = (path: string): string => path.replace(/^\/api/, '');
const service = (target: string) => ({ target, changeOrigin: true, rewrite: strip });

export default defineConfig({
  plugins: [react()],
  resolve: {
    // The shared limits and batch rules, straight from source, so the page needs no build of the package.
    alias: { '@docbeam/shared/browser': fileURLToPath(new URL('../packages/shared/src/browser.ts', import.meta.url)) },
  },
  // exceljs is about 900 kB, but it is loaded only when an XLSX is previewed (D-M2-10), so the warning does not apply.
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api/auth': service('http://localhost:3001'),
      '/api/.well-known': service('http://localhost:3001'),
      '/api/teams': service('http://localhost:3002'),
      '/api/binders': service('http://localhost:3002'),
      '/api/folders': service('http://localhost:3002'),
      '/api': service('http://localhost:3003'),
    },
  },
});
