/*
  Sends browser-side failures to the server so they show up on the admin
  Health page.

  The guiding rule is that this must never make a bad situation worse. It is
  only ever running when something has already gone wrong, so every path here
  swallows its own failures, and none of it is allowed to throw, block
  rendering, or retry into a loop.

  Three sources feed it:
    - ErrorBoundary, for component crashes (the white screen)
    - window 'error' and 'unhandledrejection', for everything uncaught
    - apiFetch, for API calls that come back non-2xx or fail outright
*/

const ENDPOINT = '/api/errors';

/*
  Client-side dedup.

  A render loop or a polling call against a downed endpoint can fire hundreds
  of identical errors a second. The server groups them, but there is no point
  sending the same thing over and over from here: it wastes the user's
  bandwidth on a page that is already struggling. Same signature within the
  window is dropped.
*/
const SEEN_WINDOW_MS = 30 * 1000;
const MAX_REPORTS_PER_SESSION = 25;
const seen = new Map();
let sentThisSession = 0;

function shouldSend(signature) {
  if (sentThisSession >= MAX_REPORTS_PER_SESSION) return false;
  const now = Date.now();
  const last = seen.get(signature);
  if (last && now - last < SEEN_WINDOW_MS) return false;
  seen.set(signature, now);
  if (seen.size > 100) {
    for (const [k, t] of seen) if (now - t > SEEN_WINDOW_MS) seen.delete(k);
  }
  return true;
}

/*
  Console noise that is never actionable, so it never becomes an "issue".

  Two categories. Browser extensions inject scripts into every page and their
  failures are reported as if they were ours (the couponCollection.js errors
  in a typical console are a coupon extension, not this app). And libraries
  print upgrade advisories on boot which are notes to the developer, not
  faults a client is experiencing. Both would arrive constantly and train us
  to ignore the Health page, which is the only way this system truly fails.
*/
const CONSOLE_IGNORE = [
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /Download the React DevTools/i,
  /React Router Future Flag Warning/i,
  /Support for defaultProps will be removed/i,
  /\[BHK\]/i,
];

function isIgnorableConsoleError(text) {
  return CONSOLE_IGNORE.some((re) => re.test(text));
}

// Pulls "BrandLoader" out of a React component stack's first frame, so the
// Health page can name the component instead of only showing a file hash.
function componentFromStack(componentStack) {
  if (!componentStack) return null;
  const line = String(componentStack).split('\n').map((l) => l.trim()).filter(Boolean)[0];
  if (!line) return null;
  const match = line.match(/^(?:at\s+)?([A-Za-z0-9_$.]+)/);
  return match ? match[1] : null;
}

export function reportError({ kind = 'client-error', message, stack, source, route, status, extra } = {}) {
  try {
    const signature = [kind, message, source, route, status].join('|');
    if (!shouldSend(signature)) return;
    sentThisSession += 1;

    const payload = JSON.stringify({
      kind,
      message: String(message || 'Unknown error').slice(0, 500),
      stack: stack ? String(stack).slice(0, 4000) : undefined,
      source: source ? String(source).slice(0, 300) : undefined,
      // The page the user was on matters as much as the error itself, and it
      // is the first thing you want when reproducing.
      route: route || (typeof window !== 'undefined' ? window.location.pathname : undefined),
      status,
      extra: {
        ...(extra || {}),
        /*
          Always recorded, even when `route` describes something else (an API
          path, say). Without it a failed call to /api/jobs tells you nothing
          about WHERE in the app the user was when it broke, which is the
          first thing you need to reproduce it.
        */
        pagePath: typeof window !== 'undefined' ? window.location.pathname + window.location.search : null,
        component: componentFromStack(extra && extra.componentStack),
        viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : null,
      },
    });

    /*
      sendBeacon where available: it survives the page being torn down, which
      is exactly the case for a crash the user reacts to by navigating away or
      closing the tab. A normal fetch is cancelled at that moment and the
      report is lost.
    */
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      if (ok) return;
    }
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: payload,
      keepalive: true,
    }).catch(() => { /* reporting must never surface its own failure */ });
  } catch (e) {
    /* never throw from the error reporter */
  }
}

// Called once at boot from main.jsx.
export function installGlobalErrorReporting() {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    // Resource load failures (a broken <img>) also fire this event but carry
    // no Error object. They are noise here, so only real exceptions pass.
    if (!event || !event.error) return;
    reportError({
      kind: 'client-error',
      message: event.message || event.error.message,
      stack: event.error.stack,
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event && event.reason;
    reportError({
      kind: 'client-rejection',
      message: (reason && reason.message) || String(reason || 'Unhandled promise rejection'),
      stack: reason && reason.stack,
    });
  });

  /*
    console.error is captured too.

    The window 'error' event only fires for UNCAUGHT exceptions, so anything
    the app catches and logs, and everything React reports (invalid props,
    key warnings, failed prop types), never reached the Health page at all.
    Those are real defects that simply happen not to throw, and a React
    warning printed on every page load is exactly the sort of thing that sits
    in a console for months because nobody scrolls.

    The original console.error always runs first and unchanged, so local
    debugging is completely unaffected.
  */
  const originalConsoleError = window.console && window.console.error;
  if (typeof originalConsoleError === 'function') {
    let reentrant = false;
    window.console.error = function patchedConsoleError(...args) {
      originalConsoleError.apply(window.console, args);
      // A failure inside reporting must not re-enter through its own logging.
      if (reentrant) return;
      try {
        reentrant = true;
        const text = args
          .map((a) => (a instanceof Error ? `${a.message}` : typeof a === 'string' ? a : ''))
          .filter(Boolean)
          .join(' ')
          .slice(0, 500);
        if (!text || isIgnorableConsoleError(text)) return;
        const errArg = args.find((a) => a instanceof Error);
        reportError({
          kind: 'console-error',
          message: text,
          stack: errArg ? errArg.stack : undefined,
        });
      } catch (e) {
        /* never let reporting break logging */
      } finally {
        reentrant = false;
      }
    };
  }
}

/*
  Reports an API call that failed.

  Called from apiFetch. 401 and 403 are excluded by the caller: an expired
  session or a correctly-refused paid feature is the app behaving properly,
  and recording those would flood the Health page with non-problems.
*/
export function reportApiFailure({ path, status, message }) {
  reportError({
    kind: 'api-failure',
    message: message || `API ${status} on ${path}`,
    route: path,
    status,
  });
}
