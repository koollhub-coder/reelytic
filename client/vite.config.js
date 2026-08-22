import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  /*
    index.html's %VITE_APP_URL% placeholders (canonical link, OG/Twitter
    tags, JSON-LD) need a real value at build time or the build doesn't just
    render an SEO tag wrong -- it crashes outright. Vite leaves the literal
    string "%VITE_APP_URL%" sitting in href/content attributes when the var
    is undefined, and its own asset-URL resolution then calls decodeURI() on
    that literal text, which throws "URI malformed" (a % not followed by two
    hex digits isn't valid percent-encoding) and takes the whole build down
    with it -- this is exactly what happened on Render when the Dockerfile
    hadn't been taught to forward this particular var yet (see Dockerfile's
    own ARG/ENV comment). A missing env var should degrade to "wrong
    canonical URL," never "the site doesn't build," so it gets a real
    fallback here regardless of what's set in the environment.
  */
  if (!process.env.VITE_APP_URL) {
    const env = loadEnv(mode, process.cwd(), '');
    process.env.VITE_APP_URL = env.VITE_APP_URL || 'https://reelytic.onrender.com';
  }

  return {
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
  };
});
