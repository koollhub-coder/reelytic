import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreIcon } from './Icon';

/*
  The "..." row-actions menu, shared by every table.

  Why it is rebuilt: the old one drew its list inside the table cell. A cell
  inherits its column's text alignment, so items came out right-aligned with a
  ragged left edge, a table wrapper could clip it, and it opened with a large
  empty gap. This one is portaled to the page (never clipped, never inherits
  alignment), opens under its button, flips upward near the bottom of the
  screen, and uses only theme tokens so it is correct in light and dark.

  items: [{ label, icon?, href?, download?, onClick?, danger?, divider? }]
*/

const MENU_W = 216;

export function RowMenu({ items, label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const height = menuRef.current ? menuRef.current.offsetHeight : 0;
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    const below = r.bottom + 6;
    const flip = height && below + height > window.innerHeight - 8 && r.top - 6 - height > 8;
    setPos({ left, top: flip ? r.top - 6 - height : below });
  }, [open, items]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = (e) => { if (!menuRef.current || !menuRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', () => setOpen(false));
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  if (!items || items.length === 0) return null;

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="rl-rowmenu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreIcon size={16} />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="rl-rowmenu"
          style={{ top: pos ? pos.top : -9999, left: pos ? pos.left : -9999, width: MENU_W, visibility: pos ? 'visible' : 'hidden' }}
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            const body = (
              <>
                {Icon && <Icon size={15} />}
                <span>{item.label}</span>
              </>
            );
            return (
              <React.Fragment key={i}>
                {item.divider && <div className="rl-rowmenu-divider" />}
                {item.href ? (
                  <a role="menuitem" className={`rl-rowmenu-item${item.danger ? ' danger' : ''}`} href={item.href} download={item.download} onClick={close}>{body}</a>
                ) : (
                  <button role="menuitem" type="button" className={`rl-rowmenu-item${item.danger ? ' danger' : ''}`} onClick={() => { close(); item.onClick && item.onClick(); }}>{body}</button>
                )}
              </React.Fragment>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
