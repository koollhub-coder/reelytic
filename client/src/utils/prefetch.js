/*
  Loads a page's code before it is asked for, so clicking it is instant.

  Two triggers: pointing at (or focusing, or touching) a navigation item, which is the earliest
  honest signal of intent, and a quiet moment shortly after a signed-in page has finished
  loading, when the browser has nothing else to do. Both use the very same dynamic imports as
  the router (App.jsx), so the browser fetches each chunk once and the router then finds it
  ready. Failures are ignored: the worst case is the ordinary lazy load on click.
*/
const loaders = {
  '/dashboard': () => import('../pages/Dashboard'),
  '/history': () => import('../pages/History'),
  '/reels': () => import('../pages/ReelReport'),
  '/profiles': () => import('../pages/ProfileReport'),
  '/creators': () => import('../pages/Creators'),
  '/settings': () => import('../pages/Settings'),
  '/how-it-works': () => import('../pages/HowItsCalculated'),
};

const started = new Set();

export function prefetchRoute(path) {
  const load = loaders[path];
  if (!load || started.has(path)) return;
  started.add(path);
  load().catch(() => started.delete(path));
}

// The four pages people move between most, fetched one at a time when the browser is idle.
export function prefetchLikelyRoutes(current) {
  const queue = ['/dashboard', '/history', '/reels', '/creators'].filter((p) => p !== current);
  const step = () => {
    const next = queue.shift();
    if (!next) return;
    prefetchRoute(next);
    schedule();
  };
  const schedule = () => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(step, { timeout: 4000 });
    else window.setTimeout(step, 1500);
  };
  // wait until the page itself is done loading
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
}
