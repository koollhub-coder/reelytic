// Everything that runs after `vite build`, in order: prerender the landing page, then write the
// Brotli and gzip copies (so the prerendered page is compressed too).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const step of ['prerender-landing.mjs', 'precompress.js']) {
  const res = spawnSync(process.execPath, [path.join(here, step)], { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status || 1);
}
