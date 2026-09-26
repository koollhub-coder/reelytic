/*
  node scripts/perf/compare.js  [before-label] [after-label]

  Turns the saved benchmark files in perf-results/ into one Markdown report
  (perf-results/PERFORMANCE_REPORT.md) and prints it.
*/
const fs = require('fs');
const path = require('path');
const DIR = path.resolve(__dirname, '../../perf-results');
const beforeLabel = process.argv[2] || 'before';
const afterLabel = process.argv[3] || 'after';
const read = (label, kind) => {
  const f = path.join(DIR, `${label}-${kind}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};

const ms = (n) => (n >= 10000 ? `${(n / 1000).toFixed(1)} s` : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n} ms`);
const times = (a, b) => (b > 0 ? `${(a / b).toFixed(1)}x` : '-');
const pctDown = (a, b) => (a > 0 ? `${Math.round(((a - b) / a) * 100)}%` : '-');
const row = (...cells) => `| ${cells.join(' | ')} |`;
const head = (...cells) => `${row(...cells)}\n${row(...cells.map(() => '---'))}`;

const out = [];

// ---- API
const ba = read(beforeLabel, 'api');
const aa = read(afterLabel, 'api');
if (ba && aa) {
  out.push('## API response times (median of 15 requests, real database, realistic data)\n');
  out.push('Data: 60 reports of 200 rows, 800 creators, 3,000 ledger and login rows. Database is Atlas over the internet, so every figure includes that latency.\n');
  out.push(head('Endpoint', 'Before', 'After', 'Faster', 'Wire size before', 'Wire size after', 'On a slow phone connection before (est.)', 'after (est.)'));
  for (const name of Object.keys(ba.endpoints)) {
    const b = ba.endpoints[name];
    const a = aa.endpoints[name];
    if (!a) continue;
    const wireAfter = a.wireBytes != null ? `${(a.wireBytes / 1024).toFixed(1)} KB` : `${(a.bytes / 1024).toFixed(1)} KB`;
    // Slow 4G moves about 200 KB/s: the time to build the answer plus the time to carry it.
    const slowB = b.median + Math.round((b.bytes / 1024 / 200) * 1000);
    const slowA = a.median + Math.round(((a.wireBytes != null ? a.wireBytes : a.bytes) / 1024 / 200) * 1000);
    out.push(row(name, ms(b.median), ms(a.median), times(b.median, a.median), `${(b.bytes / 1024).toFixed(1)} KB`, wireAfter, ms(slowB), ms(slowA)));
  }
  out.push('\n### What a person waits for when opening a page (all of its calls at once)\n');
  out.push(head('Scenario', 'Before', 'After', 'Faster'));
  for (const name of Object.keys(ba.scenarios)) {
    const b = ba.scenarios[name];
    const a = aa.scenarios[name];
    if (!a) continue;
    out.push(row(name, ms(b.median), ms(a.median), times(b.median, a.median)));
  }
}

// ---- pages
const bp = read(beforeLabel, 'pages');
const ap = read(afterLabel, 'pages');
if (bp && ap) {
  out.push('\n## Page load in a real browser (production build, median of 3, phone-sized, CPU slowed 4x on the throttled networks)\n');
  out.push('"Content on screen" is the moment the page is drawn and its loading screen is gone. LCP is the largest paint. Cold = first visit, empty cache. Warm = return visit.\n');
  for (const net of Object.keys(bp.results)) {
    if (!ap.results[net]) continue;
    out.push(`\n### ${net}\n`);
    out.push(head('Page', 'Visit', 'Content on screen before', 'after', 'Faster', 'LCP before', 'after', 'Transferred before', 'after'));
    for (const page of Object.keys(bp.results[net])) {
      for (const visit of ['cold', 'warm']) {
        const b = bp.results[net][page][visit];
        const a = ap.results[net][page] && ap.results[net][page][visit];
        if (!a) continue;
        out.push(row(page, visit, ms(b.ready), ms(a.ready), times(b.ready, a.ready), ms(b.lcp), ms(a.lcp), `${b.kb} KB`, `${a.kb} KB`));
      }
    }
  }
}

// ---- landing after prerender, if measured on its own
const pr = read('prerender2', 'pages') || read('prerender', 'pages');
if (pr && bp) {
  out.push('\n## Landing page: before against the prerendered page\n');
  out.push(head('Network', 'Visit', 'First paint before', 'after', 'LCP before', 'after', 'Interactive-ready before', 'after'));
  for (const net of Object.keys(pr.results)) {
    for (const visit of ['cold', 'warm']) {
      const b = bp.results[net] && bp.results[net]['Landing (signed out)'] && bp.results[net]['Landing (signed out)'][visit];
      const a = pr.results[net]['Landing (signed out)'][visit];
      if (b && a) out.push(row(net, visit, ms(b.fcp), ms(a.fcp), ms(b.lcp), ms(a.lcp), ms(b.ready), ms(a.ready)));
    }
  }
}

// ---- Apify
const bx = read(beforeLabel, 'apify');
const bs = read(beforeLabel, 'apify-scale');
const eng = read('compare', 'apify-engine');
if (bx || eng) {
  out.push('\n## Apify (real runs, real money)\n');
  if (bx) {
    out.push('### One reel run of 10 links, the same actor, different ways of calling it\n');
    out.push(head('How it is called', 'Total time', 'Actor working', 'Waiting on cost', 'Cost'));
    for (const [name, r] of Object.entries(bx.experiments)) {
      if (!/reel actor|followers actor/.test(name)) continue;
      out.push(row(name, ms(r.totalMs), r.actorRunMs ? ms(r.actorRunMs) : '-', r.costSettledMs ? ms(r.costSettledMs - r.finishedMs) : 'none', `$${(r.usd ?? 0).toFixed(3)}`));
    }
  }
  if (bs) {
    out.push('\n### How one run scales with the number of links\n');
    out.push(head('Links in one run', 'Time to data', 'Actor working', 'Per link'));
    for (const r of bs.scale) out.push(row(r.n, ms(r.withDataMs), `${r.actorSecs} s`, ms(Math.round(r.withDataMs / r.n))));
    if (bs.settle) {
      const first = bs.settle.find((s) => s.usd > bs.settle[0].usd + 1e-9);
      out.push(`\nThe reported cost stays at the start fee for about ${first ? ms(first.ms) : 'several seconds'} after a run finishes, then jumps to the real figure. The app used to wait a fixed 6 s for it on every run; it now records an estimate at once and replaces it with the real figure when it lands.`);
    }
  }
  if (eng) {
    out.push('\n### A whole batch, the way the app runs it (reels plus follower lookup), old way against new way\n');
    out.push(head('Case', 'Time until the data is ready', 'Cost'));
    for (const [name, r] of Object.entries(eng.experiments)) out.push(row(name, ms(r.ms), `$${r.usd.toFixed(3)}`));
    const o = eng.experiments['30 links, old way (2 batches of 15, one after another)'];
    const n = eng.experiments['30 links, new way (2 batches of 15 at once, cost settled later)'];
    const n60 = eng.experiments['60 links, new way (3 batches of 20 at once, cost settled later)'];
    if (o && n) out.push(`\n30 links: ${ms(o.ms)} -> ${ms(n.ms)} (${times(o.ms, n.ms)} faster). 60 links in the new way take ${n60 ? ms(n60.ms) : '-'}; the old way needs about ${ms(Math.round((o.ms / 30) * 60))}.`);
  }
}

const md = `# Reelytic performance report\n\nGenerated ${new Date().toISOString()}\n\n${out.join('\n')}\n`;
fs.writeFileSync(path.join(DIR, 'PERFORMANCE_REPORT.md'), md);
console.log(md);
