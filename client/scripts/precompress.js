// Runs after `vite build`: writes a Brotli (.br) and gzip (.gz) copy of every text
// file in dist/, at maximum quality. The server (server/middleware/clientStatic.js)
// sends whichever the browser accepts, so nothing is compressed per request.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const COMPRESSIBLE = new Set(['.js', '.css', '.html', '.svg', '.json', '.txt', '.xml', '.map']);
const MIN_BYTES = 512;

let before = 0;
let brotli = 0;
let count = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!COMPRESSIBLE.has(path.extname(entry.name).toLowerCase())) continue;
    if (/\.(br|gz)$/.test(entry.name)) continue;
    const buf = fs.readFileSync(full);
    if (buf.length < MIN_BYTES) continue;
    const br = zlib.brotliCompressSync(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      },
    });
    const gz = zlib.gzipSync(buf, { level: 9 });
    fs.writeFileSync(full + '.br', br);
    fs.writeFileSync(full + '.gz', gz);
    before += buf.length;
    brotli += br.length;
    count += 1;
  }
}

if (fs.existsSync(dist)) {
  walk(dist);
  console.log(`[precompress] ${count} files, ${(before / 1024).toFixed(0)} KB -> ${(brotli / 1024).toFixed(0)} KB brotli`);
}
