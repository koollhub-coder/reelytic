import { useEffect } from 'react';

const SITE_URL = (import.meta.env.VITE_APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
const SITE_NAME = 'Reelytic';

function setMeta(selector, attr, value) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    // selector is always of the form `meta[name="x"]` or `meta[property="x"]`
    // -- pull the attribute name/value back out to create it correctly.
    const match = selector.match(/meta\[(\w+)="([^"]+)"\]/);
    if (match) el.setAttribute(match[1], match[2]);
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

function setCanonical(url) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', url);
}

function setStructuredData(json) {
  const id = 'rl-page-structured-data';
  let el = document.getElementById(id);
  if (!json) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('script');
    el.id = id;
    el.type = 'application/ld+json';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(json);
}

/*
  Sets per-page title/description/canonical/Open Graph for the public,
  crawlable pages (Landing, Pricing, Terms, Privacy, Login, Signup, Forgot
  Password) -- everything behind login has no reason to be indexed and is
  left on index.html's defaults. This is a plain DOM-mutation hook rather
  than a react-helmet dependency because that's the entire surface area this
  app needs; a client-rendered SPA's title tag is what search snippets and
  browser tabs read regardless of how it's set, there's no SSR here for a
  library like that to coordinate with.

  `path` should be the route's own path (e.g. '/pricing') so the canonical
  and og:url always point at the real page, not always at '/'.
*/
export function useDocumentMeta({ title, description, path = '/', noindex = false, structuredData = null }) {
  useEffect(() => {
    const fullTitle = title ? `${title} · ${SITE_NAME}` : `${SITE_NAME} — Instagram Reel & Profile Analytics for Agencies`;
    const url = `${SITE_URL}${path}`;

    document.title = fullTitle;
    if (description) {
      setMeta('meta[name="description"]', 'content', description);
      setMeta('meta[property="og:description"]', 'content', description);
      setMeta('meta[name="twitter:description"]', 'content', description);
    }
    setMeta('meta[property="og:title"]', 'content', fullTitle);
    setMeta('meta[name="twitter:title"]', 'content', fullTitle);
    setMeta('meta[property="og:url"]', 'content', url);
    setMeta('meta[name="robots"]', 'content', noindex ? 'noindex, nofollow' : 'index, follow');
    setCanonical(url);
    setStructuredData(structuredData);

    // Deliberately no cleanup/reset on unmount: the next page's own
    // useDocumentMeta call overwrites these same tags on mount, and a
    // reset-to-default in between would just be a flash of the wrong title.
  }, [title, description, path, noindex, structuredData]);
}

export { SITE_URL };
