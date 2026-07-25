import React from 'react';

export function StatCard({ label, value, sub, accent = false }) {
  return (
    <div className="card" style={{ padding: 'var(--s4)' }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-xl)', fontWeight: 600, color: accent ? 'var(--accent)' : 'var(--text)' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}
