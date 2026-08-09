import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { BrandLoader } from '../components/BrandLoader';
import { ReportThemeStyles, ReportSheet, ThemeToggle } from '../components/ReportSheet';
import { LockedFeatureButton, PREMIUM_FEATURES } from '../components/Premium';

// Standalone route (no Shell sidebar) -- this page IS the preview: what's on
// screen is exactly what prints, no separate render path to drift out of
// sync. "Download PDF" is the browser's own print dialog with a Save-as-PDF
// destination, not a server-generated file -- no new dependency, no
// server load, and it can never show something different from what the
// agency already reviewed on screen.
export function BrandedReport() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const [job, setJob] = useState(null);
  const [branding, setBranding] = useState(null);
  const [error, setError] = useState('');
  // Independent of the app's global theme (ThemeContext) -- a client-facing
  // report shouldn't flip based on whatever mode the agency user happens to
  // be browsing in. What's selected here is exactly what's on screen and
  // exactly what prints, so this is also how "download the dark variant" vs
  // "download the light variant" works: there's no separate render path,
  // just this toggle.
  const [theme, setTheme] = useState('light');
  const [shareToken, setShareToken] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch(`/jobs/${jobId}`),
      apiFetch('/settings/report-branding'),
    ])
      .then(([jobRes, brandingRes]) => {
        setJob(jobRes.job);
        setShareToken(jobRes.job.shareToken || null);
        setBranding(brandingRes.branding || {});
      })
      .catch((err) => setError(err.message || 'Could not load this report'));
  }, [jobId]);

  const handleGetShareLink = async () => {
    setShareBusy(true);
    try {
      const res = await apiFetch(`/jobs/${jobId}/share`, { method: 'POST' });
      setShareToken(res.shareToken);
      await navigator.clipboard.writeText(`${window.location.origin}/share/${res.shareToken}`);
      addToast('Shareable link copied. Anyone with it can view this report, no login needed.', 'ok');
    } catch (err) {
      addToast(err.message || "Couldn't create a shareable link", 'err');
    } finally {
      setShareBusy(false);
    }
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${shareToken}`);
    addToast('Link copied', 'ok');
  };

  // Renamed from "Download PDF": this opens the browser's own print sheet
  // with Save-as-PDF as the destination, which is not what "Download"
  // promises -- clients reported being surprised by a printer dialog. The
  // toast says up front what's about to happen so the dialog isn't a
  // surprise, and doubles as the place to mention the headers/footers
  // setting that otherwise stamps a URL on every page.
  const handleSavePdf = () => {
    addToast('Opening your browser\'s save sheet. Pick "Save as PDF" as the destination, and turn off "Headers and footers" under More settings for a clean file.', 'accent');
    setTimeout(() => window.print(), 400);
  };

  const handleRevoke = async () => {
    setShareBusy(true);
    try {
      await apiFetch(`/jobs/${jobId}/share/revoke`, { method: 'POST' });
      setShareToken(null);
      addToast('Shareable link turned off', 'ok');
    } catch (err) {
      addToast(err.message || "Couldn't turn off the link", 'err');
    } finally {
      setShareBusy(false);
    }
  };

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--s4)', padding: 'var(--s6)' }}>
        <p style={{ color: 'var(--err)' }}>{error}</p>
        <button className="btn btn-secondary" onClick={() => navigate('/history')}>Back to history</button>
      </div>
    );
  }
  if (!job || !branding) {
    return (
      <BrandLoader variant="full" message="Loading report..." />
    );
  }

  const hasBranding = !!(branding.agencyName || branding.logoDataUri);

  return (
    <div className={theme === 'dark' ? 'rl-report-dark' : 'rl-report-light'} style={{ minHeight: '100vh', backgroundColor: 'var(--surface-2)', padding: 'var(--s6) var(--s4)' }}>
      <ReportThemeStyles theme={theme} />

      <div className="rl-print-hide rl-report-topbar">
        <button className="btn btn-ghost" onClick={() => navigate(-1)} title="Back to report" style={{ padding: '0 var(--s3)', flexShrink: 0 }}>
          ← <span className="rl-label-full">Back to report</span>
        </button>

        <div className="rl-report-topbar-actions">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <button className="btn btn-primary" onClick={handleSavePdf} style={{ flexShrink: 0 }}>
            <span className="rl-label-full">Save as PDF</span>
            <span className="rl-label-short">PDF</span> ↓
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <div className="rl-print-hide" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
          {shareToken ? (
            <>
              <button className="btn btn-secondary" disabled={shareBusy} onClick={handleCopyLink}>Copy shareable link</button>
              <button type="button" className="btn btn-ghost" onClick={handleRevoke} disabled={shareBusy}>Turn off</button>
            </>
          ) : user?.features?.shareableLinks ? (
            <button className="btn btn-secondary" disabled={shareBusy} onClick={handleGetShareLink}>
              {shareBusy ? 'Creating link...' : 'Get shareable link'}
            </button>
          ) : (
            // Same slot, same shape as the real button, just locked -- the
            // feature reads as available-but-not-yours rather than missing.
            <LockedFeatureButton label="Get shareable link" feature={PREMIUM_FEATURES.shareableLinks} />
          )}

          {/* A setup nudge, not a warning. Amber said "something is broken"
              about an account that simply hasn't uploaded a logo yet. */}
          {!hasBranding && (
            <a
              href="/settings"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none',
                fontSize: 'var(--fs-xs)', color: 'var(--text-2)',
                padding: '0 var(--s2)', height: '36px',
              }}
            >
              <span style={{ color: 'var(--text-3)' }}>Using default branding.</span>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Add your logo</span>
            </a>
          )}
        </div>
      </div>

      <ReportSheet job={job} branding={branding} maxWidth="1000px" />
    </div>
  );
}
