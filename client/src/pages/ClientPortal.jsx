import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { BrandLoader } from '../components/BrandLoader';
import { ReportThemeStyles, ThemeToggle } from '../components/ReportSheet';
import { Tooltip } from '../components/Tooltip';
import { DataTable } from '../components/DataTable';
import { Collapsible } from '../components/Collapsible';
import { DownloadIcon } from '../components/Icon';
import { useDocumentMeta } from '../hooks/useDocumentMeta';

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


function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Everything under the campaign header: the rollup, a per-report breakdown so a
// client can tell which report had which numbers, and the creator table with
// the same sort, filter and pagination as the rest of the product.
function PortalBody({ campaign, rows, reports, accentColor }) {
  const [active, setActive] = useState('all');
  const [search, setSearch] = useState('');

  // Two reports can share a file name, so the date is added only when it is needed to tell them apart.
  const labels = useMemo(() => {
    const seen = {};
    for (const r of reports) seen[r.name || ''] = (seen[r.name || ''] || 0) + 1;
    const out = {};
    for (const r of reports) {
      const base = r.name || (r.type === 'profile' ? 'Profile report' : 'Reel report');
      out[r.key] = seen[r.name || ''] > 1 ? base + ' · ' + formatDate(r.addedAt) : base;
    }
    return out;
  }, [reports]);

  const all = useMemo(() => rows.map((r, i) => ({
    id: i,
    username: r.result.username || '',
    label: labels[r.reportKey] || r.reportName || 'Report',
    reportKey: r.reportKey,
    followers: Number(r.result.followers || 0),
    views: Number(r.result.views ?? r.result.avgViews ?? 0),
    likes: Number(r.result.likes || 0),
    comments: Number(r.result.comments || 0),
    er: Number(r.result.er ?? r.result.avgEr ?? 0),
    addedAt: r.addedAt,
  })), [rows, labels]);

  const visible = useMemo(() => (active === 'all' ? all : all.filter((r) => r.reportKey === active)), [all, active]);
  const top = useMemo(() => visible.filter((r) => r.username && r.er > 0).sort((a, b) => b.er - a.er)[0], [visible]);
  const most = useMemo(() => visible.filter((r) => r.username && r.views > 0).sort((a, b) => b.views - a.views)[0], [visible]);
  const scoped = active === 'all' ? null : reports.find((r) => r.key === active);

  const download = () => {
    const head = ['Creator', 'Report', 'Followers', 'Views', 'Likes', 'Comments', 'ER %', 'Added'];
    const lines = [head.join(',')].concat(visible.map((r) => [r.username ? '@' + r.username : '', r.label, r.followers, r.views, r.likes, r.comments, r.er, formatDate(r.addedAt)].map(csvCell).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (campaign.name || 'campaign').replace(/[^\w.-]+/g, '-') + (scoped ? '-' + (scoped.name || 'report').replace(/[^\w.-]+/g, '-') : '') + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const reportColumns = [
    { key: 'name', label: 'Report', type: 'text', accessor: (r) => labels[r.key], render: (r) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span className="rl-clip" title={labels[r.key]} style={{ fontWeight: 600, maxWidth: 260 }}>{labels[r.key]}</span>
        <span className="chip" style={{ textTransform: 'uppercase', fontSize: 10, flexShrink: 0 }}>{r.type}</span>
      </span>
    ) },
    { key: 'addedAt', label: 'Added', type: 'date', mono: true, accessor: (r) => r.addedAt, render: (r) => <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>{formatDate(r.addedAt)}</span> },
    { key: 'creators', label: 'Creators', type: 'number', align: 'right', mono: true, accessor: (r) => r.creators },
    { key: 'totalViews', label: 'Views', type: 'number', align: 'right', mono: true, accessor: (r) => r.totalViews, render: (r) => formatViews(r.totalViews) },
    { key: 'avgEr', label: 'Avg ER', type: 'number', align: 'right', mono: true, accessor: (r) => r.avgEr, render: (r) => (r.avgEr != null ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{r.avgEr}%</span> : '-') },
    { key: 'open', label: '', sortable: false, filterable: false, align: 'right', render: (r) => (
      <button type="button" className="btn btn-secondary" style={{ height: 28, fontSize: 'var(--fs-xs)', padding: '0 12px', whiteSpace: 'nowrap' }} onClick={() => setActive(r.key)}>View creators</button>
    ) },
  ];

  const creatorColumns = [
    { key: 'username', label: 'Creator', type: 'text', accessor: (r) => r.username, render: (r) => <span className="rl-clip" title={r.username} style={{ fontWeight: 600, maxWidth: 240 }}>{r.username ? '@' + r.username : 'Unresolved creator'}</span> },
    { key: 'label', label: 'Report', type: 'select', accessor: (r) => r.label, render: (r) => <span className="rl-clip" title={r.label} style={{ color: 'var(--text-2)', fontSize: 'var(--fs-xs)', maxWidth: 200 }}>{r.label}</span> },
    { key: 'followers', label: 'Followers', type: 'number', align: 'right', mono: true, accessor: (r) => r.followers, render: (r) => formatViews(r.followers) },
    { key: 'views', label: 'Views', type: 'number', align: 'right', mono: true, accessor: (r) => r.views, render: (r) => formatViews(r.views) },
    { key: 'likes', label: 'Likes', type: 'number', align: 'right', mono: true, accessor: (r) => r.likes, render: (r) => formatViews(r.likes) },
    { key: 'er', label: 'ER %', type: 'number', align: 'right', mono: true, accessor: (r) => r.er, render: (r) => <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{r.er.toFixed(2)}%</span> },
    { key: 'addedAt', label: 'Added', type: 'date', mono: true, accessor: (r) => r.addedAt, render: (r) => <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>{formatDate(r.addedAt)}</span> },
  ];

  const Highlight = ({ label, row, value }) => (
    <div style={{ flex: '1 1 220px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 'var(--s4)', backgroundColor: 'var(--surface)' }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div className="rl-clip" title={'@' + row.username} style={{ fontWeight: 700, fontSize: 'var(--fs-md)', marginTop: 4 }}>@{row.username}</div>
      <div style={{ color: 'var(--ok)', fontFamily: 'var(--font-data)', fontSize: 'var(--fs-sm)', marginTop: 2 }}>{value}</div>
    </div>
  );

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
        <StatTile value={campaign.reportCount} label={campaign.reportCount === 1 ? 'Report' : 'Reports'} />
        <StatTile value={all.length.toLocaleString()} label="Creators measured" />
        <StatTile value={formatViews(campaign.totalViews)} label="Total views" accent />
        <StatTile value={campaign.avgEr != null ? campaign.avgEr + '%' : '-'} label="Average engagement" accent />
      </div>

      {reports.length > 1 && (
        <Collapsible id="portal-reports" title="Reports in this campaign" meta={reports.length + ' reports'}>
          <DataTable
            id="portal-reports"
            columns={reportColumns}
            rows={reports}
            getRowId={(r) => r.key}
            defaultSort={{ key: 'addedAt', dir: 'desc' }}
            renderMobile={(r) => (
              <div className="card" style={{ padding: 'var(--s3) var(--s4)' }}>
                <div className="rl-clip" title={labels[r.key]} style={{ fontWeight: 700 }}>{labels[r.key]}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', margin: '6px 0', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
                  <span>{r.creators} creators</span><span>{formatViews(r.totalViews)} views</span>
                  <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{r.avgEr != null ? r.avgEr + '%' : '-'} ER</span>
                </div>
                <button type="button" className="btn btn-secondary" style={{ width: '100%', height: 32, fontSize: 'var(--fs-xs)' }} onClick={() => setActive(r.key)}>View creators</button>
              </div>
            )}
          />
        </Collapsible>
      )}

      {(top || most) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
          {top && <Highlight label="Highest engagement" row={top} value={top.er.toFixed(2) + '% · ' + formatViews(top.views) + ' views'} />}
          {most && <Highlight label="Most views" row={most} value={formatViews(most.views) + ' views · ' + most.er.toFixed(2) + '% ER'} />}
        </div>
      )}

      <div className="rl-toolbar" style={{ marginBottom: 'var(--s3)' }}>
        <div className="rl-tabs" role="tablist" aria-label="Reports">
          <button type="button" role="tab" aria-selected={active === 'all'} className={'rl-tab' + (active === 'all' ? ' on' : '')} onClick={() => setActive('all')}>
            All creators <span className="rl-tab-count">{all.length}</span>
          </button>
          {reports.length > 1 && reports.map((r) => (
            <button key={r.key} type="button" role="tab" aria-selected={active === r.key} className={'rl-tab' + (active === r.key ? ' on' : '')} onClick={() => setActive(r.key)} title={labels[r.key]}>
              <span className="rl-clip" style={{ maxWidth: 160, display: 'inline-block', verticalAlign: 'bottom' }}>{labels[r.key]}</span> <span className="rl-tab-count">{all.filter((x) => x.reportKey === r.key).length}</span>
            </button>
          ))}
        </div>
        <input type="text" className="input-field rl-search" style={{ height: 34, flex: '1 1 200px', maxWidth: 300 }} placeholder="Search creators" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search creators" />
        <button type="button" className="btn btn-secondary rl-print-hide rl-toolbar-btn" style={{ height: 34, gap: 6 }} onClick={download}>
          <DownloadIcon size={14} />Download CSV
        </button>
      </div>

      <DataTable
        key={active}
        id="portal-creators"
        columns={creatorColumns}
        rows={visible}
        getRowId={(r) => r.id}
        search={search}
        searchText={(r) => r.username + ' ' + r.label}
        defaultSort={{ key: 'er', dir: 'desc' }}
        emptyTitle="No creators here yet"
        renderMobile={(r) => (
          <div className="card" style={{ padding: 'var(--s3) var(--s4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 'var(--s2)' }}>
              <span className="rl-clip" style={{ fontWeight: 700, fontSize: 'var(--fs-sm)' }}>{r.username ? '@' + r.username : 'Unresolved creator'}</span>
              <span className="mono" style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', color: 'var(--ok)', flexShrink: 0 }}>{r.er.toFixed(2)}%</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s2)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
              <div><div className="mono" style={{ fontWeight: 600 }}>{formatViews(r.followers)}</div>Followers</div>
              <div><div className="mono" style={{ fontWeight: 600 }}>{formatViews(r.views)}</div>Views</div>
              <div><div className="mono" style={{ fontWeight: 600 }}>{formatViews(r.likes)}</div>Likes</div>
            </div>
            <div className="rl-clip" style={{ marginTop: 'var(--s2)', fontSize: '10px', color: 'var(--text-3)' }}>{r.label} · {formatDate(r.addedAt)}</div>
          </div>
        )}
      />
    </>
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
  // Private to whoever holds the link, same as a shared report.
  useDocumentMeta({ title: 'Client portal', path: `/portal/${token}`, noindex: true });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    const root = document.documentElement;
    const before = root.getAttribute('data-theme');
    if (theme === 'dark') root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
    return () => { if (before) root.setAttribute('data-theme', before); else root.removeAttribute('data-theme'); };
  }, [theme]);

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
  const reports = data.reports || [];
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

      <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
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

        {rows.length === 0 ? (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', backgroundColor: 'var(--surface)', padding: 'var(--s6)', textAlign: 'center', color: 'var(--text-3)' }}>
            Nothing measured here yet. Check back once the first report is added.
          </div>
        ) : (
          <PortalBody campaign={campaign} rows={rows} reports={reports} accentColor={accentColor} />
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
