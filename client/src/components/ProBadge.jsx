import React from 'react';

// The small "this needs a higher plan" pill used everywhere a plan-gated
// feature shows up locked (see features.service.js on the server for what's
// actually gated). An inline SVG, not an emoji -- emoji lock glyphs render
// inconsistently across OS/browser combos (chunky on Windows, tiny on Mac),
// which is exactly the kind of detail that reads as "not quite finished."
export function ProBadge({ style }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
        color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
        padding: '3px 8px 3px 6px', borderRadius: 'var(--r-full)', textTransform: 'uppercase',
        boxShadow: '0 2px 8px color-mix(in srgb, var(--accent) 35%, transparent)',
        ...style,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="2.4" fill="none" />
      </svg>
      Pro
    </span>
  );
}
