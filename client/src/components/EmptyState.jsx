import React from 'react';

export function EmptyState({ icon = '📊', title, description, action }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 'var(--s8) var(--s5)' }}>
      <div style={{ fontSize: '42px', marginBottom: 'var(--s3)' }}>{icon}</div>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
        {title}
      </h3>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)', maxWidth: '420px', margin: '0 auto var(--s5) auto' }}>
        {description}
      </p>
      {action}
    </div>
  );
}
