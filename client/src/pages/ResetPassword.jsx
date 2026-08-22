import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { PasswordInput } from '../components/PasswordInput';
import { BrandLoader } from '../components/BrandLoader';
import { useAuth } from '../context/AuthContext';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { LockIcon } from '../components/Icon';

export function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { resetPassword, checkResetToken } = useAuth();
  const token = searchParams.get('token') || '';

  useDocumentMeta({ title: 'Set a new password', path: '/reset-password', noindex: true });

  const [checking, setChecking] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [tokenError, setTokenError] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setChecking(false);
      setTokenError('This reset link is missing its token. Request a new one from the login page.');
      return undefined;
    }
    checkResetToken(token)
      .then(() => { if (alive) setTokenValid(true); })
      .catch((err) => { if (alive) setTokenError(err.message || 'This reset link is invalid or has expired.'); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login?reason=password-reset'), 1500);
    } catch (err) {
      setError(err.message || 'Could not reset your password.');
    } finally {
      setLoading(false);
    }
  };

  if (checking) return <BrandLoader variant="full" message="Checking your link..." />;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg)', padding: 'var(--s6)' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s6)' }}>
          <Logo />
        </div>

        <div style={{
          width: '64px', height: '64px', borderRadius: '50%', margin: '0 auto var(--s5) auto',
          backgroundColor: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <LockIcon size={26} style={{ color: 'var(--accent)' }} />
        </div>

        {!tokenValid ? (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
              Link invalid or expired
            </h2>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)', marginBottom: 'var(--s5)' }}>{tokenError}</p>
            <button type="button" className="btn btn-primary" style={{ width: '100%', height: '44px' }} onClick={() => navigate('/forgot-password')}>
              Request a new link
            </button>
          </div>
        ) : done ? (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
              Password updated
            </h2>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)' }}>Taking you to login...</p>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 'var(--s6)' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
                Set a new password
              </h2>
              <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)' }}>
                Choose a new password for your Reelytic account.
              </p>
            </div>

            {error && (
              <div className="chip err" style={{ width: '100%', padding: 'var(--s3)', marginBottom: 'var(--s4)', borderRadius: 'var(--r-md)' }}>
                {error}
              </div>
            )}

            <form onSubmit={submit} noValidate>
              <div className="input-group">
                <label className="input-label" htmlFor="new-password">New password</label>
                <PasswordInput id="new-password" value={password} onChange={(e) => setPassword(e.target.value)} showStrength autoComplete="new-password" />
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="confirm-password">Confirm password</label>
                <PasswordInput id="confirm-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '44px', marginTop: 'var(--s2)' }} disabled={loading}>
                {loading ? 'Saving...' : 'Reset password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
