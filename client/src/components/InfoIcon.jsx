import React, { useState, useRef, useEffect } from 'react';

// Hover alone never fires on a touch device -- every info tooltip in the app
// was effectively invisible on mobile before this. A tap now toggles it too,
// with an outside-tap listener to dismiss (hover still works unchanged for
// desktop/mouse users).
export function InfoIcon({ tooltip }) {
  const [show, setShow] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!show) return;
    const handleOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setShow(false);
    };
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('mousedown', handleOutside);
    return () => {
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('mousedown', handleOutside);
    };
  }, [show]);

  return (
    <span
      ref={rootRef}
      style={{ position: 'relative', display: 'inline-block', marginLeft: '4px', cursor: 'pointer' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.stopPropagation(); setShow((v) => !v); }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'var(--border-strong)', fontSize: '10px', color: 'var(--text)', fontWeight: 600 }}>i</span>
      {show && (
        <div style={{ position: 'absolute', bottom: '125%', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 10px', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', maxWidth: '240px', whiteSpace: 'normal', boxShadow: 'var(--shadow)', zIndex: 50 }}>
          {tooltip}
        </div>
      )}
    </span>
  );
}
