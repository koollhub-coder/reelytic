import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Shimmer } from '../components/Shimmer';
import { ReportThemeStyles, ReportSheet } from '../components/ReportSheet';
import { ProBadge } from '../components/ProBadge';

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
    return <div style={{ padding: 'var(--s6)', maxWidth: '1000px', margin: '0 auto' }}><Shimmer height="500px" /></div>;
  }

  const hasBranding = !!(branding.agencyName || branding.logoDataUri);

  return (
    <div className={theme === 'dark' ? 'rl-report-dark' : 'rl-report-light'} style={{ minHeight: '100vh', backgroundColor: 'var(--surface-2)', padding: 'var(--s6) var(--s4)' }}>
      <ReportThemeStyles theme={theme} />

      <div className="rl-print-hide" style={{ maxWidth: '1000px', margin: '0 auto var(--s3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>← Back to report</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          {!hasBranding && (
            <a href="/settings" className="chip warn" style={{ textDecoration: 'none' }}>
              Add your logo and agency name in Settings
            </a>
          )}
          {shareToken ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
              <button className="btn btn-secondary" disabled={shareBusy} onClick={handleCopyLink}>Copy shareable link</button>
              <button type="button" className="btn btn-ghost" onClick={handleRevoke} disabled={shareBusy}>
                Turn off
              </button>
            </div>
          ) : user?.features?.shareableLinks ? (
            <button className="btn btn-secondary" disabled={shareBusy} onClick={handleGetShareLink}>
              {shareBusy ? 'Creating link...' : 'Get shareable link'}
            </button>
          ) : (
            <a
              href="/pricing"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 'var(--s2)', textDecoration: 'none',
                fontSize: 'var(--fs-xs)', color: 'var(--text-2)', border: '1px solid var(--border-strong)',
                borderRadius: 'var(--r-md)', padding: '6px 6px 6px 12px', backgroundColor: 'var(--surface)',
              }}
            >
              Shareable links <ProBadge />
            </a>
          )}
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
      </div>

      <div className="rl-print-hide" style={{ maxWidth: '1000px', margin: '0 auto var(--s4)', textAlign: 'right', fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
        Tip: in the print dialog, open "More settings" and turn off "Headers and footers" to remove the browser's own date/URL stamp from the PDF.
      </div>

      <ReportSheet job={job} branding={branding} maxWidth="1000px" />
    </div>
  );
}
