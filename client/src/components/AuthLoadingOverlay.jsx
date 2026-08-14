import React from 'react';
import { BrandLoader } from './BrandLoader';

/*
  Covers the gap between a sign-in callback firing and the workspace finishing
  its redirect, so the app never sits on a stale screen looking unresponsive
  while the session is being set up.

  Uses the same BrandLoader as every other full-screen wait rather than a bare
  spinner of its own. It used to draw a lone .rl-auth-spinner with no mark and
  no wordmark, so the one moment a new user is most likely to be watching the
  screen was also the only moment the product forgot to say whose product it
  is. Same ring, same logo, same position as the boot splash.
*/
export function AuthLoadingOverlay({ message = 'Signing you in...' }) {
  return <BrandLoader variant="full" message={message} />;
}
