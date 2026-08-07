import React from 'react';

function formatCompactNumber(n) {
  if (n == null) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

// Mirrors ReportEngine.jsx's computeReportInsights exactly -- these numbers
// must never disagree with what the client already saw on the live results
// screen. Duplicated rather than shared to avoid touching that file for this
// addition; keep both in sync if the ranking logic ever changes.
function computeReportInsights(rows, type) {
  const successful = rows.filter((r) => r.state === 'done' && r.result && r.result.username);
  if (successful.length < 2) return null;

  const viewsKey = type === 'reel' ? 'views' : 'avgViews';
  const erKey = type === 'reel' ? 'er' : 'avgEr';

  const pick = (row) => ({ name: row.result.username, views: Number(row.result[viewsKey]) || 0, er: Number(row.result[erKey]) || 0 });

  const viewsList = successful.map((r) => Number(r.result[viewsKey]) || 0);
  const erList = successful.map((r) => Number(r.result[erKey]) || 0);
  const avgViews = viewsList.reduce((a, b) => a + b, 0) / viewsList.length;
  const avgEr = erList.reduce((a, b) => a + b, 0) / erList.length;

  const eligible = successful.filter((r) => (Number(r.result[viewsKey]) || 0) > 0);
  let top = null, bottom = null, hasSpread = false;
  if (eligible.length >= 2) {
    const topRow = eligible.reduce((best, r) => ((Number(r.result[erKey]) || 0) > (Number(best.result[erKey]) || 0) ? r : best));
    const bottomRow = eligible.reduce((worst, r) => ((Number(r.result[erKey]) || 0) < (Number(worst.result[erKey]) || 0) ? r : worst));
    if (topRow !== bottomRow) { top = pick(topRow); bottom = pick(bottomRow); hasSpread = true; }
  }

  return { count: successful.length, avgViews, avgEr, top, bottom, hasSpread };
}

function StatTile({ label, value }) {
  return (
    <div style={{ backgroundColor: 'var(--surface)', padding: 'var(--s4)' }}>
      <div className="mono" style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

// The theme classes redeclare every color token a report uses (including
// --ok/--warn/--err, not just surface/text) so the selected report theme
// never inherits from whatever the surrounding app's own light/dark mode
// happens to be -- a client-facing report shouldn't flip based on the
// agency user's own browsing preference, and colors tuned for one theme
// often lose contrast rendered on the other.
export function ReportThemeStyles({ theme }) {
  return (
    <style>{`
      .rl-report-light {
        --bg:#F7F6F3; --surface:#FFFFFF; --surface-2:#F1EFEA;
        --border:#E4E1DA; --border-strong:#C9C5BB;
        --text:#1A1C20; --text-2:#5D6169; --text-3:#8B8F98;
        --ok:#1F9D6B; --warn:#C77E1F; --err:#D33131;
      }
      .rl-report-dark {
        --bg:#101216; --surface:#171A20; --surface-2:#1E222A;
        --border:#262B34; --border-strong:#39404C;
        --text:#ECEDEF; --text-2:#A6ABB5; --text-3:#6E747F;
        --ok:#34B981; --warn:#E0A046; --err:#EF5A5A;
      }
      .rl-highlights-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s4); margin-bottom: var(--s6); }
      @media (max-width: 560px) {
        .rl-highlights-grid { grid-template-columns: 1fr; }
        .rl-section-pad { padding: var(--s4) !important; }
      }
      @page { margin: 14mm 12mm; }
      @media print {
        .rl-print-hide { display: none !important; }
        .rl-print-sheet { border: none !important; border-radius: 0 !important; max-width: 100% !important; }
        body { background: ${theme === 'dark' ? '#101216' : '#F7F6F3'} !important; }
      }
    `}</style>
  );
}

// The document itself -- everything a "Prepared by <agency>" client actually
// sees. Shared between BrandedReport.jsx (the authenticated preview, with
// its editing toolbar) and PublicReport.jsx (the read-only view behind a
// share link) so the two can never visually drift apart.
export function ReportSheet({ job, branding, maxWidth = '1000px' }) {
  const isReel = job.type === 'reel';
  const insights = computeReportInsights(job.rows, job.type);
  const successRows = job.rows.filter((r) => r.state === 'done' && r.result && r.result.username);
  const accent = branding.accentColor || '#E23E57';
  const agencyName = branding.agencyName || 'Your agency';
  const logoPosition = branding.logoPosition || 'left';
  const showAgencyName = branding.showAgencyName !== false;
  const showHighlights = branding.showHighlights !== false;
  const dateStr = new Date(job.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const totalViews = successRows.reduce((sum, r) => sum + (Number(r.result[isReel ? 'views' : 'avgViews']) || 0), 0);
  const totalEngagement = isReel
    ? successRows.reduce((sum, r) => sum + (Number(r.result.likes) || 0) + (Number(r.result.comments) || 0), 0)
    : null;
  const totalFollowers = !isReel
    ? successRows.reduce((sum, r) => sum + (Number(r.result.followers) || 0), 0)
    : null;
  const avgEr = successRows.length > 0
    ? successRows.reduce((sum, r) => sum + (Number(r.result[isReel ? 'er' : 'avgEr']) || 0), 0) / successRows.length
    : 0;

  return (
    <div className="rl-print-sheet" style={{ maxWidth, margin: '0 auto', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
      <div className="rl-section-pad" style={{ padding: 'var(--s6)', borderBottom: `3px solid ${accent}` }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s4)',
          flexDirection: logoPosition === 'right' ? 'row-reverse' : 'row',
          justifyContent: logoPosition === 'center' ? 'center' : (logoPosition === 'right' ? 'flex-end' : 'flex-start'),
        }}>
          {branding.logoDataUri && (
            // Client-supplied logos are an unknown color (often dark, like a
            // black wordmark) -- chipping them on white regardless of report
            // theme is what keeps them legible on the dark variant instead
            // of vanishing into a dark card background.
            <div style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 'var(--r-sm)', padding: '4px 10px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <img src={branding.logoDataUri} alt="" style={{ height: '24px', maxWidth: '130px', objectFit: 'contain', display: 'block' }} />
            </div>
          )}
          {showAgencyName && <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)', color: accent }}>{agencyName}</div>}
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, margin: '0 0 4px', color: 'var(--text)' }}>
          {job.fileName || (isReel ? 'Reel Report' : 'Profile Report')}
        </h1>
        <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>
          Prepared {dateStr} &middot; {successRows.length} {isReel ? 'reels' : 'profiles'} analyzed
        </div>
      </div>

      <div className="rl-section-pad" style={{ padding: 'var(--s6)' }}>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--s3)' }}>Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1px', backgroundColor: 'var(--border)', border: '1px solid var(--border)', marginBottom: 'var(--s6)' }}>
          {isReel ? (
            <>
              <StatTile label="Total views" value={formatCompactNumber(totalViews)} />
              <StatTile label="Total engagement" value={formatCompactNumber(totalEngagement)} />
              <StatTile label="Average ER" value={`${avgEr.toFixed(1)}%`} />
              <StatTile label="Reels analyzed" value={successRows.length} />
            </>
          ) : (
            <>
              <StatTile label="Combined followers" value={formatCompactNumber(totalFollowers)} />
              <StatTile label="Avg views / reel" value={formatCompactNumber(totalViews / (successRows.length || 1))} />
              <StatTile label="Average ER" value={`${avgEr.toFixed(1)}%`} />
              <StatTile label="Profiles analyzed" value={successRows.length} />
            </>
          )}
        </div>

        {showHighlights && insights && insights.hasSpread && (
          <>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--s3)' }}>Highlights</div>
            <div className="rl-highlights-grid">
              <div style={{ border: '1px solid var(--border)', borderLeft: '3px solid var(--ok)', padding: 'var(--s3) var(--s4)' }}>
                <div style={{ fontSize: '10.5px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '4px' }}>Top performer</div>
                <div className="mono" style={{ fontWeight: 700, color: 'var(--text)' }}>@{insights.top.name}</div>
                <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--ok)' }}>{insights.top.er.toFixed(1)}% engagement rate</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderLeft: '3px solid var(--text-3)', padding: 'var(--s3) var(--s4)' }}>
                <div style={{ fontSize: '10.5px', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: '4px' }}>Lowest performer</div>
                <div className="mono" style={{ fontWeight: 700, color: 'var(--text)' }}>@{insights.bottom.name}</div>
                <div className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>{insights.bottom.er.toFixed(1)}% engagement rate</div>
              </div>
            </div>
          </>
        )}

        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--s3)' }}>Creator breakdown</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Creator</th>
                <th className="numeric">Followers</th>
                {isReel ? (
                  <>
                    <th className="numeric">Views</th>
                    <th className="numeric">Likes</th>
                    <th className="numeric">Comments</th>
                  </>
                ) : (
                  <th className="numeric">Avg views</th>
                )}
                <th className="numeric">ER</th>
              </tr>
            </thead>
            <tbody>
              {successRows.map((row, i) => {
                const res = row.result;
                const er = isReel ? res.er : res.avgEr;
                const isTop = insights && insights.hasSpread && insights.top.name === res.username;
                return (
                  <tr key={i}>
                    <td className="mono" style={{ fontWeight: 600 }}>@{res.username}</td>
                    <td className="numeric mono">{(res.followers ?? 0).toLocaleString()}</td>
                    {isReel ? (
                      <>
                        <td className="numeric mono">{(res.views ?? 0).toLocaleString()}</td>
                        <td className="numeric mono">{(res.likes ?? 0).toLocaleString()}</td>
                        <td className="numeric mono">{(res.comments ?? 0).toLocaleString()}</td>
                      </>
                    ) : (
                      <td className="numeric mono">{(res.avgViews ?? 0).toLocaleString()}</td>
                    )}
                    <td className="numeric mono" style={{ color: isTop ? 'var(--ok)' : undefined, fontWeight: isTop ? 700 : 400 }}>{(er ?? 0).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', marginTop: 'var(--s6)', paddingTop: 'var(--s3)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s2)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
          <span>{showAgencyName ? `Prepared by ${agencyName} · Confidential` : 'Confidential'}</span>
          <span>Data compiled via Reelytic</span>
        </div>
      </div>
    </div>
  );
}
