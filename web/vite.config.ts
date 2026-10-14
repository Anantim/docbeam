import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Locally the browser calls /api/* on the Vite server, the same single site CloudFront gives on AWS (D-G5).
// The proxy strips /api and sends each path to the service that owns it (G21).
const strip = (path: string): string => path.replace(/^\/api/, '');
const service = (target: string) => ({ target, changeOrigin: true, rewrite: strip });

export default defineConfig({
  plugins: [react()],
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
