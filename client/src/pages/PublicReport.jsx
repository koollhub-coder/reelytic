import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { Shimmer } from '../components/Shimmer';
import { ReportThemeStyles, ReportSheet } from '../components/ReportSheet';

// The read-only view behind a "Get shareable link" URL (see BrandedReport.jsx
// and jobs.routes.js POST /:id/share). No login, no session -- whoever holds
// the link can open this, which is the whole point of sharing it with a
// client who has no Reelytic account. Hits /api/public/reports/:token, a
// deliberately separate, unauthenticated endpoint that only ever returns the
// slim, display-only fields ReportSheet needs (see public.routes.js).
export function PublicReport() {
  const { token } = useParams();
  const [job, setJob] = useState(null);
  const [branding, setBranding] = useState(null);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    apiFetch(`/public/reports/${token}`)
      .then((res) => {
        setJob(res.job);
        setBranding(res.branding || {});
      })
      .catch((err) => setError(err.message || "This link is invalid or has been turned off."));
  }, [token]);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--s4)', padding: 'var(--s6)', backgroundColor: 'var(--bg)' }}>
        <p style={{ color: 'var(--err)' }}>{error}</p>
        <Link to="/" className="btn btn-secondary">Go to Reelytic</Link>
      </div>
    );
  }
  if (!job || !branding) {
    return <div style={{ padding: 'var(--s6)', maxWidth: '1000px', margin: '0 auto' }}><Shimmer height="500px" /></div>;
  }

  return (
    <div className={theme === 'dark' ? 'rl-report-dark' : 'rl-report-light'} style={{ minHeight: '100vh', backgroundColor: 'var(--surface-2)', padding: 'var(--s6) var(--s4)' }}>
      <ReportThemeStyles theme={theme} />

      <div className="rl-print-hide" style={{ maxWidth: '1000px', margin: '0 auto var(--s4)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '3px' }}>
          <button
            type="button"
            onClick={() => setTheme('light')}
            style={{ height: '28px', padding: '0 12px', fontSize: 'var(--fs-xs)', fontWeight: theme === 'light' ? 700 : 400, borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer', backgroundColor: theme === 'light' ? 'var(--surface-2)' : 'transparent', color: 'var(--text)' }}
          >
            ☀ Light
          </button>
          <button
            type="button"
            onClick={() => setTheme('dark')}
            style={{ height: '28px', padding: '0 12px', fontSize: 'var(--fs-xs)', fontWeight: theme === 'dark' ? 700 : 400, borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer', backgroundColor: theme === 'dark' ? 'var(--surface-2)' : 'transparent', color: 'var(--text)' }}
          >
            ● Dark
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => window.print()}>Download PDF ↓</button>
      </div>

      <ReportSheet job={job} branding={branding} maxWidth="1000px" />

      <div className="rl-print-hide" style={{ maxWidth: '1000px', margin: 'var(--s4) auto 0', textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
        Reports like this one are built with{' '}
        <Link to="/" style={{ color: 'var(--text-2)' }}>Reelytic</Link>
      </div>
    </div>
  );
}
