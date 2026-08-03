import React from 'react';

// Covers the gap between a sign-in callback firing and the workspace
// finishing its redirect, so the app never sits on a stale screen looking
// unresponsive while the session is being set up.
export function AuthLoadingOverlay({ message = 'Signing you in...' }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--s4)',
        backgroundColor: 'var(--bg)',
      }}
    >
      <div className="rl-auth-spinner" />
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', fontWeight: 500 }}>{message}</div>
    </div>
  );
}
