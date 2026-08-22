import { ChevronDownIcon } from './Icon';
import React, { useState, useRef, useEffect } from 'react';

// A native <select>'s closed box can be themed with CSS, but its open
// dropdown list is rendered by the OS and ignores our styles entirely --
// that's the "childish" mismatched popup. This replaces it with a fully
// custom, dark-mode-correct dropdown built from plain divs.
export function Select({ value, onChange, options, placeholder = 'Select...', style, className }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const handleKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} className={className} style={{ position: 'relative', ...style }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input-field"
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', cursor: 'pointer' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? 'var(--text)' : 'var(--text-3)' }}>
          {selected ? selected.label : placeholder}
        </span>
        {/* A drawn chevron, not the "▾" glyph.

            That character renders at whatever weight and baseline the user's
            font decides, which is why it looked like a stray speck: tiny,
            misaligned, and thinner than every other stroke on screen. An SVG
            with an explicit stroke width matches the rest of the UI and
            rotates cleanly when the menu opens. */}
        <ChevronDownIcon
          size={14}
          style={{
            color: 'var(--text-2)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--t-fast)',
          }}
        />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
            backgroundColor: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)',
            boxShadow: 'var(--shadow-lg)', padding: '4px', maxHeight: '240px', overflowY: 'auto',
          }}
        >
          {options.map((o) => (
            <div
              key={String(o.value)}
              onClick={() => { onChange(o.value); setOpen(false); }}
              style={{
                padding: '8px 10px', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)',
                backgroundColor: o.value === value ? 'var(--accent-soft)' : 'transparent',
                color: o.value === value ? 'var(--accent)' : 'var(--text)',
                fontWeight: o.value === value ? 600 : 400,
              }}
              onMouseEnter={(e) => { if (o.value !== value) e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { if (o.value !== value) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
