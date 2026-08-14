import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        /*
          Overridable so the regression suite can point the dev server at its
          own throwaway API (test database, stubbed scraper) instead of your
          real one. Unset, this is exactly the previous behaviour, so normal
          `npm run dev` is unaffected.
        */
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
});
