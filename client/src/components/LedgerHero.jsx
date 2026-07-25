import React, { useState, useEffect } from 'react';

export function LedgerHero() {
  const [activeRow, setActiveRow] = useState(2);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveRow(prev => (prev % 5) + 1);
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const rows = [
    { id: 1, reel: 'reel/Cj8x92A', views: '142.5K', likes: '12.8K', comments: '840', er: '9.58%' },
    { id: 2, reel: 'reel/Bk3m09L', views: '88.1K', likes: '7.4K', comments: '412', er: '8.86%' },
    { id: 3, reel: 'reel/Xy9p44Q', views: '310.2K', likes: '29.1K', comments: '1,930', er: '9.99%' },
    { id: 4, reel: 'reel/Lm2w78R', views: '54.9K', likes: '4.2K', comments: '215', er: '8.03%' },
    { id: 5, reel: 'reel/Zq5v11K', views: '209.4K', likes: '18.6K', comments: '1,120', er: '9.41%' }
  ];

  return (
    <div className="card" style={{ padding: 'var(--s4)', boxShadow: 'var(--shadow-lg)', backgroundColor: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s3)', borderBottom: '1px solid var(--border)', paddingBottom: 'var(--s2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--ok)' }} />
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>LIVE REPORT POSTING · 5/5 COMPLETE</span>
        </div>
        <span className="chip ok">Ready to download</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>
            <th style={{ padding: '8px' }}>REEL</th>
            <th style={{ padding: '8px', textAlign: 'right' }}>VIEWS</th>
            <th style={{ padding: '8px', textAlign: 'right' }}>LIKES</th>
            <th style={{ padding: '8px', textAlign: 'right' }}>ER</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} style={{ borderBottom: '1px solid var(--border)', backgroundColor: activeRow === r.id ? 'var(--accent-soft)' : 'transparent', transition: 'background 300ms ease' }}>
              <td style={{ padding: '8px', fontFamily: 'var(--font-data)' }}>{r.reel}</td>
              <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'var(--font-data)' }}>{r.views}</td>
              <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'var(--font-data)' }}>{r.likes}</td>
              <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'var(--font-data)', color: 'var(--ok)', fontWeight: 600 }}>{r.er}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
