import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Servi sous /support/ en production (nginx) — chemins d'assets relatifs.
  base: '/support/',
  server: {
    port: 4100,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
