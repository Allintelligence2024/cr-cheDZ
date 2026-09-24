import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Servi sous /support/ en production (nginx) — chemins d'assets relatifs.
  base: '/support/',
  server: {
    port: 4100,
    host: true,
    // Prévisualisation derrière un proxy (sandbox e2b) — même réglage que l'admin-web.
    allowedHosts: ['.e2b.app'],
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
