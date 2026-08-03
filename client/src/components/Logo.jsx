import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Logo() {
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
      <div style={{ width: '32px', height: '32px', borderRadius: '8px', backgroundColor: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '18px' }}>
        R
      </div>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '20px', color: 'var(--text)', letterSpacing: '-0.02em' }}>
        R<span style={{ fontFamily: 'var(--font-data)', color: 'var(--accent)' }}>e</span>elytic
      </span>
    </a>
  );
}
