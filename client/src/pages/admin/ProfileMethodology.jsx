import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { BrandLoader } from '../../components/BrandLoader';
import { PROFILE_METHODOLOGY } from '../../content/profileMethodology';
import { REEL_METHODOLOGY } from '../../content/reelMethodology';

// Admin-facing "how is this calculated" view -- internal only (requireAdmin
// on the routes it reads), covering BOTH report types under the one "How
// It's Calculated" sidebar entry. Same formula/rule text as the
// client-facing modals, PLUS which method is active for each and a link to
// Usage & Spend for actual cost figures (not duplicated here -- one source
// of truth for costs). Genuinely separate components from the client-facing
// ones, not the same page with fields conditionally shown.
export function ProfileMethodology() {
  const [mode, setMode] = useState(null);
  const [info, setInfo] = useState(null);
  const [reelMode, setReelMode] = useState(null);
  const [reelInfo, setReelInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiFetch('/admin/settings/profile-pipeline'),
      apiFetch('/admin/settings/reel-pipeline'),
    ])
      .then(([profileRes, reelRes]) => {
        setMode(profileRes.mode); setInfo(profileRes.info);
        setReelMode(reelRes.mode); setReelInfo(reelRes.info);
      })
      .catch((err) => setError(err.message || "Couldn't load the active data source"))
      .finally(() => setLoading(false));
  }, []);

  const variant = mode === 'v2' ? 'refined' : 'standard';
  const profileSections = [
    PROFILE_METHODOLOGY.erFormula,
    PROFILE_METHODOLOGY.sortOrder[variant],
    PROFILE_METHODOLOGY.outlierRule[variant],
    PROFILE_METHODOLOGY.exclusions,
  ];
  const reelSections = [
    REEL_METHODOLOGY.erFormula,
    REEL_METHODOLOGY.whatEachColumnMeans,
    REEL_METHODOLOGY.followers,
    REEL_METHODOLOGY.scope,
  ];

  const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--s6)' };

  const activeMethodBanner = (label, activeMode, activeInfo) => (
    <div className="card" style={{ marginBottom: 'var(--s5)', padding: 'var(--s5)' }}>
      {loading ? <BrandLoader variant="inline" minHeight="60px" message="" /> : error ? (
        <span style={{ color: 'var(--err)', fontSize: 'var(--fs-sm)' }}>{error}</span>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>{label}:</span>
          <span className={`chip ${activeMode === 'v2' || activeMode === 'express' ? 'warn' : 'ok'}`} style={{ fontWeight: 600 }}>{activeInfo?.[activeMode]?.label || activeMode}</span>
          <a href="/admin/scan-settings" style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)' }}>Manage scan settings</a>
          <span style={{ color: 'var(--text-3)' }}>·</span>
          <a href="/admin/usage" style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)' }}>See cost figures in Usage & Spend →</a>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>How Reports Are Calculated</h1>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s6)', maxWidth: '70ch' }}>
        The same plain-language explanations clients see when they click "How is this calculated?" on their own reports, plus internal context below.
      </p>

      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Profile reports</h2>
      {activeMethodBanner('Active scan method for this rule set', mode, info)}
      <div className="rl-card-grid" style={{ gap: 'var(--s5)', marginBottom: 'var(--s6)' }}>
        {profileSections.map((s) => (
          <div key={s.heading} style={cardStyle}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-lg)', marginBottom: 'var(--s2)' }}>{s.heading}</div>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)', margin: 0, lineHeight: 1.6 }}>{s.body}</p>
          </div>
        ))}
      </div>

      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Reel reports</h2>
      {activeMethodBanner('Active scan method for this rule set', reelMode, reelInfo)}
      <div className="rl-card-grid" style={{ gap: 'var(--s5)' }}>
        {reelSections.map((s) => (
          <div key={s.heading} style={cardStyle}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-lg)', marginBottom: 'var(--s2)' }}>{s.heading}</div>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)', margin: 0, lineHeight: 1.6 }}>{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
