import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Logo({ compact = false, size = 36 }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const clickTimes = useRef([]);

  const handleClick = (e) => {
    e.preventDefault();
    navigate('/');

    if (!user || user.role !== 'admin') return;

    const now = Date.now();
    clickTimes.current.push(now);
    clickTimes.current = clickTimes.current.filter(t => now - t < 3000);

    if (clickTimes.current.length >= 5) {
      clickTimes.current = [];
      navigate('/dev-unlock');
    }
  };

  return (
    <a href="/" onClick={handleClick} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none', cursor: 'pointer' }}>
      {/* Empty alt when the wordmark text is also rendered -- that text is
          already the accessible name, and a non-empty alt here would have a
          screen reader announce "Reelytic Reelytic". Compact mode drops the
          text, so the image becomes the only label and needs a real one. */}
      <img src="/logo-mark-128.png" alt={compact ? 'Reelytic' : ''} width={size} height={size} style={{ display: 'block', objectFit: 'contain' }} />
      {!compact && (
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '20px', color: 'var(--text)', letterSpacing: '-0.02em' }}>
          R<span style={{ fontFamily: 'var(--font-data)', color: 'var(--accent)' }}>e</span>elytic
        </span>
      )}
    </a>
  );
}
