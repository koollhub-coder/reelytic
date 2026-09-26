import React from 'react';

export function EmptyState({ icon = '', title, description, action }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 'var(--s8) var(--s5)' }}>
      {/* Rendered only when there is actually an icon. Left unconditional,
          an empty string still produced a 42px-tall line box plus its margin,
          so every empty state carried a phantom gap above its heading once the
          emoji were removed. */}
      {icon ? (
        <div style={{ width: 64, height: 64, margin: '0 auto var(--s4)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-2)', color: 'var(--text-2)', fontSize: '32px' }}>{icon}</div>
      ) : null}
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
