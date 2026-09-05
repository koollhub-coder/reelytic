import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { PasswordInput } from '../components/PasswordInput';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { AuthLoadingOverlay } from '../components/AuthLoadingOverlay';
import { useAuth } from '../context/AuthContext';
import { LedgerHero } from '../components/LedgerHero';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { AuthFooterLinks } from '../components/AuthFooterLinks';
import { AuthAlert } from '../components/AuthAlert';

const RESEND_COOLDOWN_SECONDS = 60;

export function Signup() {
  const navigate = useNavigate();
  const { signup, verifyOtp, resendOtp, googleLogin } = useAuth();
  useDocumentMeta({
    title: 'Create your free workspace',
    description: 'Sign up free and turn a sheet of Instagram Reel or profile links into a client-ready engagement report. 10 credits included, no card required.',
    path: '/signup',
    noindex: true,
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Google accounts skip this entirely (already verified by Google, see
  // auth.routes.js) -- only a local-password signup ever reaches 'otp'.
  const [step, setStep] = useState('form'); // 'form' | 'otp'
  const [pendingUsername, setPendingUsername] = useState('');
  const [code, setCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef(null);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  useEffect(() => {
    if (step === 'otp') codeInputRef.current?.focus();
  }, [step]);

  // Every field below also carries required/pattern/minLength attributes,
  // which is exactly the problem: those trigger the BROWSER's own native
  // validation bubble on submit (see the noValidate on both forms below),
  // and that bubble is unstyled OS chrome -- white background, system font,
  // orange icon -- next to a dark, pink-accented app. Checking the same
  // rules here, before the native validator ever gets a chance to run,
  // means every validation message a user sees comes from this app's own
  // .chip.err banner instead, in one place, in the app's own voice.
  const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validateForm = () => {
    if (!name) return 'Enter a username.';
    if (!USERNAME_RE.test(name)) return 'Username must be 3-32 characters: letters, numbers, dots, dashes or underscores.';
    if (!email) return 'Enter your work email.';
    if (!EMAIL_RE.test(email)) return 'Enter a valid email address.';
    if (!password) return 'Enter a password.';
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (!acceptedTerms) return 'You must agree to the Terms of Service and Privacy Policy to create an account.';
    return '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setErrorCode('');
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading(true);
    try {
      const data = await signup({ email, password, username: name, acceptedTerms });
      setPendingUsername(data.username);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setStep('otp');
    } catch (err) {
      setError(err.message || 'Could not create your account.');
      setErrorCode(err.code || '');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code.');
      return;
    }
    setOtpLoading(true);
    try {
      await verifyOtp(pendingUsername, code);
      navigate('/reels');
    } catch (err) {
      setError(err.message || 'Could not verify that code.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError('');
    try {
      await resendOtp(pendingUsername);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err.message || 'Could not resend the code.');
    }
  };

  const handleGoogle = async (payload) => {
    setError('');
    setGoogleLoading(true);
    try {
      await googleLogin(payload);
      navigate('/reels');
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
      setGoogleLoading(false);
    }
  };

  if (googleLoading) return <AuthLoadingOverlay />;

  return (
    <div className="rl-login-grid" style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', backgroundColor: 'var(--bg)' }}>
      {/* Left marketing panel (hidden on mobile). See Login.jsx for why this
          uses a flex:1 centered middle block instead of margin:auto -- the
          auto-margin version let the gap under the logo collapse on a
          shorter window. */}
      <div style={{ backgroundColor: 'var(--surface-2)', padding: 'var(--s8)', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }} className="login-left-panel">
        <div style={{ flexShrink: 0 }}><Logo /></div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 'var(--s7)', paddingBottom: 'var(--s7)' }}>
          <div style={{ maxWidth: '440px' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, lineHeight: 1.2, marginBottom: 'var(--s4)' }}>
              Start free. 10 credits on the house.
            </div>
            <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s6)' }}>
              Turn a sheet of reel links into a full engagement report, no card required to try it.
            </p>
            <LedgerHero />
          </div>
        </div>
        <div style={{ flexShrink: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
          © {new Date().getFullYear()} Reelytic · Audited Creator Intelligence
        </div>
      </div>

      {/* Right form panel. Mobile-only logo -- the left panel (the only
          place Logo otherwise appears on this page) is hidden entirely on
          mobile, which left this side with zero Reelytic branding. */}
      <div className="rl-auth-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--s6)' }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          <div className="rl-mobile-only" style={{ justifyContent: 'center', marginBottom: 'var(--s6)' }}>
            <Logo />
          </div>
          {error && (
            <AuthAlert
              action={errorCode === 'GOOGLE_ACCOUNT' ? { label: 'Log in instead', onClick: () => navigate('/login') } : null}
            >
              {error}
            </AuthAlert>
          )}

          {step === 'form' ? (
            <>
              <div style={{ marginBottom: 'var(--s6)' }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s1)' }}>Create your workspace</h2>
                <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)' }}>Free tier includes 10 credits to start.</p>
              </div>

              <GoogleSignInButton onGoogle={handleGoogle} label="Sign up with Google" />

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', margin: 'var(--s4) 0', color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                OR
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              <form onSubmit={handleSubmit} noValidate>
                {/* Asked for directly rather than being derived from the email.
                    This is the name shown throughout the workspace, so defaulting
                    it to the address is what left accounts displaying
                    "someone@gmail.com" in the sidebar. */}
                <div className="input-group">
                  <label className="input-label" htmlFor="username">Username</label>
                  <input
                    type="text"
                    id="username"
                    className="input-field"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. kapoormedia"
                    required
                    minLength={3}
                    maxLength={32}
                    autoComplete="username"
                    pattern="[-A-Za-z0-9._]{3,32}"
                    title="3-32 characters: letters, numbers, dots, dashes or underscores"
                  />
                  <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: '6px' }}>
                    This is how your name appears across Reelytic. You can change it later in Settings.
                  </p>
                </div>
                <div className="input-group">
                  <label className="input-label" htmlFor="email">Work email</label>
                  <input type="email" id="email" autoComplete="email" className="input-field" value={email} onChange={e => setEmail(e.target.value)} required />
                </div>
                <div className="input-group">
                  <label className="input-label" htmlFor="password">Password</label>
                  <PasswordInput id="password" value={password} onChange={e => setPassword(e.target.value)} showStrength={true} autoComplete="new-password" />
                </div>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: 'var(--fs-sm)', color: 'var(--text-2)', cursor: 'pointer', marginBottom: 'var(--s3)' }}>
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => setAcceptedTerms(e.target.checked)}
                    style={{ width: '16px', height: '16px', marginTop: '2px', flexShrink: 0, accentColor: 'var(--accent)' }}
                  />
                  <span>
                    I agree to the{' '}
                    <a href="/terms" target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>Terms of Service</a>
                    {' '}and{' '}
                    <a href="/privacy" target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>Privacy Policy</a>.
                  </span>
                </label>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '40px' }} disabled={loading || !acceptedTerms}>
                  {loading ? 'Creating account...' : 'Create free account'}
                </button>
              </form>

              <div style={{ marginTop: 'var(--s5)', textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
                Already have an account?{' '}
                <a href="/login" onClick={(e) => { e.preventDefault(); navigate('/login'); }} style={{ fontWeight: 600 }}>Log in</a>
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 'var(--s6)' }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s1)' }}>Check your email</h2>
                <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)' }}>
                  We sent a 6-digit code to <strong style={{ color: 'var(--text)' }}>{email}</strong>. Enter it below to finish creating your workspace.
                </p>
              </div>

              <form onSubmit={handleVerify} noValidate>
                <div className="input-group">
                  <label className="input-label" htmlFor="otp-code">Verification code</label>
                  <input
                    ref={codeInputRef}
                    type="text"
                    inputMode="numeric"
                    id="otp-code"
                    className="input-field mono"
                    style={{ fontSize: 'var(--fs-xl)', letterSpacing: '0.4em', textAlign: 'center' }}
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    required
                    maxLength={6}
                    pattern="[0-9]{6}"
                    autoComplete="one-time-code"
                    autoFocus
                  />
                  <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: '6px' }}>
                    Code expires in 10 minutes.
                  </p>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '40px', marginTop: 'var(--s3)' }} disabled={otpLoading || code.length !== 6}>
                  {otpLoading ? 'Verifying...' : 'Verify and continue'}
                </button>
              </form>

              <div style={{ marginTop: 'var(--s5)', textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
                Didn't get it?{' '}
                {resendCooldown > 0 ? (
                  <span style={{ color: 'var(--text-3)' }}>Resend in {resendCooldown}s</span>
                ) : (
                  <button type="button" onClick={handleResend} className="rl-text-link" style={{ fontWeight: 600 }}>Resend code</button>
                )}
              </div>
              <div style={{ marginTop: 'var(--s3)', textAlign: 'center', fontSize: 'var(--fs-sm)' }}>
                <button type="button" onClick={() => { setStep('form'); setError(''); setCode(''); }} className="rl-text-link">← Use a different email</button>
              </div>
            </>
          )}
          <AuthFooterLinks />
        </div>
      </div>
    </div>
  );
}
