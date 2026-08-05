import React, { useState } from 'react';

// Shared logged-in identity control for top navs (Landing, Pricing, ...):
// one fixed-size avatar, account details/switching live in a dropdown, not
// spelled out inline. Nothing here scales with name/email length, so there's
// no "long email forces the row wider than the screen" case to repeat on
// every page that shows a nav.
export function AccountMenu({ user, onGoToWorkspace, onSwitchAccount, onLogOut }) {
  const [open, setOpen] = useState(false);
  const initial = (user.name || user.username || '?').charAt(0).toUpperCase();

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
          color: '#fff', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-display)',
        }}
      >
        {initial}
      </button>
      {open && (
        // Fixed width, not just a minWidth floor -- a position:absolute box
        // sized only by minWidth still shrink-to-fits around its widest
        // content (the email row) when nothing bounds the other side, which
        // would silently defeat that row's own ellipsis on a long address.
        <div style={{
          position: 'absolute', top: 'calc(100% + 10px)', right: 0, width: '220px', maxWidth: 'calc(100vw - 32px)',
          backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
          boxShadow: 'var(--shadow-lg)', padding: 'var(--s2)', zIndex: 200,
        }}>
          <div style={{
            padding: '6px var(--s3) var(--s2)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            Signed in as {user.email || user.username}
          </div>
          <button
            onClick={() => { setOpen(false); onGoToWorkspace(); }}
            style={{ width: '100%', padding: '8px var(--s3)', textAlign: 'left', borderRadius: 'var(--r-sm)', color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
          >
            Go to workspace
          </button>
          <button
            onClick={() => { setOpen(false); onSwitchAccount(); }}
            style={{ width: '100%', padding: '8px var(--s3)', textAlign: 'left', borderRadius: 'var(--r-sm)', color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
          >
            Switch account
          </button>
          <button
            onClick={() => { setOpen(false); onLogOut(); }}
            style={{ width: '100%', padding: '8px var(--s3)', textAlign: 'left', borderRadius: 'var(--r-sm)', color: 'var(--err)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
