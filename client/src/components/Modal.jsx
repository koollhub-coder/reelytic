import React, { useEffect } from 'react';

export function Modal({ isOpen, onClose, title, children, width = '480px' }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
      <div className="card" style={{ width, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close modal" style={{ fontSize: '18px', color: 'var(--text-3)', cursor: 'pointer', background: 'none', border: 'none' }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
