import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/*
  Which page's code a visitor needs is known from the address bar before any
  JavaScript has run. Without help the browser finds out only after the main bundle has
  downloaded, parsed and executed and asked for the page's chunk, and only THEN starts
  fetching it (and its stylesheet): a waterfall of three round trips.

  This writes a tiny inline script into index.html that, for the current path, starts
  those downloads immediately and in parallel with the main bundle. The map is built from
  the real build output, so the hashed file names are always right.
*/
const ROUTE_PAGES = {
  '/': 'Landing', '/login': 'Login', '/signup': 'Signup', '/pricing': 'Pricing',
  '/dashboard': 'Dashboard', '/history': 'History', '/reels': 'ReelReport', '/profiles': 'ProfileReport',
  '/creators': 'Creators', '/settings': 'Settings', '/how-it-works': 'HowItsCalculated',
};

function routePreload() {
  return {
    name: 'route-preload',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx || !ctx.bundle) return undefined;
        const chunks = Object.values(ctx.bundle).filter((c) => c.type === 'chunk');
        const byName = new Map(chunks.map((c) => [c.fileName, c]));
        const entry = chunks.find((c) => c.isEntry);
        if (!entry) return undefined;
        const walk = (chunk, seen) => {
          for (const f of chunk.imports || []) {
            if (seen.has(f)) continue;
            seen.add(f);
            const next = byName.get(f);
            if (next) walk(next, seen);
          }
        };
        const inEntry = new Set([entry.fileName]);
        walk(entry, inEntry);

        const map = {};
        for (const [route, page] of Object.entries(ROUTE_PAGES)) {
          const chunk = chunks.find((c) => c.isDynamicEntry && c.facadeModuleId && c.facadeModuleId.replace(/[\\]/g, '/').endsWith('/pages/' + page + '.jsx'));
          if (!chunk) continue;
          const js = new Set([chunk.fileName]);
          walk(chunk, js);
          for (const f of inEntry) js.delete(f);
          const css = new Set();
          for (const f of js) {
            const c = byName.get(f);
            for (const s of ((c && c.viteMetadata && c.viteMetadata.importedCss) || [])) css.add(s);
          }
          map[route] = { js: [...js], css: [...css] };
        }
        // On the landing page the script is not needed to paint (the page is prerendered), so its preloads are low priority.
        const script = '(function(){var m=' + JSON.stringify(map) + ';var r=m[location.pathname];if(!r)return;var low=location.pathname==="/";' +
          'r.js.forEach(function(f){var l=document.createElement("link");l.rel="modulepreload";l.href="/"+f;if(low)l.setAttribute("fetchpriority","low");document.head.appendChild(l);});' +
          'r.css.forEach(function(f){var l=document.createElement("link");l.rel="preload";l.as="style";l.href="/"+f;document.head.appendChild(l);});})();';
        return { html, tags: [{ tag: 'script', children: script, injectTo: 'head' }] };
      },
    },
  };
}

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
    process.env.VITE_APP_URL = env.VITE_APP_URL || 'https://getreelytic.com';
  }

  return {
    plugins: [react(), routePreload()],
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
