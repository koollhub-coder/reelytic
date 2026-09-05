import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { installGlobalErrorReporting } from './utils/errorReporter';

// Installed before React mounts so a crash during the very first render is
// still reported. Anything set up inside a component would miss exactly the
// failures that stop that component from existing.
installGlobalErrorReporting();

/*
  Vite's own signal for one specific, almost-always-harmless failure: a
  lazy-loaded page's JS chunk couldn't be fetched. The two real causes are
  both transient -- a browser tab that already had the OLD index.html open
  reaching for a chunk hash a newer deploy replaced, or a request landing
  exactly while a sleeping Render dyno is still waking up from idle and
  drops it -- neither is a bug in the code, and a plain reload (which
  re-fetches the CURRENT index.html and its current chunk hashes) silently
  fixes both. Without this, that reload was the ErrorBoundary's manual
  "Reload this page" button and nothing else: a real crash screen for
  something that isn't really a crash.

  Capped at one automatic attempt per tab, not per failure -- a visitor who
  is genuinely offline must not get stuck in a reload loop. The guard is
  cleared once the app actually finishes mounting (see the splash-removal
  code below), so a later, unrelated occurrence after a future deploy still
  gets its own fresh retry.
*/
const PRELOAD_RETRY_KEY = 'reelytic-preload-retry';
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem(PRELOAD_RETRY_KEY)) return; // already tried once; let ErrorBoundary take over
  event.preventDefault();
  sessionStorage.setItem(PRELOAD_RETRY_KEY, '1');
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Hand off from the HTML boot splash (see index.html) to the app. Waits for
// the frame after React's first paint before fading, so the splash never
// disappears onto a half-drawn page -- and the app's own auth-check loader
// (FullPageLoader in App.jsx) picks up from here, so there's no bare gap
// between "splash gone" and "workspace ready".
const splash = document.getElementById('app-splash');
if (splash) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      splash.classList.add('is-hidden');
      setTimeout(() => splash.remove(), 400);
      // Reaching this point means the app mounted and painted for real --
      // clear the one-shot preload-retry guard above so a later, unrelated
      // chunk-load failure (a future deploy) still gets its own automatic
      // retry instead of silently doing nothing because this tab already
      // "used" its one reload at some point in the past.
      sessionStorage.removeItem(PRELOAD_RETRY_KEY);
    });
  });
}
