import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BrandLoader } from '../components/BrandLoader';
import { ReportThemeStyles, ReportSheet, ThemeToggle } from '../components/ReportSheet';
import { LockedFeatureButton, PREMIUM_FEATURES } from '../components/Premium';
import { ShareDialog, LinkIcon } from '../components/ShareDialog';
import { formatDate, formatDateTime, formatDayKey } from '../utils/date';

// The one-line summary next to "Manage shareable link". Expiry is stated as
// a date rather than a countdown, so it stays true whether the page has been
// open for a second or an hour.
function linkStatusLabel({ shareExpiresAt, shareViews }) {
  const opens = shareViews > 0
    ? `${shareViews} ${shareViews === 1 ? 'open' : 'opens'}`
    : 'Not opened yet';

  if (!shareExpiresAt) return `Link is live, never expires · ${opens}`;

  const when = new Date(shareExpiresAt);
  if (when.getTime() <= Date.now()) return `Link expired ${formatDate(when)} · ${opens}`;

  return `Expires ${formatDate(when)} · ${opens}`;
}

// Standalone route (no Shell sidebar) -- this page IS the preview: what's on
// screen is exactly what an unlocked account's real PDF download renders
// server-side (see pdfReport.service.js), so there is no separate render
// path to drift out of sync.
export function BrandedReport() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [job, setJob] = useState(null);
  const [branding, setBranding] = useState(null);
  const [context, setContext] = useState({});
  const [error, setError] = useState('');
  // Independent of the app's global theme (ThemeContext) -- a client-facing
  // report shouldn't flip based on whatever mode the agency user happens to
  // be browsing in. What's selected here is exactly what's on screen and
  // exactly what prints, so this is also how "download the dark variant" vs
  // "download the light variant" works: there's no separate render path,
  // just this toggle.
  /*
    Opens in whatever theme the workspace is currently in, rather than always
    light. Hardcoding light meant an agency working in dark mode clicked
    "Preview branded report" and got a light sheet dropped into a dark app,
    where the surrounding chrome (the toggle labels, the branding hint) was
    still painted for dark and became unreadable against it.

    Read from the resolved attribute ThemeProvider stamps on <html>, not from
    the stored preference, because the stored value can be "system" and this
    needs the theme that actually ended up on screen. Still a toggle: the
    agency can flip it to check the other variant before sending.
  */
  const [theme, setTheme] = useState(
    () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
  );
  const [shareState, setShareState] = useState({ shareToken: null, shareExpiresAt: null, shareViews: 0 });
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch(`/jobs/${jobId}`),
      apiFetch('/settings/report-branding'),
    ])
      .then(([jobRes, brandingRes]) => {
        setJob(jobRes.job);
        setContext(jobRes.context || {});
        setShareState({
          shareToken: jobRes.job.shareToken || null,
          shareExpiresAt: jobRes.job.shareExpiresAt || null,
          shareViews: jobRes.job.shareViews || 0,
        });
        setBranding(brandingRes.branding || {});
      })
      .catch((err) => setError(err.message || 'Could not load this report'));
  }, [jobId]);

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
        {/* No Reelytic mark here, deliberately.

            This screen belongs to the agency: they are looking at THEIR
            client's report, and their own logo already sits inside the sheet
            below. A second brand bolted into the chrome above it reads as
            clutter, not as branding. The shared public view is different, and
            keeps its mark: that page is seen by someone who has no
            relationship with us yet. */}
        <button className="btn btn-ghost" onClick={() => navigate(-1)} title="Back to report" style={{ padding: '0 var(--s3)', flexShrink: 0 }}>
          ← <span className="rl-label-full">Back to report</span>
        </button>

        <div className="rl-report-topbar-actions">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          {/*
            Real server-side PDF generation now exists (see
            pdfReport.service.js) -- but it stays behind the same
            'pdfExport' feature flag the server route checks, which no plan
            grants yet. An account without it keeps seeing the exact locked
            "Soon" button that was already here; nothing changes for them.
            An admin grants pdfExport per-client via featureOverrides to
            enable this for real, ahead of it being a sellable plan feature.
          */}
          {user?.features?.pdfExport ? (
            <a
              className="btn btn-secondary"
              href={`/api/jobs/${jobId}/branded.pdf`}
              title="Download a PDF of this branded report"
              style={{ flexShrink: 0, gap: 'var(--s2)' }}
            >
              <span className="rl-label-full">Download PDF</span>
              <span className="rl-label-short">PDF</span>
            </a>
          ) : (
            // Same locked-button + upgrade-dialog pattern as "Get shareable
            // link" below, not a standalone "coming soon" toast -- the
            // feature is real and gated, not unbuilt.
            <LockedFeatureButton
              label={<><span className="rl-label-full">Download PDF</span><span className="rl-label-short">PDF</span></>}
              feature={PREMIUM_FEATURES.pdfExport}
              style={{ flexShrink: 0 }}
            />
          )}
        </div>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <div className="rl-print-hide" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
          {shareState.shareToken ? (
            <>
              <button className="btn btn-secondary" data-tour="share-link" onClick={() => setShareOpen(true)} style={{ gap: 'var(--s2)' }}>
                <LinkIcon />Manage link
              </button>
              {/* The status the agency actually needs at a glance: is it
                  still live, and did the client open it. Anything more
                  detailed belongs in the dialog. */}
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
                {linkStatusLabel(shareState)}
              </span>
            </>
          ) : user?.features?.shareableLinks ? (
            <button className="btn btn-secondary" data-tour="share-link" onClick={() => setShareOpen(true)} style={{ gap: 'var(--s2)' }}>
              <LinkIcon />Get shareable link
            </button>
          ) : (
            // Same slot, same shape as the real button, just locked -- the
            // feature reads as available-but-not-yours rather than missing.
            <LockedFeatureButton label="Get shareable link" feature={PREMIUM_FEATURES.shareableLinks} dataTour="share-link" />
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

      <ReportSheet job={job} branding={branding} context={context} maxWidth="1000px" />

      <ShareDialog
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        jobId={jobId}
        onStateChange={setShareState}
      />
    </div>
  );
}
