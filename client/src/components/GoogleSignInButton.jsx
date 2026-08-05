import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useTheme } from '../context/ThemeContext';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

/*
  onGoogle(payload) receives either:
    { credential }        -> a real Google ID token (when VITE_GOOGLE_CLIENT_ID is set)
    { email, name, dummy} -> a simulated sign-in (demo mode, no Google project yet)

  To go live: set VITE_GOOGLE_CLIENT_ID (client) + GOOGLE_CLIENT_ID (server) to the
  same OAuth client id from Google Cloud Console. Nothing else changes.
*/
export function GoogleSignInButton({ onGoogle, label = 'Continue with Google' }) {
  const holderRef = useRef(null);
  const { theme } = useTheme();
  // The page passing us onGoogle re-creates that function on every render,
  // which used to be in this effect's dependency array -- re-running
  // initialize()/renderButton() on every render. Google's own SDK only
  // honors the LAST initialize() call, so the very first rendered button
  // was live for a moment then silently replaced; a click on it before that
  // happened did nothing, which is why it took two clicks after a refresh.
  // A ref keeps the callback fresh without ever re-initializing the SDK.
  const onGoogleRef = useRef(onGoogle);
  onGoogleRef.current = onGoogle;

  // Google's own button API doesn't accept a custom brand color -- only
  // 'outline' (light), 'filled_black', 'filled_blue', deliberately, so the
  // button stays recognizable as genuinely Google's on any site. What it WAS
  // missing: it was hardcoded to the light 'outline' style regardless of the
  // app's theme, so in dark mode it rendered as a stark white box while
  // everything else on the page was black -- that mismatch, not the lack of
  // a pink Google button, is what read as "black and white." Matching
  // ThemeContext's own resolution of 'system' fixes that without touching
  // anything Google-brand-restricted.
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    if (!CLIENT_ID) return;
    const SRC = 'https://accounts.google.com/gsi/client';
    function render() {
      if (!window.google || !holderRef.current) return;
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (resp) => resp && resp.credential && onGoogleRef.current({ credential: resp.credential }),
      });
      holderRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(holderRef.current, {
        theme: isDark ? 'filled_black' : 'outline', size: 'large', width: 320, text: 'continue_with',
      });
    }
    if (window.google) { render(); return; }
    let s = document.querySelector(`script[src="${SRC}"]`);
    if (!s) {
      s = document.createElement('script');
      s.src = SRC; s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
    s.addEventListener('load', render);
    return () => s && s.removeEventListener('load', render);
  }, [isDark]);

  return CLIENT_ID
    ? <div ref={holderRef} style={{ display: 'flex', justifyContent: 'center' }} />
    : <DummyGoogleButton onGoogle={onGoogle} label={label} />;
}

// ---- Dummy mode: no GOOGLE_CLIENT_ID configured yet ----
// Two sequential window.prompt() calls used to stand in for this -- a raw
// native browser dialog, unstyled, un-themeable, and a jarring departure
// from the rest of the app the moment someone hits "Continue with Google"
// before real credentials exist. A proper themed modal (reusing the same
// shared Modal component every other dialog in the app uses, so it also
// gets the mobile bottom-sheet treatment for free) collects the same two
// fields instead.
function DummyGoogleButton({ onGoogle, label }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('demo.google.user@gmail.com');
  const [name, setName] = useState('Demo Agency');

  const handleConfirm = (e) => {
    e.preventDefault();
    if (!email.trim() || name.trim().length < 2) return;
    setOpen(false);
    onGoogle({ email: email.trim(), name: name.trim(), dummy: true });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary"
        style={{ width: '100%', height: '40px', gap: '10px' }}
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
          <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.5 39.6 16.2 44 24 44z" />
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.6l6.3 5.2C41.8 35.9 44 30.4 44 24c0-1.3-.1-2.3-.4-3.5z" />
        </svg>
        {label}
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Demo Google sign-in" width="360px">
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
          No Google account is wired up yet, so this simulates one. Pick any email and name to continue.
        </p>
        <form onSubmit={handleConfirm}>
          <div className="input-group">
            <label className="input-label" htmlFor="dummy-google-email">Email</label>
            <input
              id="dummy-google-email"
              type="email"
              className="input-field"
              style={{ width: '100%' }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="dummy-google-name">Display name</label>
            <input
              id="dummy-google-name"
              type="text"
              className="input-field"
              style={{ width: '100%' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              required
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: 'var(--s4)' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Continue</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
