import React from 'react';
import { PROFILE_METHODOLOGY } from '../content/profileMethodology';
import { REEL_METHODOLOGY } from '../content/reelMethodology';

function formatViews(n) {
  return n == null ? '-' : n.toLocaleString();
}

// Client-facing page, reachable from the sidebar, not buried inside a
// report. Same hard boundary as the modals it draws its content from: no
// vendor/actor name, no cost figure, no internal pipeline label, no words
// that hint at how the data is gathered.
export function HowItsCalculated() {
  const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--s5)' };

  const reelSections = [
    REEL_METHODOLOGY.erFormula,
    REEL_METHODOLOGY.whatEachColumnMeans,
    REEL_METHODOLOGY.followers,
    REEL_METHODOLOGY.scope,
  ];
  const profileSections = [
    PROFILE_METHODOLOGY.erFormula,
    PROFILE_METHODOLOGY.sortOrder.refined,
    PROFILE_METHODOLOGY.outlierRule.refined,
    PROFILE_METHODOLOGY.exclusions,
  ];

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>How is this calculated?</h1>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s6)', maxWidth: '65ch' }}>
        Every number on your reports comes from a plain formula, not a black box. Here's exactly how each report type works, so you can check
        the math yourself any time.
      </p>

      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Reel reports</h2>
      <div className="rl-card-grid" style={{ gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
        {reelSections.map((s) => (
          <div key={s.heading} style={cardStyle}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', marginBottom: '6px' }}>{s.heading}</div>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', margin: 0, lineHeight: 1.6 }}>{s.body}</p>
          </div>
        ))}
      </div>

      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Profile reports</h2>
      <div className="rl-card-grid" style={{ gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
        {profileSections.map((s) => (
          <div key={s.heading} style={cardStyle}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', marginBottom: '6px' }}>{s.heading}</div>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', margin: 0, lineHeight: 1.6 }}>{s.body}</p>
          </div>
        ))}
      </div>

      <div style={cardStyle}>
        <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', marginBottom: '4px' }}>{PROFILE_METHODOLOGY.workedExample.heading}</div>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)', lineHeight: 1.6 }}>
          {PROFILE_METHODOLOGY.workedExample.intro}
        </p>
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Post</th>
                <th className="numeric">Views</th>
                <th>In the average?</th>
              </tr>
            </thead>
            <tbody>
              {PROFILE_METHODOLOGY.workedExample.posts.map((p, i) => (
                <tr key={i}>
                  <td>{p.label}</td>
                  <td className="numeric mono">{formatViews(p.views)}</td>
                  <td>
                    {p.reason ? (
                      <span className="chip warn">{p.reason}</span>
                    ) : (
                      <span className="chip ok">Included</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: 'var(--s4)', marginBottom: 0, lineHeight: 1.6 }}>
          {PROFILE_METHODOLOGY.workedExample.outcome}
        </p>
      </div>
    </div>
  );
}
