import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { LedgerHero } from '../components/LedgerHero';
import { AccountMenu } from '../components/AccountMenu';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import '../styles/landing.css';

export function Landing() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  return (
    <div className="landing-root">
      <nav className="landing-nav">
        <Logo />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
          <a href="#how-it-works" className="rl-landing-navlink" style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', fontWeight: 500 }}>How it works</a>
          <a href="/pricing" style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', fontWeight: 500 }} onClick={(e) => { e.preventDefault(); navigate('/pricing'); }}>Pricing</a>
          <button onClick={toggleTheme} aria-label="Toggle theme" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {user ? (
            <AccountMenu
              user={user}
              onGoToWorkspace={() => navigate('/reels')}
              onSwitchAccount={() => logout('/login')}
              onLogOut={() => logout()}
            />
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
            Upload your sheet of reels or creator profiles. Reelytic fetches views, likes, comments, and engagement rates, then hands the same sheet back, filled in.
          </p>
          <div className="hero-cta-group">
            {/* Fixed, short label -- account identity/switching lives in the
                nav's avatar menu, not spelled out here, so this button never
                scales with username length. */}
            <button className="btn btn-primary" style={{ height: '44px', padding: '0 var(--s6)', fontSize: 'var(--fs-md)' }} onClick={() => navigate(user ? '/reels' : '/login')}>
              {user ? 'Go to your workspace →' : 'Log in to your workspace'}
            </button>
          </div>
          <div className="hero-caption">
            {user ? (
              <>Signed in. Not you? <button type="button" onClick={() => logout('/login')} className="rl-text-link">Switch account</button></>
            ) : (
              'Accounts are provisioned for agency clients.'
            )}
          </div>
        </div>
        <div>
          <LedgerHero />
        </div>
      </section>

      <div className="landing-section whats-new">
        <div className="whats-new-badge">
          <img src="/logo-mark-128.png" alt="" className="whats-new-logo" />
        </div>
        <div className="hero-eyebrow" style={{ textAlign: 'center' }}>NEW IN REELYTIC</div>
        <h2 className="section-title">Reports your client can act on, not just read</h2>
        <p style={{ textAlign: 'center', color: 'var(--text-2)', maxWidth: '660px', margin: '0 auto var(--s6)' }}>
          Every report leaves your workspace looking like it came from your agency, and now it
          answers the question every client asks next: compared to what?
        </p>
        <div className="features-grid">
          {/* Benchmarks lead. Branding and share links are table stakes any
              competitor can copy in a sprint; a median drawn from every
              campaign the product has ever measured is the one thing that
              cannot be rebuilt without the same history. */}
          <div className="feature-card whats-new-card">
            <div className="feature-title">Benchmarks, not just numbers</div>
            <div className="feature-desc">"2.3% engagement" means nothing on its own. Every report now says how that compares to the typical creator of the same size, measured across every campaign Reelytic has run.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="feature-title">Campaign over campaign</div>
            <div className="feature-desc">Group reports into a campaign and each new one shows what moved since the last: engagement, reach, and roster size, with the direction of travel.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="feature-title">Your branding, on every report</div>
            <div className="feature-desc">Add your logo, accent color, and layout once in Settings. Every report you generate after that uses it automatically, no re-uploading.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="feature-title">Share links that expire</div>
            <div className="feature-desc">Send a client a link straight to their report, with no login. Set it to run out in 24 hours, a week, a month, or never, and switch it off the moment a campaign wraps.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="feature-title">See when it was opened</div>
            <div className="feature-desc">Know whether your client actually looked at the report before the next call. Counts opens, never tracks the person who opened it.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="feature-title">They can take the data with them</div>
            <div className="feature-desc">Clients download the report table as a clean Excel file straight from the link. Just the reporting columns, never your original working sheet.</div>
          </div>
        </div>
      </div>

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
          2,000 reels <span className="time-band-highlight">≈ 45 min</span> vs manual entry <span className="time-band-highlight">≈ 3 days</span>. That's the report your client gets today instead of Thursday.
        </div>
      </div>

      <div className="landing-section">
        <h2 className="section-title">Two report types, one workflow</h2>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-number">🎬</div>
            <h3 className="step-heading">Reel Report</h3>
            <p className="step-desc">Paste any list of reel links and get views, likes, comments, reposts, saves, and engagement rate for each one, side by side.</p>
          </div>
          <div className="step-card">
            <div className="step-number">👤</div>
            <h3 className="step-heading">Profile Report</h3>
            <p className="step-desc">Point it at a creator's profile and get a stable read on their recent performance and follower count, with outliers automatically excluded.</p>
          </div>
        </div>
      </div>

      <div className="landing-section">
        <h2 className="section-title">Built for high-stakes agency reporting</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-title">Auditable Ledger Design</div>
            <div className="feature-desc">Every number, metric, and timestamp is formatted in tabular numerals for a clean, professional read at a glance.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Runs at agency scale</div>
            <div className="feature-desc">Process up to 2,000 links in a single run, with smart caching so repeat links never get charged or fetched twice.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Full Control While It Runs</div>
            <div className="feature-desc">Pause, resume, or download a partial report mid-run. Close your tab safely; the run keeps going on our end.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Clean by default</div>
            <div className="feature-desc">Duplicate and invalid links are flagged clearly in your preview, never silently dropped or miscounted in your export.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Export-ready output</div>
            <div className="feature-desc">Get your original sheet back as a formatted Excel or CSV file, with your columns and structure exactly as you sent them.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Full run history</div>
            <div className="feature-desc">Every report you've generated stays available to revisit or re-download, even after you log out and come back later.</div>
          </div>
        </div>
      </div>

      <div className="time-band">
        <div className="time-band-inner">
          Built for the teams who report to brands every week: talent managers, agency ops, and campaign leads who need numbers they can hand off without a second look.
        </div>
      </div>

      <div className="landing-section" style={{ textAlign: 'center', paddingTop: 'var(--s5)' }}>
        <h2 className="section-title" style={{ marginBottom: 'var(--s4)' }}>Ready to see it on your own sheet?</h2>
        <button className="btn btn-primary" style={{ height: '44px', padding: '0 var(--s7)', fontSize: 'var(--fs-md)' }} onClick={() => navigate(user ? '/reels' : '/login')}>
          {user ? 'Go to your workspace →' : 'Log in to your workspace'}
        </button>
      </div>

      <footer className="landing-footer">
        <div>© {new Date().getFullYear()} Reelytic. All rights reserved.</div>
        <div>Audited Creator Intelligence</div>
      </footer>
    </div>
  );
}