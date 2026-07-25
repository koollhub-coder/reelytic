import React from 'react';

export function ProgressBar({ percent = 0 }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-full)', overflow: 'hidden' }}>
      <div style={{ width: `${clamped}%`, height: '100%', backgroundColor: 'var(--accent)', transition: 'width 200ms ease' }} />
    </div>
  );
}
