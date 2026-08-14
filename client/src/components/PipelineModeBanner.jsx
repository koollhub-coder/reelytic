import React from 'react';

// Prominent, hard-to-miss indicator of which profile scan method is
// currently live -- reused on Cost Monitor and Usage & Spend so nobody
// looking at a cost number ever has to wonder which method produced it.
// Both methods are equally supported and produce accurate results, so
// neither gets a warning treatment -- this is just a status indicator.
export function PipelineModeBanner({ mode, info }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--s4)',
        flexWrap: 'wrap',
        padding: 'var(--s4) var(--s5)',
        marginBottom: 'var(--s5)',
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--ok)',
        backgroundColor: 'var(--ok-soft)',
      }}
    >
      <div style={{ fontSize: '22px', lineHeight: 1 }}></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', fontWeight: 700, marginBottom: '2px' }}>
          Profile Scan Method, Live Now
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--ok)' }}>
          {info?.label || mode}
        </div>
        {info?.approxCostInr && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginTop: '2px' }}>{info.approxCostInr}</div>
        )}
      </div>
      <a href="/admin/scan-settings" className="btn btn-secondary" style={{ flexShrink: 0 }}>
        Change scan method
      </a>
    </div>
  );
}
