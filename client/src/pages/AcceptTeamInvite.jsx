import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { PasswordInput } from '../components/PasswordInput';
import { BrandLoader } from '../components/BrandLoader';
import { useAuth } from '../context/AuthContext';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { UserPlusIcon } from '../components/Icon';
import { AuthAlert } from '../components/AuthAlert';
import { apiFetch } from '../api/client';

// The public "you've been invited" page a teammate lands on from the email
// team.routes.js sends -- same shape as ResetPassword.jsx (check the token
// first, show the form only once it's confirmed valid).
export function AcceptTeamInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { acceptTeamInvite } = useAuth();
  const token = searchParams.get('t') || '';

  useDocumentMeta({ title: 'Join your team on Reelytic', path: '/team/accept', noindex: true });

  const [checking, setChecking] = useState(true);
  const [invite, setInvite] = useState(null);
  const [tokenError, setTokenError] = useState('');

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    if (!token) {
      setChecking(false);
      setTokenError('This invite link is missing its token. Ask whoever invited you to send a new one.');
      return undefined;
    }
    apiFetch(`/team/invite/${encodeURIComponent(token)}`)
      .then((res) => { if (alive) setInvite(res); })
      .catch((err) => { if (alive) setTokenError(err.message || 'This invite is invalid or has expired.'); })
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
    setLoading(true);
    try {
      await acceptTeamInvite(token, { name, username, password });
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Could not accept this invite.');
    } finally {
      setLoading(false);
    }
  };

  if (checking) return <BrandLoader variant="full" message="Checking your invite..." />;

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
          <UserPlusIcon size={26} style={{ color: 'var(--accent)' }} />
        </div>

        {!invite ? (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
              Invite invalid or expired
            </h2>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)', marginBottom: 'var(--s5)' }}>{tokenError}</p>
            <button type="button" className="btn btn-primary" style={{ width: '100%', height: '44px' }} onClick={() => navigate('/login')}>
              Go to login
            </button>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 'var(--s6)' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
                Join {invite.ownerName}'s team
              </h2>
              <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)' }}>
                Set a username and password for <strong style={{ color: 'var(--text)' }}>{invite.email}</strong> to get in.
              </p>
            </div>

            {error && <AuthAlert>{error}</AuthAlert>}

            <form onSubmit={submit} noValidate>
              <div className="input-group">
                <label className="input-label" htmlFor="invite-name">Your name</label>
                <input
                  id="invite-name"
                  type="text"
                  className="input-field"
                  style={{ width: '100%' }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                />
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="invite-username">Username</label>
                <input
                  id="invite-username"
                  type="text"
                  className="input-field"
                  style={{ width: '100%' }}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="How you'll appear in the app"
                  maxLength={32}
                />
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="invite-password">Password</label>
                <PasswordInput id="invite-password" value={password} onChange={(e) => setPassword(e.target.value)} showStrength autoComplete="new-password" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '44px', marginTop: 'var(--s2)' }} disabled={loading}>
                {loading ? 'Joining...' : 'Join the team'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
