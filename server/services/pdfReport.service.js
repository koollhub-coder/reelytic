/*
  Real PDF generation for the branded report -- a genuine downloadable file,
  not the browser's own "print to PDF" dialog.

  GATED OFF BY DEFAULT, DELIBERATELY, AT TWO LEVELS:
    1. The route calling this (jobs.routes.js) requires hasFeature(user,
       'pdfExport'), which no plan grants yet -- see features.service.js.
       An admin turns it on per-client via featureOverrides, same as every
       other paid-feature gate in this app.
    2. `playwright` stays a devDependency, not a real one, and is required
       IN HERE, lazily, at call time -- never at module load. This means:
         - The server can boot and run its whole life without ever touching
           this file, with zero added weight (no Chromium binary, nothing
           extra in `npm install --production`).
         - The day this feature actually gets enabled for a real client,
           whoever deploys that needs to: move `@playwright/test` (or
           `playwright`) into real `dependencies`, and add a browser-install
           step to the build (`npx playwright install chromium`). Neither
           has been done as part of building this -- doing so now would
           silently change the production footprint of a feature that is
           supposed to stay off.

  WHY A SEPARATE HTML TEMPLATE, NOT A SCREENSHOT OF THE LIVE REACT PAGE.
  The obvious-looking alternative -- point a headless browser at the real
  /reports/:jobId/branded route and print that -- means forwarding the
  caller's session cookie into the headless context, waiting on React
  hydration and its own data fetch to finish before printing (a real race),
  and needing to know this server's own reachable base URL in every
  environment it runs in. Building the HTML directly and handing it to
  Playwright via page.setContent() sidesteps all three: no auth forwarding,
  no network hop, no waiting on anything -- the content is complete the
  moment it's handed over.
*/

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(value) {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

function num(n) {
  return (n ?? 0).toLocaleString('en-US');
}

function buildRowsHtml(job) {
  const rows = (job.rows || []).filter((r) => r.state === 'done' && r.result);
  if (job.type === 'reel') {
    return {
      headers: ['Username', 'Followers', 'Views', 'Likes', 'Comments', 'ER %'],
      body: rows.map((r) => {
        const res = r.result;
        return `<tr>
          <td>@${esc(res.username || '-')}</td>
          <td class="num">${num(res.followers)}</td>
          <td class="num">${num(res.views)}</td>
          <td class="num">${num(res.likes)}</td>
          <td class="num">${num(res.comments)}</td>
          <td class="num accent">${res.er ?? 0}%</td>
        </tr>`;
      }).join(''),
    };
  }
  return {
    headers: ['Username', 'Followers', 'Avg Views', 'Avg ER %'],
    body: rows.map((r) => {
      const res = r.result;
      const low = res.lowSample ? ' <span class="tag">low sample</span>' : '';
      return `<tr>
        <td>@${esc(res.username || '-')}</td>
        <td class="num">${num(res.followers)}</td>
        <td class="num">${num(res.avgViews)}</td>
        <td class="num accent">${res.avgEr ?? 0}%${low}</td>
      </tr>`;
    }).join(''),
  };
}

/*
  Headline aggregates -- the same numbers the live branded-report preview
  leads with. Computed here directly from job.rows rather than imported from
  the client's own summary logic, since that logic lives in a React
  component this server code has no reason to depend on; the arithmetic
  itself (averages of avgViews/avgEr) is simple enough not to be worth
  sharing across a server/client boundary for.
*/
function buildHeadline(job) {
  const rows = (job.rows || []).filter((r) => r.state === 'done' && r.result);
  if (rows.length === 0) return { count: 0, avgViews: 0, avgEr: 0 };
  const isReel = job.type === 'reel';
  const viewsKey = isReel ? 'views' : 'avgViews';
  const erKey = isReel ? 'er' : 'avgEr';
  const totalViews = rows.reduce((sum, r) => sum + (r.result[viewsKey] || 0), 0);
  const totalEr = rows.reduce((sum, r) => sum + (r.result[erKey] || 0), 0);
  return {
    count: rows.length,
    avgViews: Math.round(totalViews / rows.length),
    avgEr: Math.round((totalEr / rows.length) * 100) / 100,
  };
}

/*
  No Reelytic mark anywhere in this template, deliberately -- same reasoning
  as BrandedReport.jsx's own header comment: this PDF is downloaded under
  the agency's own logo and colors and handed to their client as the
  agency's own deliverable, not a page living on Reelytic's domain (that
  distinction is why PublicReport.jsx, the shareable LINK, is allowed to
  carry a mark and this is not). "Your branding, on every report" would be
  a false promise on the one artifact that actually leaves the building if
  a footnote here undercut it.
*/
function buildHtml({ job, branding }) {
  const accent = (branding && branding.accentColor) || '#E23E57';
  const agencyName = branding && branding.showAgencyName !== false ? (branding.agencyName || '') : '';
  const logo = branding && branding.logoDataUri;
  const logoPos = (branding && branding.logoPosition) || 'left';
  const { headers, body } = buildRowsHtml(job);
  const headline = buildHeadline(job);
  const reportLabel = job.type === 'reel' ? 'Reel Report' : 'Profile Report';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(agencyName || 'Reelytic')} report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 40px 48px; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid ${esc(accent)}; }
  .header.pos-center { flex-direction: column; text-align: center; gap: 8px; }
  .header.pos-right { flex-direction: row-reverse; }
  .logo { max-height: 48px; max-width: 220px; object-fit: contain; }
  .agency-name { font-size: 15px; font-weight: 700; color: #444; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
  .stats { display: flex; gap: 16px; margin-bottom: 28px; }
  .stat { flex: 1; padding: 14px 16px; background: #f7f7f8; border-radius: 8px; }
  .stat .label { font-size: 11px; color: #777; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 4px; }
  .stat .value { font-size: 20px; font-weight: 700; color: ${esc(accent)}; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 8px 10px; background: #f0f0f2; font-weight: 600; border-bottom: 2px solid #ddd; }
  td { padding: 7px 10px; border-bottom: 1px solid #eee; }
  td.num, th.num { text-align: right; }
  .accent { color: ${esc(accent)}; font-weight: 600; }
  .tag { font-size: 9px; color: #a06a00; background: #fff3d6; padding: 1px 5px; border-radius: 8px; margin-left: 4px; }
  .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #eee; font-size: 10px; color: #999; }
</style></head>
<body>
  <div class="header pos-${esc(logoPos)}">
    ${logo ? `<img class="logo" src="${esc(logo)}" />` : ''}
    ${agencyName ? `<span class="agency-name">${esc(agencyName)}</span>` : ''}
  </div>
  <h1>${esc(reportLabel)}</h1>
  <div class="meta">Generated ${esc(formatDate(new Date()))} &middot; Source data from ${esc(formatDate(job.createdAt))}</div>
  <div class="stats">
    <div class="stat"><div class="label">Creators covered</div><div class="value">${num(headline.count)}</div></div>
    <div class="stat"><div class="label">Avg views</div><div class="value">${num(headline.avgViews)}</div></div>
    <div class="stat"><div class="label">Avg engagement rate</div><div class="value">${headline.avgEr}%</div></div>
  </div>
  <table>
    <thead><tr>${headers.map((h, i) => `<th class="${i > 0 ? 'num' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="footer">Engagement rate = (Likes + Comments) / Views &times; 100.</div>
</body></html>`;
}

/*
  Returns a PDF Buffer, or throws with a message safe to show the caller
  (never a raw Playwright/Chromium stack trace) if the browser dependency
  isn't installed on this machine -- expected on any server this hasn't been
  deliberately enabled on yet.
*/
async function generateBrandedReportPdf({ job, branding }) {
  let chromium;
  try {
    /*
      Requires the ACTUAL listed devDependency (@playwright/test), not the
      plain `playwright` package -- that resolves too, today, but only
      because it's an unlisted transitive dependency npm happened to hoist
      to the top level. Relying on that would work on this machine and
      silently fail on a fresh install elsewhere. When this feature is
      really enabled in production, moving to the smaller `playwright`
      package (not the whole test runner) as a real dependency is the
      better long-term choice -- noted here, not done, since this stays off.
    */
    // eslint-disable-next-line global-require
    ({ chromium } = require('@playwright/test'));
  } catch (e) {
    throw new Error('PDF generation isn\'t set up on this server yet. This feature needs an admin to install its browser dependency before it can be used.');
  }

  const html = buildHtml({ job, branding });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { generateBrandedReportPdf };
