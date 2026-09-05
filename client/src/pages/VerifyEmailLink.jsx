import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { BrandLoader } from '../components/BrandLoader';
import { useAuth } from '../context/AuthContext';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { AuthAlert } from '../components/AuthAlert';

/*
  Landing page for the "Verify email" button in the OTP email -- the link
  itself points here (a plain GET to an HTML page has no side effect), and
  THIS page makes the actual POST verification call once it mounts. That
  split is deliberate: an email security scanner that prefetches/crawls
  links in an inbox (common, especially on corporate mail) would otherwise
  silently burn the one-shot token before the real person ever opens the
  email. See auth.routes.js's POST /verify-otp-link for the other half.
*/
// Module-scoped, not a component ref -- a ref resets on the synthetic
// unmount+remount React 18 StrictMode performs in development (exactly the
// scenario that surfaced this: a useRef guard here still let the same
// token fire more than once, since remounting hands the component a brand
// new ref). A module-level Set survives that because the module itself
// isn't re-evaluated on remount, only the component function is.
const submittedTokens = new Set();

export function VerifyEmailLink() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { verifyOtpLink, refreshUser } = useAuth();
  const username = searchParams.get('u') || '';
  const token = searchParams.get('t') || '';

  useDocumentMeta({ title: 'Verifying your email', path: '/verify-email', noindex: true });

  const [status, setStatus] = useState('verifying'); // verifying | error

  const [error, setError] = useState('');

  useEffect(() => {
    if (!username || !token) {
      setStatus('error');
      setError('This verification link is missing some information. Use the code from the same email instead, or request a new one.');
      return;
    }

    // Dev-mode double-invoke guard (see submittedTokens above) -- if this
    // exact token already has a request in flight or done, don't fire a
    // second one. Real double-clicks/prefetches from an email client still
    // reach the server and are handled by the catch block below, since
    // those arrive as a genuinely separate call this guard can't see.
    if (submittedTokens.has(token)) return undefined;
    submittedTokens.add(token);

    verifyOtpLink(username, token)
      .then(() => navigate('/reels', { replace: true }))
      .catch((err) => {
        // The one failure mode that isn't really a failure: the account is
        // already verified because an earlier request for this same token
        // already succeeded (a StrictMode double-invoke, a duplicate tab, an
        // email client prefetching the link). If that already left a real
        // session behind, this is success, just arriving the second time --
        // finish the same way the first call would have.
        if (/already verified/i.test(err.message || '')) {
          refreshUser().then(() => navigate('/reels', { replace: true }));
          return;
        }
        setStatus('error');
        setError(err.message || 'This verification link is invalid or has expired.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, token]);

  if (status === 'verifying') return <BrandLoader variant="full" message="Verifying your email..." />;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg)', padding: 'var(--s6)' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s6)' }}>
          <Logo />
        </div>
        <AuthAlert>{error}</AuthAlert>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)', marginTop: 'var(--s2)' }}>
          <button type="button" className="btn btn-primary" style={{ width: '100%', height: '40px' }} onClick={() => navigate('/signup')}>
            Back to sign up
          </button>
          <div style={{ textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
            Already verified?{' '}
            <a href="/login" onClick={(e) => { e.preventDefault(); navigate('/login'); }} style={{ fontWeight: 600 }}>Log in</a>
          </div>
        </div>
      </div>
    </div>
  );
}
