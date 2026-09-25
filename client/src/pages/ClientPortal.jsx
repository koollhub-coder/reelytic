import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { BrandLoader } from '../components/BrandLoader';
import { ReportThemeStyles, ThemeToggle } from '../components/ReportSheet';
import { Tooltip } from '../components/Tooltip';

function formatViews(n) {
  if (n == null) return '-';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function StatTile({ value, label, accent }) {
  return (
    <div style={{
      flex: '1 1 140px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
      padding: 'var(--s4)', backgroundColor: 'var(--surface)',
    }}>
      <div style={{ fontFamily: 'var(--font-data)', fontWeight: 700, fontSize: 'var(--fs-xl)', color: accent ? 'var(--accent)' : 'var(--text)' }}>
        {value}
      </div>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '2px' }}>
        {label}
      </div>
    </div>
  );
}

/*
  The read-only view behind a persistent "Client portal" link (see
  campaigns.routes.js POST /:id/portal and PortalDialog.jsx). No login, no
  session, and unlike PublicReport.jsx this is not tied to one report --
  it's every report ever tagged to the campaign, rolled up into one view
  that keeps updating as more reports get added. Hits
  /api/public/campaigns/:token, a dedicated unauthenticated endpoint that
  only ever returns the slim, display-only fields this page needs.
*/
export function ClientPortal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    apiFetch(`/public/campaigns/${token}`)
      .then((res) => setData(res))
      .catch((err) => setError(err.message || 'This link is invalid or has been turned off.'));
  }, [token]);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--s4)', padding: 'var(--s6)', backgroundColor: 'var(--bg)' }}>
        <p style={{ color: 'var(--err)' }}>{error}</p>
        <Link to="/" className="btn btn-secondary">Go to Reelytic</Link>
      </div>
    );
  }
  if (!data) {
    return <BrandLoader variant="full" message="Loading campaign..." />;
  }

  const { campaign, rows, branding } = data;
  const accentColor = branding.accentColor || '#E23E57';

  return (
    <div className={theme === 'dark' ? 'rl-report-dark' : 'rl-report-light'} style={{ minHeight: '100vh', backgroundColor: 'var(--surface-2)', padding: 'var(--s6) var(--s4)' }}>
      <ReportThemeStyles theme={theme} />

      <div className="rl-print-hide rl-report-topbar">
        <Tooltip content="Reelytic: Instagram campaign reporting for agencies">
          <a
            className="rl-report-brand"
            href="/?from=client-portal"
            target="_blank"
            rel="noopener"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <img src="/logo-mark-128.png" alt="" width="30" height="30" style={{ display: 'block', objectFit: 'contain', flexShrink: 0 }} />
            <span className="rl-report-brand-name">
              R<span style={{ fontFamily: 'var(--font-data)', color: 'var(--accent)' }}>e</span>elytic
            </span>
          </a>
        </Tooltip>
        <div className="rl-report-topbar-actions">
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        {/* Campaign header: agency branding first, then the name of what
            they're actually looking at -- same "your branding leads" rule
            as the branded single-report view. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s3)', paddingBottom: 'var(--s4)',
          marginBottom: 'var(--s5)', borderBottom: `3px solid ${accentColor}`,
        }}>
          {branding.logoDataUri ? (
            <div style={{ backgroundColor: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '4px 10px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <img src={branding.logoDataUri} alt="" style={{ height: '28px', maxWidth: '120px', objectFit: 'contain', display: 'block' }} />
            </div>
          ) : (
            <div style={{ width: '34px', height: '34px', borderRadius: '8px', backgroundColor: accentColor, flexShrink: 0 }} />
          )}
          {branding.showAgencyName !== false && branding.agencyName && (
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)', color: accentColor }}>{branding.agencyName}</div>
          )}
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)', color: 'var(--text)' }}>{campaign.name}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
              {campaign.reportCount} {campaign.reportCount === 1 ? 'report' : 'reports'} · updated automatically
            </div>
          </div>
        </div>

        {/* Rollup, readable in a glance -- the whole point of this being a
            portal instead of a pile of separate files. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
          <StatTile value={campaign.reportCount} label="Reports in this campaign" />
          <StatTile value={formatViews(campaign.totalViews)} label="Total views" accent />
          <StatTile value={campaign.avgEr != null ? `${campaign.avgEr}%` : '-'} label="Average engagement rate" accent />
        </div>

        {rows.length === 0 ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', backgroundColor: 'var(--surface)', padding: 'var(--s6)', textAlign: 'center', color: 'var(--text-3)' }}>
            Nothing measured here yet. Check back once the first report is added.
          </div>
        ) : (
          <>
            <div className="rl-table-scroll rl-hide-mobile" style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', backgroundColor: 'var(--surface)', overflow: 'hidden' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Creator</th>
                    <th className="numeric">Followers</th>
                    <th className="numeric">Views</th>
                    <th className="numeric">Likes</th>
                    <th className="numeric">ER %</th>
                    <th>Report</th>
                    <th>Added</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{r.result.username ? `@${r.result.username}` : 'Unresolved creator'}</td>
                      <td className="numeric mono">{formatViews(r.result.followers)}</td>
                      <td className="numeric mono">{formatViews(r.result.views)}</td>
                      <td className="numeric mono">{formatViews(r.result.likes)}</td>
                      <td className="numeric mono" style={{ color: 'var(--ok)', fontWeight: 600 }}>{(r.result.er ?? r.result.avgEr ?? 0).toFixed ? (r.result.er ?? r.result.avgEr ?? 0).toFixed(2) : (r.result.er ?? r.result.avgEr ?? 0)}%</td>
                      <td style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>{r.reportName || '-'}</td>
                      <td className="mono" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>{formatDate(r.addedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked cards, same fields, same order of priority
                (creator name leads, ER is the number that matters most). */}
            <div className="rl-mobile-only" style={{ flexDirection: 'column', gap: 'var(--s3)' }}>
              {rows.map((r, i) => (
                <div key={i} className="card" style={{ padding: 'var(--s3) var(--s4)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s2)' }}>
                    <span style={{ fontWeight: 700, fontSize: 'var(--fs-sm)' }}>{r.result.username ? `@${r.result.username}` : 'Unresolved creator'}</span>
                    <span className="mono" style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', color: 'var(--ok)' }}>{(r.result.er ?? r.result.avgEr ?? 0)}%</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s2)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
                    <div><div className="mono" style={{ fontWeight: 600 }}>{formatViews(r.result.followers)}</div>Followers</div>
                    <div><div className="mono" style={{ fontWeight: 600 }}>{formatViews(r.result.views)}</div>Views</div>
                    <div><div className="mono" style={{ fontWeight: 600 }}>{formatViews(r.result.likes)}</div>Likes</div>
                  </div>
                  <div style={{ marginTop: 'var(--s2)', fontSize: '10px', color: 'var(--text-3)' }}>{r.reportName || '-'} · {formatDate(r.addedAt)}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <div
          className="rl-print-hide"
          style={{
            marginTop: 'var(--s5)',
            border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
            backgroundColor: 'var(--surface)', padding: 'var(--s5)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 'var(--s4)', flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: '2px' }}>
              This portal was built with Reelytic
            </div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
              Turn a sheet of Instagram links into a client-ready report in minutes.
            </div>
          </div>
          <a
            className="btn btn-primary"
            href="/?from=client-portal-footer"
            target="_blank"
            rel="noopener"
            style={{ textDecoration: 'none', flexShrink: 0 }}
          >
            See how it works
          </a>
        </div>
      </div>
    </div>
  );
}
