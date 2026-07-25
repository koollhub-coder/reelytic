import React from 'react';
import { useNavigate } from 'react-router-dom';

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg)', padding: 'var(--s5)' }}>
      <div className="card" style={{ textAlign: 'center', maxWidth: '440px', padding: 'var(--s7)' }}>
        <div style={{ fontFamily: 'var(--font-data)', fontSize: '48px', fontWeight: 700, color: 'var(--accent)', marginBottom: 'var(--s2)' }}>404</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Page not found</h1>
        <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s6)', fontSize: 'var(--fs-base)' }}>
          The ledger entry or page you are looking for does not exist or has been archived.
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/reels')}>
          Back to Reelytic
        </button>
      </div>
    </div>
  );
}
