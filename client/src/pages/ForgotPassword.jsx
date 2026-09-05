import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { WorkspaceOverviewCard } from '../components/WorkspaceOverviewCard';
import { useAuth } from '../context/AuthContext';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { LockIcon, MailIcon, ArrowLeftIcon, ShieldIcon, ZapIcon, SuccessIcon } from '../components/Icon';
import { AuthFooterLinks } from '../components/AuthFooterLinks';
import { AuthAlert } from '../components/AuthAlert';

const RESEND_COOLDOWN_SECONDS = 60;

const TRUST_ITEMS = [
  { icon: ShieldIcon, title: 'Secure & private', desc: 'Your data is always protected.' },
  { icon: ZapIcon, title: 'Quick recovery', desc: 'Reset in a few simple steps.' },
  { icon: SuccessIcon, title: 'Back to insights', desc: 'Jump right back into your reports.' },
];

export function ForgotPassword() {
  const navigate = useNavigate();
  const { forgotPassword } = useAuth();
  useDocumentMeta({
    title: 'Reset your password',
    description: 'Reset your Reelytic account password.',
    path: '/forgot-password',
    noindex: true,
  });

  const [email, setEmail] = useState('');
  const [step, setStep] = useState('form'); // 'form' | 'sent'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return undefined;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!EMAIL_RE.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(email);
      setStep('sent');
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err.message || 'Could not send the reset email.');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (resendCooldown > 0) return;
    setError('');
    try {
      await forgotPassword(email);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err.message || 'Could not resend the reset email.');
    }
  };

  return (
    <div className="rl-login-grid" style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr', backgroundColor: 'var(--bg)' }}>
      {/* Left marketing panel -- same structural shell as Login/Signup
          (flex column, flex-shrink:0 header/footer, flexed middle block) so
          all three auth pages read as one family, not three different
          layouts. Content swaps: WorkspaceOverviewCard + a 3-item trust row
          in place of LedgerHero + the slide carousel, to match this page's
          own reference design. */}
      <div style={{ backgroundColor: 'var(--surface-2)', padding: 'var(--s8)', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }} className="login-left-panel">
        <div style={{ flexShrink: 0 }}><Logo /></div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 'var(--s7)', paddingBottom: 'var(--s7)' }}>
          <div style={{ maxWidth: '460px' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, lineHeight: 1.2, marginBottom: 'var(--s3)' }}>
              Get back to what <span style={{ color: 'var(--accent)' }}>matters.</span>
            </div>
            <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s6)' }}>
              Reset your password and return to your workspace in seconds.
            </p>
            <WorkspaceOverviewCard />
            <div className="rl-stack-mobile" style={{ display: 'flex', gap: 'var(--s5)', marginTop: 'var(--s6)' }}>
              {TRUST_ITEMS.map(({ icon: ItemIcon, title, desc }) => (
                <div key={title} style={{ flex: 1, display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                    backgroundColor: 'var(--accent-soft)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <ItemIcon size={15} />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, marginBottom: '2px' }}>{title}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', lineHeight: 1.4 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ flexShrink: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
          © {new Date().getFullYear()} Reelytic · Audited Creator Intelligence
        </div>
      </div>

      {/* Right panel. */}
      <div className="rl-auth-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--s6)' }}>
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <div className="rl-mobile-only" style={{ justifyContent: 'center', marginBottom: 'var(--s6)' }}>
            <Logo />
          </div>

          <div style={{
            width: '64px', height: '64px', borderRadius: '50%', margin: '0 auto var(--s5) auto',
            backgroundColor: 'var(--accent-soft)', border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <LockIcon size={26} style={{ color: 'var(--accent)' }} />
          </div>

          {step === 'form' ? (
            <>
              <div style={{ textAlign: 'center', marginBottom: 'var(--s6)' }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
                  Forgot your password?
                </h2>
                <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)' }}>
                  No worries. Enter your work email address and we'll send you a link to reset your password.
                </p>
              </div>

              {error && <AuthAlert>{error}</AuthAlert>}

              <form onSubmit={submit} noValidate>
                <div className="input-group">
                  <label className="input-label" htmlFor="email">Work email</label>
                  <div style={{ position: 'relative', width: '100%' }}>
                    <MailIcon size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }} />
                    <input
                      type="email"
                      id="email"
                      autoComplete="email"
                      autoFocus
                      className="input-field"
                      style={{ width: '100%', paddingLeft: '36px' }}
                      placeholder="name@agency.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '44px', marginTop: 'var(--s2)' }} disabled={loading}>
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', margin: 'var(--s5) 0', color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                OR
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              <button
                type="button"
                onClick={() => navigate('/login')}
                className="btn btn-secondary"
                style={{ width: '100%', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <ArrowLeftIcon size={15} />
                Back to sign in
              </button>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: 'var(--s6)' }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
                  Check your email
                </h2>
                <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)' }}>
                  If an account exists for <strong style={{ color: 'var(--text)' }}>{email}</strong>, a reset link is on its way.
                </p>
              </div>

              {error && <AuthAlert>{error}</AuthAlert>}

              <button
                type="button"
                onClick={() => navigate('/login')}
                className="btn btn-secondary"
                style={{ width: '100%', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <ArrowLeftIcon size={15} />
                Back to sign in
              </button>

              <div style={{ marginTop: 'var(--s4)', textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
                Didn't get it?{' '}
                {resendCooldown > 0 ? (
                  <span style={{ color: 'var(--text-3)' }}>Resend in {resendCooldown}s</span>
                ) : (
                  <button type="button" onClick={resend} className="rl-text-link" style={{ fontWeight: 600 }}>Resend</button>
                )}
              </div>
            </>
          )}

          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: 'var(--s6)',
            padding: 'var(--s3)', borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
            fontSize: 'var(--fs-xs)', color: 'var(--text-3)',
          }}>
            <LockIcon size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>If you don't see the email, check your spam folder or try again after a few minutes.</span>
          </div>

          <div style={{ marginTop: 'var(--s5)', textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
            Still having trouble?{' '}
            <a href="mailto:support@reelytic.com" style={{ fontWeight: 600 }}>Contact support</a>
          </div>
          <AuthFooterLinks />
        </div>
      </div>
    </div>
  );
}
