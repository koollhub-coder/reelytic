import React from 'react';
import { Writable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { App } from './App.jsx';

// Renders the whole app at "/" (the landing page) to an HTML string. Used only by
// scripts/prerender-landing.mjs at build time, never shipped to the browser.
export function renderLandingHtml() {
  return new Promise((resolve, reject) => {
    let html = '';
    const sink = new Writable({ write(chunk, _enc, cb) { html += chunk.toString(); cb(); } });
    sink.on('finish', () => resolve(html));
    const stream = renderToPipeableStream(
      <React.StrictMode>
        <App Router={StaticRouter} routerProps={{ location: '/' }} />
      </React.StrictMode>,
      { onAllReady() { stream.pipe(sink); }, onShellError: reject, onError: reject },
    );
  });
}
