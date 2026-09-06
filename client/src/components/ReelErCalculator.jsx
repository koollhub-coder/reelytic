import React, { useState } from 'react';

// Turns the Reel ER formula from something you read into something you can
// poke at: ER = (Likes + Comments) / Views * 100, live-computed from three
// plain number inputs. Shared between the client-facing "How is this
// calculated?" page and its admin equivalent (admin/ProfileMethodology.jsx)
// -- same formula, same page section (Reel reports), no reason for either
// to have a different or missing version of it.
export function ReelErCalculator() {
  const [views, setViews] = useState(10000);
  const [likes, setLikes] = useState(450);
  const [comments, setComments] = useState(30);

  const v = Number(views) || 0;
  const er = v > 0 ? (((Number(likes) || 0) + (Number(comments) || 0)) / v) * 100 : null;

  const field = (label, value, setValue) => (
    <div style={{ flex: '1 1 120px', minWidth: 0 }}>
      <label className="input-label" style={{ fontSize: 'var(--fs-xs)' }}>{label}</label>
      <input
        type="number"
        min="0"
        className="input-field mono"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: '100%' }}
      />
    </div>
  );

  return (
    <div style={{ padding: 'var(--s4) var(--s5)', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', marginTop: 'var(--s5)' }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 'var(--s3)' }}>
        Try it yourself
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)', alignItems: 'flex-end' }}>
        {field('Views', views, setViews)}
        {field('Likes', likes, setLikes)}
        {field('Comments', comments, setComments)}
        <div style={{ flex: '1 1 140px', textAlign: 'right' }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>Engagement rate</div>
          <div className="mono" style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--accent)' }}>
            {er == null ? '-' : `${er.toFixed(2)}%`}
          </div>
        </div>
      </div>
    </div>
  );
}
