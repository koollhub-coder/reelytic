import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { PasswordInput } from '../components/PasswordInput';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { useAuth } from '../context/AuthContext';
import { LedgerHero } from '../components/LedgerHero';

export function Signup() {
  const navigate = useNavigate();
  const { signup, googleLogin } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signup({ email, password, name });
      navigate('/reels');
    } catch (err) {
      setError(err.message || 'Could not create your account.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async (payload) => {
    setError('');
    try {
      await googleLogin(payload);
      navigate('/reels');
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
    }
  };

  return (
    <div className="rl-login-grid" style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', backgroundColor: 'var(--bg)' }}>
      {/* Left marketing panel (hidden on mobile) */}
      <div style={{ backgroundColor: 'var(--surface-2)', padding: 'var(--s8)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderRight: '1px solid var(--border)' }} className="login-left-panel">
        <div><Logo /></div>
        <div style={{ maxWidth: '440px', margin: 'auto 0' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, lineHeight: 1.2, marginBottom: 'var(--s4)' }}>
            Start free. 10 credits on the house.
          </div>
          <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s6)' }}>
            Turn a sheet of reel links into a full engagement report — no card required to try it.
          </p>
          <LedgerHero />
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
          © 2026 Reelytic · Audited Creator Intelligence
        </div>
      </div>

      {/* Right form panel */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--s6)' }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          <div style={{ marginBottom: 'var(--s6)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s1)' }}>Create your workspace</h2>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)' }}>Free tier includes 10 credits to start.</p>
          </div>

          {error && (
            <div className="chip err" style={{ width: '100%', padding: 'var(--s3)', marginBottom: 'var(--s4)', borderRadius: 'var(--r-md)' }}>
              {error}
            </div>
          )}

          <GoogleSignInButton onGoogle={handleGoogle} label="Sign up with Google" />

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', margin: 'var(--s4) 0', color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            OR
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="input-group">
              <label className="input-label" htmlFor="name">Name or agency name</label>
              <input type="text" id="name" className="input-field" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kapoor Media" required minLength={2} />
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="email">Work email</label>
              <input type="email" id="email" autoComplete="email" className="input-field" value={email} onChange={e => setEmail(e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="password">Password</label>
              <PasswordInput id="password" value={password} onChange={e => setPassword(e.target.value)} showStrength={true} autoComplete="new-password" />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '40px', marginTop: 'var(--s3)' }} disabled={loading}>
              {loading ? 'Creating account…' : 'Create free account'}
            </button>
          </form>

          <div style={{ marginTop: 'var(--s5)', textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
            Already have an account?{' '}
            <a href="/login" onClick={(e) => { e.preventDefault(); navigate('/login'); }} style={{ fontWeight: 600 }}>Log in</a>
          </div>
        </div>
      </div>
    </div>
  );
}
