import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useToast } from '../context/ToastContext';
import { BrandLoader } from '../components/BrandLoader';
import { ReportThemeStyles, ReportSheet, ThemeToggle } from '../components/ReportSheet';
import { ProBadge } from '../components/Premium';

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
  const [context, setContext] = useState({});
  const [error, setError] = useState('');
  const [theme, setTheme] = useState('light');

  // Same honest framing as the authenticated preview: this hands off to the
  // browser's own save sheet, so say so before the dialog appears rather
  // than letting a printer UI ambush someone who expected a file.
  /*
    PDF download is not built yet, so it is presented as locked rather than
    pretending. Clicking the browser's print sheet was never a download, and
    a client told us so twice.

    Shown, not hidden: a greyed control with a lock reads as "coming", while
    an absent one reads as "this product cannot do that". Same reasoning as
    the plan-gated controls in Premium.jsx. Delete this and restore
    handleSavePdf once server-side rendering exists.
  */
  const handlePdfLocked = () => {
    addToast("PDF download is coming soon. For now, use Download Excel or your browser's print option.", 'accent');
  };

  const handleSavePdf = () => {
    addToast('Choose "Save as PDF" as the destination.', 'accent');
    setTimeout(() => window.print(), 400);
  };

  useEffect(() => {
    apiFetch(`/public/reports/${token}`)
      .then((res) => {
        setJob(res.job);
        setBranding(res.branding || {});
        setContext(res.context || {});
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
      <BrandLoader variant="full" message="Loading report..." />
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
        {/*
          The mark is a link, and this is the single highest-value piece of
          marketing real estate the product has: the person reading this is a
          brand or client who was handed a polished report by someone else and
          is, by definition, interested in exactly what Reelytic does.

          Opens in a new tab on purpose. They came here to read a report, and
          navigating them away from it to sell to them would be both rude and
          a good way to lose the visit entirely.
        */}
        <a
          className="rl-report-brand"
          href="/?from=shared-report"
          target="_blank"
          rel="noopener"
          title="Reelytic: Instagram campaign reporting for agencies"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <img src="/logo-mark-128.png" alt="" width="30" height="30" style={{ display: 'block', objectFit: 'contain', flexShrink: 0 }} />
          <span className="rl-report-brand-name">
            R<span style={{ fontFamily: 'var(--font-data)', color: 'var(--accent)' }}>e</span>elytic
          </span>
        </a>
        <div className="rl-report-topbar-actions">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          {/* A plain link, not an apiFetch call: the browser handles the
              file save itself and the token in the URL is the only auth the
              endpoint needs. Carries the report's own columns only, never
              the agency's original uploaded sheet. */}
          <a
            className="btn btn-secondary"
            href={`/api/public/reports/${token}/export.xlsx`}
            style={{ flexShrink: 0, textDecoration: 'none' }}
          >
            <span className="rl-label-full">Download Excel</span>
            <span className="rl-label-short">Excel</span> ↓
          </a>
          <button
            className="btn btn-secondary"
            onClick={handlePdfLocked}
            title="PDF download is coming soon"
            style={{ flexShrink: 0, gap: 'var(--s2)', color: 'var(--text-3)' }}
          >
            <span style={{ color: 'var(--text-2)' }}>
              <span className="rl-label-full">Save as PDF</span>
              <span className="rl-label-short">PDF</span>
            </span>
            <ProBadge label="Soon" />
          </button>
        </div>
      </div>

      <ReportSheet job={job} branding={branding} context={context} maxWidth="1000px" />

      {/*
        The end-of-report call to action.

        Someone who has scrolled the whole way down has read every number and
        is the warmest lead this product will ever get. A grey one-line credit
        wasted that. This states what the tool does and gives them somewhere
        to go, while staying visually quieter than the agency's own branding
        above it, because this document belongs to the agency, not to us.
      */}
      <div
        className="rl-print-hide"
        style={{
          maxWidth: '1000px', margin: 'var(--s5) auto 0',
          border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
          backgroundColor: 'var(--surface)', padding: 'var(--s5)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 'var(--s4)', flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: '2px' }}>
            This report was built with Reelytic
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
            Turn a sheet of Instagram links into a client-ready report in minutes.
          </div>
        </div>
        <a
          className="btn btn-primary"
          href="/?from=shared-report-footer"
          target="_blank"
          rel="noopener"
          style={{ textDecoration: 'none', flexShrink: 0 }}
        >
          See how it works
        </a>
      </div>
    </div>
  );
}
