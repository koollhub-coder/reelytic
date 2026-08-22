import React from 'react';

/*
  Small "Terms · Privacy" row shared by every auth page (Login, Signup,
  Forgot Password) so those documents stay reachable without having to go
  back through the signup checkbox to find them -- the pattern most SaaS
  login/signup screens already use. Kept as its own tiny component rather
  than copy-pasted three times so the wording/spacing can't drift between
  pages.
*/
export function AuthFooterLinks() {
  return (
    <div style={{ marginTop: 'var(--s6)', textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
      <a href="/terms" target="_blank" rel="noreferrer" style={{ color: 'var(--text-3)' }}>Terms</a>
      {' · '}
      <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: 'var(--text-3)' }}>Privacy</a>
    </div>
  );
}
