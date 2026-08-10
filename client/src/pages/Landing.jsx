import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { ReportHero } from '../components/ReportHero';
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
          <h1 className="hero-title">Turn a sheet of Instagram links into a client-ready report.</h1>
          <p className="hero-sub">
            Upload the campaign sheet you already keep. Every view, like, comment and engagement rate comes back filled in and branded as yours, so your team reports on more clients without adding a single person to do it.
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
          <ReportHero />
        </div>
      </section>

      <div className="landing-section whats-new">
        <div className="whats-new-badge">
          <img src="/logo-mark-128.png" alt="" className="whats-new-logo" />
        </div>
        <div className="hero-eyebrow" style={{ textAlign: 'center' }}>NEW IN REELYTIC</div>
        <h2 className="section-title">Everything a client report needs, already handled</h2>
        <p style={{ textAlign: 'center', color: 'var(--text-2)', maxWidth: '660px', margin: '0 auto var(--s6)' }}>
          {/* True again: the Reelytic credit has been taken off the report
              footer, so the claim and the artefact now agree. An agency
              forwarding this to a brand should not have to explain who we
              are, and some of them would simply not send it if they did. */}
          Your logo, your colours, your layout on every page. Our name appears nowhere on
          the report your client receives.
        </p>
        <div className="features-grid">
          <div className="feature-card whats-new-card">
            <div className="feature-title">Campaign over campaign</div>
            <div className="feature-desc">Put a campaign's reports together and every new one shows what changed since the last: engagement, reach and how many creators you ran.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="feature-title">Your branding, on every report</div>
            <div className="feature-desc">Add your logo, accent color, and layout once in Settings. Every report you generate after that uses it automatically, no re-uploading.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="feature-title">Share links that expire</div>
            <div className="feature-desc">Send your client a link to their report. No login, no attachment. Set it to close after a day, a week or a month, and switch it off the moment the campaign ends.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="feature-title">See when it was opened</div>
            <div className="feature-desc">Walk into the next call knowing whether they read it. We count how many times the link was opened, never who opened it.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="feature-title">They can take the data with them</div>
            <div className="feature-desc">Your client can save the numbers as an Excel file straight from the link. Just the report, never your working sheet.</div>
          </div>
        </div>
      </div>

      <div id="how-it-works" className="landing-section">
        <h2 className="section-title">How Reelytic works</h2>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-number">01</div>
            <h3 className="step-heading">Upload your sheet</h3>
            <p className="step-desc">Drop in an Excel or CSV file, or paste the links straight in. Your own columns stay exactly where you put them.</p>
          </div>
          <div className="step-card">
            <div className="step-number">02</div>
            <h3 className="step-heading">We pull the numbers in</h3>
            <p className="step-desc">Watch it work through the list, pause whenever you need to, up to 2,000 links in one go.</p>
          </div>
          <div className="step-card">
            <div className="step-number">03</div>
            <h3 className="step-heading">Download it back</h3>
            <p className="step-desc">Your sheet comes back with the numbers added alongside your own columns, in Excel or CSV.</p>
          </div>
        </div>

        {/* Sits under the three steps, not inside step 03.

            Inside the card it made that one card far taller than its two
            neighbours, and because the row stretches all three to match, the
            other two gained a block of dead space. On its own line it balances
            the steps and the preview gets the width it deserves. */}
        <div className="sheet-preview" aria-hidden="true">
          <div className="sheet-preview-caption">What comes back</div>
          <div className="sheet-preview-row">
            <span className="sheet-col sheet-col-yours">Creator</span>
            <span className="sheet-col sheet-col-yours">Brief</span>
            <span className="sheet-col sheet-col-yours">Fee</span>
            <span className="sheet-col sheet-col-added">Views</span>
            <span className="sheet-col sheet-col-added">Likes</span>
            <span className="sheet-col sheet-col-added">Comments</span>
            <span className="sheet-col sheet-col-added">Shares</span>
            <span className="sheet-col sheet-col-added">Saves</span>
            <span className="sheet-col sheet-col-added">Engagement rate</span>
          </div>
          <div className="sheet-preview-key">
            <span><i className="sheet-dot sheet-dot-yours"></i>your columns, exactly as you sent them</span>
            <span><i className="sheet-dot sheet-dot-added"></i>added by Reelytic</span>
          </div>
        </div>
      </div>

      <div className="time-band">
        <div className="time-band-inner">
          2,000 reels takes <span className="time-band-highlight">45 minutes</span> instead of <span className="time-band-highlight">3 days</span>. That is three days of senior time back on every campaign, and a client who hears from you first.
        </div>
      </div>

      <div className="landing-section">
        <h2 className="section-title">Two report types, one workflow</h2>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-number">🎬</div>
            <h3 className="step-heading">Reel Report</h3>
            <p className="step-desc">Paste a list of reel links and get views, likes, comments, shares, saves and engagement rate for each one, lined up side by side.</p>
          </div>
          <div className="step-card">
            <div className="step-number">👤</div>
            <h3 className="step-heading">Profile Report</h3>
            <p className="step-desc">Give us a creator's profile and get a fair read on how they normally perform, with one-off viral posts left out so the average means something.</p>
          </div>
        </div>
      </div>

      <div className="landing-section">
        <h2 className="section-title">Built for the reports your retainer depends on</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-title">Numbers that line up</div>
            <div className="feature-desc">Every figure sits in a neat column, so a client can scan the whole report without hunting for the number they care about.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Scales with your client list</div>
            <div className="feature-desc">Run up to 2,000 links at once, across as many clients as you handle. If the same link appears in two campaigns, you are never charged for it twice.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Stop and start whenever you like</div>
            <div className="feature-desc">Pause it, pick it back up, or take what is ready so far. Close the tab and go to a meeting: it carries on without you.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Nothing slips through</div>
            <div className="feature-desc">Repeated and broken links are pointed out before you start, so nothing quietly goes missing from the final count.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Ready to send, not to fix</div>
            <div className="feature-desc">Your sheet comes back tidy in Excel or CSV, laid out exactly the way you sent it in.</div>
          </div>
          <div className="feature-card">
            <div className="feature-title">Nothing gets lost</div>
            <div className="feature-desc">Every report you have ever run stays in your account, ready to open or download again months later.</div>
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