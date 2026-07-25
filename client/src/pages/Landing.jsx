import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { LedgerHero } from '../components/LedgerHero';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import '../styles/landing.css';

export function Landing() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user } = useAuth();

  return (
    <div className="landing-root">
      <nav className="landing-nav">
        <Logo />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
          <a href="#how-it-works" className="rl-landing-navlink" style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', fontWeight: 500 }}>How it works</a>
          <a href="/pricing" className="rl-landing-navlink" style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', fontWeight: 500 }} onClick={(e) => { e.preventDefault(); navigate('/pricing'); }}>Pricing</a>
          <button onClick={toggleTheme} aria-label="Toggle theme" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {user ? (
            <button className="btn btn-primary" onClick={() => navigate('/reels')} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.25)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'var(--fs-xs)', fontWeight: 700,
              }}>
                {(user.username || '?')[0].toUpperCase()}
              </span>
              {user.username}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate('/login')}>
              Log in
            </button>
          )}
        </div>
      </nav>

      <section className="landing-hero">
        <div>
          <div className="hero-eyebrow">FOR INFLUENCER-MARKETING AGENCIES</div>
          <h1 className="hero-title">Campaign reports in minutes, not workdays.</h1>
          <p className="hero-sub">
            Upload your sheet of reels or creator profiles. Reelytic fetches views, likes, comments and engagement rates — and hands the same sheet back, filled in.
          </p>
          <div className="hero-cta-group">
            <button className="btn btn-primary" style={{ height: '44px', padding: '0 var(--s6)', fontSize: 'var(--fs-md)' }} onClick={() => navigate(user ? '/reels' : '/login')}>
              {user ? `Continue as ${user.username}` : 'Log in to your workspace'}
            </button>
          </div>
          <div className="hero-caption">{user ? '' : 'Accounts are provisioned for agency clients.'}</div>
        </div>
        <div>
          <LedgerHero />
        </div>
      </section>

      <div id="how-it-works" className="landing-section">
        <h2 className="section-title">How Reelytic works</h2>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-number">01</div>
            <h3 className="step-heading">Upload your sheet</h3>
            <p className="step-desc">Drop your Excel, CSV or paste reel links. Your original columns and formatting are never touched.</p>
          </div>
          <div className="step-card">
            <div className="step-number">02</div>
            <h3 className="step-heading">We fetch the numbers</h3>
            <p className="step-desc">Live progress, pause anytime, up to 2,000 links per run with smart caching for repeat links.</p>
          </div>
          <div className="step-card">
            <div className="step-number">03</div>
            <h3 className="step-heading">Download it back</h3>
            <p className="step-desc">Get your original sheet back with professional Reelytic metric columns appended in Excel or CSV.</p>
          </div>
        </div>
      </div>

      <div className="time-band">
        <div className="time-band-inner">
          2,000 reels <span className="time-band-highlight">≈ 45 min</span> vs Manual entry <span className="time-band-highlight">≈ 3 days</span>. That's the report your client gets today instead of Thursday.
        </div>
      </div>

      <div className="landing-section">
        <h2 className="section-title">Built for high-stakes agency reporting</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-title">Auditable Ledger Design</div>
            <div className="feature-desc">Every number, metric, and timestamp is formatted in JetBrains Mono with tabular numerals for absolute transparency.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Hidden Likes Honesty Rule</div>
            <div className="feature-desc">Hidden likes on Instagram are clearly labelled as estimates, never contaminating real data or client exports.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Live Job Control</div>
            <div className="feature-desc">Pause, resume, or download partial reports mid-run. Close your tab safely — the server keeps running.</div>
          </div>
        </div>
      </div>

      <footer className="landing-footer">
        <div>© 2026 Reelytic. All rights reserved.</div>
        <div>Audited Creator Intelligence</div>
      </footer>
    </div>
  );
}