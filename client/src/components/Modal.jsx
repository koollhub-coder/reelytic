import React, { useEffect } from 'react';
import { XIcon } from './Icon';
import { Tooltip } from './Tooltip';

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
    // On mobile (see mobile.css .rl-modal-*), this becomes a bottom sheet --
    // full-width, slides up, rounded top corners only -- instead of a small
    // centered card, matching how Stripe/Linear/Notion handle dialogs on a
    // phone screen. Desktop is completely untouched (those rules only exist
    // under the <=768px media query).
    <div className="rl-modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}>
      <div className="card rl-modal-sheet" style={{ width, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }}>
        <div className="rl-modal-handle" style={{ display: 'none' }} aria-hidden="true" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          {/* Explicit color, not inherited: a modal opened from a page that
              scopes its own --text (the report pages do) would otherwise
              inherit body's already-computed global-theme color and render
              near-white text on a light sheet. */}
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
          {/* An SVG, not a "×" character. This button was empty for a while
              because a text pass that stripped emoji from the codebase took
              the glyph with it, leaving every dialog in the app with an
              invisible close control. A component cannot be deleted that way. */}
          <Tooltip content="Close">
            <button
              onClick={onClose}
              aria-label="Close"
              className="rl-modal-close"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '30px', height: '30px', flexShrink: 0, borderRadius: 'var(--r-sm)',
                color: 'var(--text-3)', cursor: 'pointer', background: 'none', border: 'none',
                transition: 'background var(--t-fast), color var(--t-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-3)'; }}
            >
              <XIcon size={17} />
            </button>
          </Tooltip>
        </div>
        {children}
      </div>
    </div>
  );
}
