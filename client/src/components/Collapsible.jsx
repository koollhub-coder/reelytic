import React, { useState } from 'react';
import { ChevronDownIcon } from './Icon';

/*
  A section that can fold away. Used sparingly, where a page has a long block
  of secondary detail beside a primary one (a per-report breakdown above a
  creator list, a technical panel under an admin summary). Not for primary
  content: people came for that, so it is never hidden by default.

  The choice is remembered per id in this browser, so a person who folds a
  section keeps it folded next visit. Real button, aria-expanded, keyboard
  friendly.
*/

const key = (id) => `rl-collapse:${id}`;

function read(id, fallback) {
  try {
    const v = localStorage.getItem(key(id));
    return v == null ? fallback : v === '1';
  } catch (e) {
    return fallback;
  }
}

export function Collapsible({ id, title, meta, actions, defaultOpen = true, flush = false, children }) {
  const [open, setOpen] = useState(() => read(id, defaultOpen));
  const toggle = () => {
    setOpen((o) => {
      try { localStorage.setItem(key(id), o ? '0' : '1'); } catch (e) { /* private mode */ }
      return !o;
    });
  };
  return (
    <section className="rl-collapsible" style={flush ? { marginBottom: 0 } : undefined}>
      <div className="rl-collapsible-bar">
        <button type="button" className="rl-collapsible-head" onClick={toggle} aria-expanded={open}>
          <ChevronDownIcon size={16} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 140ms ease' }} />
          <span className="rl-collapsible-title">{title}</span>
          {meta && <span className="rl-collapsible-meta">{meta}</span>}
        </button>
        {actions && <div className="rl-collapsible-actions">{actions}</div>}
      </div>
      {open && <div className="rl-collapsible-body">{children}</div>}
    </section>
  );
}
