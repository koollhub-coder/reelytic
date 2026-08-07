import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useToast } from '../context/ToastContext';
import { Shimmer } from '../components/Shimmer';
import { ReportThemeStyles, ReportSheet, ThemeToggle } from '../components/ReportSheet';

// The read-only view behind a "Get shareable link" URL (see BrandedReport.jsx
// and jobs.routes.js POST /:id/share). No login, no session -- whoever holds
// the link can open this, which is the whole point of sharing it with a
// client who has no Reelytic account. Hits /api/public/reports/:token, a
// deliberately separate, unauthenticated endpoint that only ever returns the
// slim, display-only fields ReportSheet needs (see public.routes.js).
export function PublicReport() {
  const { token } = useParams();
  const { addToast } = useToast();
  const [job, setJob] = useState(null);
  const [branding, setBranding] = useState(null);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState('light');

  // Same honest framing as the authenticated preview: this hands off to the
  // browser's own save sheet, so say so before the dialog appears rather
  // than letting a printer UI ambush someone who expected a file.
  const handleSavePdf = () => {
    addToast('Opening your browser\'s save sheet. Pick "Save as PDF" as the destination.', 'accent');
    setTimeout(() => window.print(), 400);
  };

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
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--s4)', padding: 'var(--s6)', backgroundColor: 'var(--bg)' }}>
        <Shimmer width="56px" height="56px" borderRadius="50%" />
        <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>Loading report...</div>
      </div>
    );
  }

  return (
    <div className={theme === 'dark' ? 'rl-report-dark' : 'rl-report-light'} style={{ minHeight: '100vh', backgroundColor: 'var(--surface-2)', padding: 'var(--s6) var(--s4)' }}>
      <ReportThemeStyles theme={theme} />

      {/* A real header, not a floating pair of buttons. This is the first
          thing an agency's own client sees when they open a shared link, so
          it carries the Reelytic mark for credibility and keeps the actions
          on one row down to phone width. */}
      <div className="rl-print-hide rl-report-topbar">
        <div className="rl-report-brand">
          <img src="/logo-mark-128.png" alt="" width="30" height="30" style={{ display: 'block', objectFit: 'contain', flexShrink: 0 }} />
          <span className="rl-report-brand-name">
            R<span style={{ fontFamily: 'var(--font-data)', color: 'var(--accent)' }}>e</span>elytic
          </span>
        </div>
        <div className="rl-report-topbar-actions">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button className="btn btn-primary" onClick={handleSavePdf} style={{ flexShrink: 0 }}>
            <span className="rl-label-full">Save as PDF</span>
            <span className="rl-label-short">PDF</span> ↓
          </button>
        </div>
      </div>

      <ReportSheet job={job} branding={branding} maxWidth="1000px" />

      <div className="rl-print-hide" style={{ maxWidth: '1000px', margin: 'var(--s4) auto 0', textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
        Reports like this one are built with{' '}
        <Link to="/" style={{ color: 'var(--text-2)' }}>Reelytic</Link>
      </div>
    </div>
  );
}
