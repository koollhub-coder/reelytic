import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { PasswordInput } from '../components/PasswordInput';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { AuthLoadingOverlay } from '../components/AuthLoadingOverlay';
import { useAuth } from '../context/AuthContext';
import { LedgerHero } from '../components/LedgerHero';

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, googleLogin } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [carouselSlide, setCarouselSlide] = useState(0);

  const reason = searchParams.get('reason');
  const redirectTarget = searchParams.get('redirect') || '/reels';

  const slides = [
    'Turn a sheet of reel links into a full engagement report.',
    'Real metrics and statistical estimates, never mixed.',
    'Pause, resume, and download partway. You\'re in control.'
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setCarouselSlide(prev => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(username, password);
      if (user.mustChangePassword) {
        navigate('/change-password');
      } else {
        navigate(redirectTarget);
      }
    } catch (err) {
      setError(err.message || 'That username and password don\'t match.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async (payload) => {
    setError('');
    setGoogleLoading(true);
    try {
      const user = await googleLogin(payload);
      navigate(user.mustChangePassword ? '/change-password' : redirectTarget);
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
      setGoogleLoading(false);
    }
  };

  if (googleLoading) return <AuthLoadingOverlay />;

  return (
    <div className="rl-login-grid" style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', backgroundColor: 'var(--bg)' }}>
      {/* Left panel (≥960px) */}
      <div style={{ backgroundColor: 'var(--surface-2)', padding: 'var(--s8)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderRight: '1px solid var(--border)' }} className="login-left-panel">
        <div>
          <Logo />
        </div>
        <div style={{ maxWidth: '440px', margin: 'auto 0' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, lineHeight: 1.2, marginBottom: 'var(--s4)' }}>
            {slides[carouselSlide]}
          </div>
          <div style={{ marginTop: 'var(--s6)' }}>
            <LedgerHero />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--s4)' }}>
            {slides.map((_, i) => (
              <div key={i} style={{ width: i === carouselSlide ? '24px' : '8px', height: '8px', borderRadius: '4px', backgroundColor: i === carouselSlide ? 'var(--accent)' : 'var(--border-strong)', transition: 'all 200ms ease' }} />
            ))}
          </div>
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
          © {new Date().getFullYear()} Reelytic · Audited Creator Intelligence
        </div>
      </div>

      {/* Right panel */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--s6)' }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          <div style={{ marginBottom: 'var(--s6)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s1)' }}>Welcome back</h2>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)' }}>Log in to your Reelytic workspace</p>
          </div>

          {reason === 'revoked' && (
            <div className="chip err" style={{ width: '100%', padding: 'var(--s3)', marginBottom: 'var(--s4)', borderRadius: 'var(--r-md)' }}>
              ⚠️ You were signed out by an administrator.
            </div>
          )}

          {error && (
            <div className="chip err" style={{ width: '100%', padding: 'var(--s3)', marginBottom: 'var(--s4)', borderRadius: 'var(--r-md)' }}>
              {error}
            </div>
          )}

          <GoogleSignInButton onGoogle={handleGoogle} label="Continue with Google" />

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', margin: 'var(--s4) 0', color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            OR
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <form onSubmit={handleSubmit}>
            <div className="input-group">
              <label className="input-label" htmlFor="username">Email or username</label>
              <input
                type="text"
                id="username"
                autoComplete="username"
                autoFocus
                className="input-field"
                value={username}
                onChange={e => setUsername(e.target.value)}
                onBlur={e => setUsername(e.target.value.toLowerCase())}
                required
              />
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="password">Password</label>
              <PasswordInput
                id="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '40px', marginTop: 'var(--s3)' }} disabled={loading}>
              {loading ? 'Logging in...' : 'Log in'}
            </button>
          </form>

          <div style={{ marginTop: 'var(--s6)', textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
            New to Reelytic?{' '}
            <a href="/signup" onClick={(e) => { e.preventDefault(); navigate('/signup'); }} style={{ fontWeight: 600 }}>Create a free account</a>
          </div>
        </div>
      </div>
    </div>
  );
}
