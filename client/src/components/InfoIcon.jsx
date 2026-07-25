import React, { useState } from 'react';

export function InfoIcon({ tooltip }) {
  const [show, setShow] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block', marginLeft: '4px', cursor: 'pointer' }} onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'var(--border-strong)', fontSize: '10px', color: 'var(--text)', fontWeight: 600 }}>i</span>
      {show && (
        <div style={{ position: 'absolute', bottom: '125%', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 10px', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap', boxShadow: 'var(--shadow)', zIndex: 50 }}>
          {tooltip}
        </div>
      )}
    </span>
  );
}
