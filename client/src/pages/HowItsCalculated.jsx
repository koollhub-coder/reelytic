import React from 'react';
import { PROFILE_METHODOLOGY } from '../content/profileMethodology';
import { REEL_METHODOLOGY } from '../content/reelMethodology';

function formatViews(n) {
  return n == null ? '-' : n.toLocaleString();
}

/*
  Client-facing methodology page, reachable from the sidebar. Same hard
  boundary as the modals it draws its content from: no vendor or actor name,
  no cost figure, no internal pipeline label, nothing that hints at how the
  data is gathered.

  LAID OUT AS DOCUMENTATION, NOT AS A CARD WALL. Every item used to be an
  equal-sized box in a wrapping flex row that centred its last line, so four
  items became a row of three and one stranded card floating in the middle of
  the page, and a one-line formula got the same visual weight as a paragraph.
  Reference material reads better as headed rows of definitions: the formula
  gets stated once, prominently, and the explanations sit underneath it in a
  predictable label/description rhythm that never reflows into orphans.
*/

// The single most important fact about a report type, given the emphasis it
// deserves instead of being buried in a box the same size as everything else.
function FormulaCallout({ formula }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--s3)',
        padding: 'var(--s4) var(--s5)',
        background: 'var(--surface-2)',
        borderLeft: '3px solid var(--accent)',
        borderRadius: 'var(--r-sm)',
        marginBottom: 'var(--s5)',
      }}
    >
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
        Engagement rate
      </span>
      <span className="mono" style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text)' }}>
        {formula}
      </span>
    </div>
  );
}

// Label on the left, explanation on the right, hairline between rows.
// Collapses to stacked blocks under 768px via rl-stack-mobile.
function DefinitionRows({ items }) {
  return (
    <div>
      {items.map((s, i) => (
        <div
          key={s.heading}
          className="rl-stack-mobile"
          style={{
            display: 'grid',
            gridTemplateColumns: '240px 1fr',
            gap: 'var(--s5)',
            padding: 'var(--s4) 0',
            borderTop: i === 0 ? 'none' : '1px solid var(--border)',
            alignItems: 'start',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
            {s.heading}
          </div>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', margin: 0, lineHeight: 1.65, maxWidth: '68ch' }}>
            {s.body}
          </p>
        </div>
      ))}
    </div>
  );
}

function Section({ eyebrow, title, blurb, children }) {
  return (
    <section style={{ marginBottom: 'var(--s7)' }}>
      <div style={{ marginBottom: 'var(--s4)' }}>
        <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--accent)', marginBottom: 6 }}>
          {eyebrow}
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, lineHeight: 1.25 }}>
          {title}
        </h2>
        {blurb && (
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: 6, maxWidth: '68ch', lineHeight: 1.6 }}>
            {blurb}
          </p>
        )}
      </div>
      <div className="card" style={{ padding: 'var(--s5) var(--s6)' }}>
        {children}
      </div>
    </section>
  );
}

export function HowItsCalculated() {
  const reelRows = [
    REEL_METHODOLOGY.whatEachColumnMeans,
    REEL_METHODOLOGY.followers,
    REEL_METHODOLOGY.scope,
  ];
  const profileRows = [
    PROFILE_METHODOLOGY.sortOrder.refined,
    PROFILE_METHODOLOGY.outlierRule.refined,
    PROFILE_METHODOLOGY.exclusions,
  ];
  const example = PROFILE_METHODOLOGY.workedExample;

  return (
    <div style={{ maxWidth: '1000px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
        How is this calculated?
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)', marginBottom: 'var(--s7)', maxWidth: '68ch', lineHeight: 1.6 }}>
        Every number on your reports comes from a plain formula, not a black box. Here is exactly how each report type works, so you can
        check the maths yourself any time.
      </p>

      <Section
        eyebrow="ONE ROW PER LINK"
        title="Reel reports"
        blurb="You give us Reel links. Each one comes back as its own row, with nothing added and nothing averaged."
      >
        <FormulaCallout formula={REEL_METHODOLOGY.erFormula.body} />
        <DefinitionRows items={reelRows} />
      </Section>

      <Section
        eyebrow="ONE ROW PER CREATOR"
        title="Profile reports"
        blurb="You give us profile links. Each creator comes back as a single row averaged across their recent Reels, with the freak results handled for you."
      >
        <FormulaCallout formula={PROFILE_METHODOLOGY.erFormula.body} />
        <DefinitionRows items={profileRows} />
      </Section>

      <Section eyebrow="WORKED EXAMPLE" title={example.heading} blurb={example.intro}>
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
              {example.posts.map((p, i) => (
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
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: 'var(--s4)', marginBottom: 0, lineHeight: 1.65, maxWidth: '68ch' }}>
          {example.outcome}
        </p>
      </Section>
    </div>
  );
}
