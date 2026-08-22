import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { ReportHero } from '../components/ReportHero';
import { AccountMenu } from '../components/AccountMenu';
import {
  SunIcon, MoonIcon, ReelIcon, ProfileIcon, CheckIcon, SpreadsheetIcon,
  PaletteIcon, LinkIcon, EyeIcon, DownloadIcon, PlayIcon,
  GridIcon, UploadIcon, TrendingUpIcon, LoaderIcon, ChevronDownIcon,
  MenuIcon, XIcon, CreditCardIcon, GiftIcon, ShieldIcon, SparkleIcon,
  FileIcon, PackageIcon, TourIcon, ZapIcon, InstagramIcon, LinkedinIcon, TwitterIcon,
} from '../components/Icon';
import { NewsletterSignup } from '../components/NewsletterSignup';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useDocumentMeta, SITE_URL } from '../hooks/useDocumentMeta';
import '../styles/landing.css';

// SoftwareApplication, not Organization (index.html already carries that
// one sitewide) -- this is the schema Google actually surfaces rich results
// for on a product's own marketing page. Numbers are deliberately absent
// (aggregateRating, price) rather than invented: schema.org validators don't
// require them, and a fabricated rating is worse for trust than no rich
// result at all.
const LANDING_STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Reelytic',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  url: `${SITE_URL}/`,
  description: 'Turn a sheet of Instagram Reel or profile links into a client-ready engagement report. Built for influencer-marketing agencies.',
  // Matches Pricing.jsx, which bills in INR -- see its ₹ formatting.
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
};

// Every item here is a real in-page section (#how-it-works, #what-comes-back,
// #report-types all already exist further down this same page) -- there's no
// separate Help Center/Guides/Blog in the app yet, so this groups the real
// content instead of linking to pages that don't exist.
function ResourcesMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const handleKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const items = [
    { href: '#how-it-works', label: 'How it works' },
    { href: '#what-comes-back', label: 'What comes back' },
    { href: '#report-types', label: 'Report types' },
  ];

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-2)', fontSize: 'var(--fs-sm)', fontWeight: 500, padding: 0, fontFamily: 'inherit',
        }}
      >
        Resources
        <ChevronDownIcon size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--t-fast)' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 10px)', left: 0, minWidth: '180px', zIndex: 200,
          backgroundColor: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-md)',
          boxShadow: 'var(--shadow-lg)', padding: 'var(--s2)',
        }}>
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '8px 10px', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', color: 'var(--text)', textDecoration: 'none' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function Landing() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();
  // The nav's right-hand action group (Pricing/Resources/theme/Login/Get
  // started) is a separate inner flex container from .landing-nav itself,
  // so .landing-nav's own flex-wrap never reached it -- on a 375px phone
  // those five items in one nowrap row ran 25px past the viewport edge.
  // Below 768px they're hidden behind this hamburger instead, matching the
  // reference's mobile nav (logo + menu icon only).
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useDocumentMeta({
    title: 'Instagram Reel & Profile Analytics for Agencies',
    description: 'Turn a sheet of Instagram Reel or profile links into a client-ready engagement report in minutes. No card required, 10 free credits to start.',
    path: '/',
    structuredData: LANDING_STRUCTURED_DATA,
  });

  return (
    <div className="landing-root">
      <nav className="landing-nav">
        <Logo />
        <div className="rl-landing-nav-actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
          <a href="#how-it-works" className="rl-landing-navlink" style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', fontWeight: 500 }}>How it works</a>
          <a href="/pricing" style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', fontWeight: 500 }} onClick={(e) => { e.preventDefault(); navigate('/pricing'); }}>Pricing</a>
          <ResourcesMenu />
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '34px', height: '34px', flexShrink: 0,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              cursor: 'pointer', borderRadius: 'var(--r-full)', color: 'var(--text-2)',
            }}
          >
            {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </button>
          {user ? (
            <AccountMenu
              user={user}
              onGoToWorkspace={() => navigate('/reels')}
              onSwitchAccount={() => logout('/login')}
              onLogOut={() => logout()}
            />
          ) : (
            <>
              <button className="btn btn-secondary" onClick={() => navigate('/login')}>
                Log in
              </button>
              <button className="btn btn-primary" onClick={() => navigate('/signup')}>
                Get started
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          className="rl-mobile-only rl-icon-btn"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMobileMenuOpen((v) => !v)}
        >
          {mobileMenuOpen ? <XIcon size={20} /> : <MenuIcon size={20} />}
        </button>
      </nav>

      {mobileMenuOpen && (
        <div className="rl-mobile-only landing-mobile-menu">
          <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How it works</a>
          <a href="/pricing" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false); navigate('/pricing'); }}>Pricing</a>
          <button type="button" className="landing-mobile-menu-theme" onClick={toggleTheme}>
            {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          {user ? (
            <>
              <button type="button" className="btn btn-primary" onClick={() => { setMobileMenuOpen(false); navigate('/reels'); }}>Go to your workspace →</button>
              <button type="button" className="btn btn-secondary" onClick={() => { setMobileMenuOpen(false); logout(); }}>Log out</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => { setMobileMenuOpen(false); navigate('/login'); }}>Log in</button>
              <button type="button" className="btn btn-primary" onClick={() => { setMobileMenuOpen(false); navigate('/signup'); }}>Get started</button>
            </>
          )}
        </div>
      )}

      <section className="landing-hero">
        <div>
          <div className="hero-eyebrow">FOR INFLUENCER-MARKETING AGENCIES</div>
          <h1 className="hero-title">Turn Instagram links into <span className="hero-title-accent">client-ready</span> reports.</h1>
          <p className="hero-sub">
            Upload your campaign sheet. We pull the numbers, brand the report, and send you a clean, shareable link.
            {/* Hidden on mobile only (mobile.css) -- the reference's mobile
                hero drops this second line to keep the fold shorter; the
                headline and first line already carry the same promise. */}
            <span className="hero-sub-extra"><br /><strong style={{ color: 'var(--text)' }}>No logins for your clients. No manual work for you.</strong></span>
          </p>
          <div className="hero-cta-group">
            {/* Fixed, short label -- account identity/switching lives in the
                nav's avatar menu, not spelled out here, so this button never
                scales with username length. Logged out, this is the real
                self-serve signup (Signup.jsx already exists and grants 10
                free credits, no card) -- it just wasn't linked from the
                landing page before now. */}
            <button className="btn btn-primary" style={{ height: '44px', padding: '0 var(--s6)', fontSize: 'var(--fs-md)' }} onClick={() => navigate(user ? '/reels' : '/signup')}>
              {user ? 'Go to your workspace →' : 'Start free — No card required →'}
            </button>
            <a
              href="#how-it-works"
              className="btn btn-secondary"
              style={{ height: '44px', padding: '0 var(--s5)', fontSize: 'var(--fs-md)', gap: '8px' }}
            >
              <span style={{
                width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid var(--border-strong)', flexShrink: 0,
              }}>
                <PlayIcon size={9} />
              </span>
              See how it works
            </a>
          </div>
          {!user && (
            <div className="trust-row">
              <span className="trust-item"><span className="trust-item-icon"><CreditCardIcon size={16} /></span>No credit card required</span>
              <span className="trust-item"><span className="trust-item-icon"><GiftIcon size={16} /></span>Free plan available</span>
              <span className="trust-item"><span className="trust-item-icon"><ShieldIcon size={16} /></span>Cancel anytime, no commitments</span>
            </div>
          )}
          <div className="hero-caption">
            {user ? (
              <>Signed in. Not you? <button type="button" onClick={() => logout('/login')} className="rl-text-link">Switch account</button></>
            ) : (
              <>Already have a workspace? <button type="button" onClick={() => navigate('/login')} className="rl-text-link">Log in</button></>
            )}
          </div>
        </div>
        <div>
          <ReportHero />
        </div>
      </section>

      <div id="how-it-works" className="landing-section">
        <div className="hero-eyebrow rl-hide-mobile" style={{ textAlign: 'center' }}>HOW REELYTIC WORKS</div>
        <h2 className="section-title rl-workflow-section-title" style={{ marginBottom: 'var(--s2)' }}>
          <span className="rl-hide-mobile">Three simple steps</span>
          <span className="rl-mobile-only" style={{ justifyContent: 'center' }}>How Reelytic works</span>
        </h2>
        <p className="rl-hide-mobile" style={{ textAlign: 'center', color: 'var(--text-2)', marginBottom: 'var(--s6)' }}>Upload. We process. You share. That's it.</p>

        {/* Same icon-square + numbered-badge + dashed-connector language as
            the Settings page's Guided Tour card, so the marketing page and
            the product read as one thing. Step 1's icon is green (matching
            the spreadsheet-file color everywhere else it's used, e.g.
            ReportHero) rather than accent pink like steps 2-3, so the row
            reads as "your file" -> "our processing" -> "your report"
            instead of three identical dots. */}
        <div className="workflow-row">
          {[
            { Icon: SpreadsheetIcon, title: 'Upload your sheet', desc: 'Drop your Excel or CSV file with Instagram links.', green: true },
            { Icon: LoaderIcon, title: 'We pull the data', desc: 'We extract all metrics & insights.' },
            { Icon: FileIcon, title: 'Get your report', desc: 'Branded report ready to share or download.' },
          ].map((step, i, arr) => (
            <React.Fragment key={step.title}>
              <div className="workflow-step">
                <div className={`workflow-icon-badge${step.green ? ' workflow-icon-badge-green' : ''}`}>
                  <step.Icon size={20} />
                  <span className="workflow-number">{i + 1}</span>
                </div>
                <h3 className="step-heading">{step.title}</h3>
                <p className="step-desc">{step.desc}</p>
              </div>
              {i < arr.length - 1 && <div className="workflow-connector" aria-hidden="true" />}
            </React.Fragment>
          ))}
        </div>

        {/* Sits under the three steps, not inside step 03.

            Inside the card it made that one card far taller than its two
            neighbours, and because the row stretches all three to match, the
            other two gained a block of dead space. On its own line it balances
            the steps and the preview gets the width it deserves. */}
        <div id="what-comes-back" className="sheet-preview rl-hide-mobile" aria-hidden="true">
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

      {/* No verified client logos to show yet -- rather than fabricate a
          "trusted by" row, this is the same slot filled with real, checkable
          product facts instead. Hidden on mobile: the reference's mobile
          flow goes straight from "how it works" into the feature cards. */}
      <div className="proof-strip rl-hide-mobile">
        <div className="proof-strip-eyebrow">WHAT'S UNDER THE HOOD</div>
        <div className="proof-strip-row">
          <span className="proof-strip-item"><SpreadsheetIcon size={16} />Excel &amp; CSV support</span>
          <span className="proof-strip-item"><PaletteIcon size={16} />Your branding, on every report</span>
          <span className="proof-strip-item"><ReelIcon size={16} />Reel + Profile analysis</span>
          <span className="proof-strip-item"><DownloadIcon size={16} />Exportable report data</span>
          <span className="proof-strip-item"><LinkIcon size={16} />Shareable client links</span>
        </div>
      </div>

      <div className="landing-section whats-new">
        <div className="whats-new-badge rl-hide-mobile">
          <img src="/logo-mark-128.png" alt="" className="whats-new-logo" />
        </div>
        <div className="hero-eyebrow" style={{ textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <SparkleIcon size={13} />WHY AGENCIES LOVE REELYTIC
        </div>
        <h2 className="section-title rl-hide-mobile">Everything a client report needs, already handled</h2>
        <p className="rl-hide-mobile" style={{ textAlign: 'center', color: 'var(--text-2)', maxWidth: '660px', margin: '0 auto var(--s6)' }}>
          {/* True again: the Reelytic credit has been taken off the report
              footer, so the claim and the artefact now agree. An agency
              forwarding this to a brand should not have to explain who we
              are, and some of them would simply not send it if they did. */}
          Your logo, your colours, your layout on every page. Our name appears nowhere on
          the report your client receives.
        </p>
        <div className="features-grid">
          {/* Hidden on mobile only -- four cards make a clean 2-column grid
              on a phone; five leaves one stranded alone in the second row.
              Still shown, unchanged, on desktop's flex-wrap layout. */}
          <div className="feature-card whats-new-card rl-hide-mobile">
            <div className="card-icon-badge"><GridIcon size={19} /></div>
            <div className="feature-title">Campaign over campaign</div>
            <div className="feature-desc">Put a campaign's reports together and every new one shows what changed since the last: engagement, reach and how many creators you ran.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="card-icon-badge"><PaletteIcon size={19} /></div>
            <div className="feature-title">Your branding, on every report</div>
            <div className="feature-desc">Add your logo, colors and layout once. We do the rest.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="card-icon-badge"><LinkIcon size={19} /></div>
            <div className="feature-title">Share links that expire</div>
            <div className="feature-desc">Send reports with secure, expiring links.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="card-icon-badge"><EyeIcon size={19} /></div>
            <div className="feature-title">See when it was opened</div>
            <div className="feature-desc">Know who viewed the report and how many times.</div>
          </div>
          <div className="feature-card whats-new-card">
            <div className="card-icon-badge"><DownloadIcon size={19} /></div>
            <div className="feature-title">Export as Excel</div>
            <div className="feature-desc">Clients can download the full data in one click.</div>
          </div>
        </div>
      </div>

      {/* Bordered icon+text+button card -- replaces the plain-text CTA
          further down on mobile (that one is hidden there, see mobile.css)
          while staying available as a second CTA on desktop, positioned
          right where the reference puts it: immediately after the feature
          cards, before the deeper desktop-only sections. */}
      <div className="landing-section rl-cta-card-section">
        <div className="landing-cta-card">
          <div className="landing-cta-card-icon"><ZapIcon size={20} /></div>
          <div className="landing-cta-card-body">
            <div className="landing-cta-card-title">Ready to save hours of manual work?</div>
            <div className="landing-cta-card-desc">Upload your first sheet and get your report in minutes.</div>
          </div>
          <button className="btn btn-primary landing-cta-card-btn" onClick={() => navigate(user ? '/reels' : '/signup')}>
            {user ? 'Go to your workspace →' : 'Start free — No card required →'}
          </button>
        </div>
      </div>

      <div className="time-band rl-hide-mobile">
        <div className="time-band-inner">
          Run up to <span className="time-band-highlight">2,000 links</span> in one batch. Pause it, pick it back up, or close the tab entirely, Reelytic keeps working through the list without you watching it.
        </div>
      </div>

      <div id="report-types" className="landing-section rl-hide-mobile">
        <h2 className="section-title">Two report types, one workflow</h2>
        <div className="steps-grid">
          <div className="step-card">
            <div className="step-number"><ReelIcon size={19} /></div>
            <h3 className="step-heading">Reel Report</h3>
            <p className="step-desc">Paste a list of reel links and get views, likes, comments, shares, saves and engagement rate for each one, lined up side by side.</p>
          </div>
          <div className="step-card">
            <div className="step-number"><ProfileIcon size={19} /></div>
            <h3 className="step-heading">Profile Report</h3>
            <p className="step-desc">Give us a creator's profile and get a fair read on how they normally perform, with one-off viral posts left out so the average means something.</p>
          </div>
        </div>
      </div>

      <div className="landing-section rl-hide-mobile">
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

      <div className="time-band rl-hide-mobile">
        <div className="time-band-inner">
          Built for the teams who report to brands every week: talent managers, agency ops, and campaign leads who need numbers they can hand off without a second look.
        </div>
      </div>

      {/* This plain-text CTA is now the desktop-only second nudge (the
          bordered card above already covers mobile, right after the feature
          cards, matching the reference). */}
      <div className="landing-section rl-hide-mobile" style={{ textAlign: 'center', paddingTop: 'var(--s5)' }}>
        <h2 className="section-title" style={{ marginBottom: 'var(--s2)' }}>
          {user ? 'Ready to see it on your own sheet?' : 'Ready to stop building client reports by hand?'}
        </h2>
        <p style={{ color: 'var(--text-2)', maxWidth: '480px', margin: '0 auto var(--s5)' }}>
          {user
            ? 'Head back to your workspace and run another report.'
            : 'Upload your first sheet and see how Reelytic turns it into a report you can hand to a client.'}
        </p>
        <div style={{ display: 'flex', gap: 'var(--s3)', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" style={{ height: '44px', padding: '0 var(--s7)', fontSize: 'var(--fs-md)' }} onClick={() => navigate(user ? '/reels' : '/signup')}>
            {user ? 'Go to your workspace →' : 'Get started free →'}
          </button>
          {!user && (
            <a href="#how-it-works" className="btn btn-secondary" style={{ height: '44px', padding: '0 var(--s6)', fontSize: 'var(--fs-md)' }}>
              See how it works
            </a>
          )}
        </div>
      </div>

      {/* Every link below is a real route -- no About/Contact/Blog/Help
          columns, because those pages don't exist yet and a footer link
          that 404s is worse than no footer link. */}
      <footer className="landing-footer">
        <div className="landing-footer-top">
          <div className="landing-footer-brand">
            <Logo />
            <p className="landing-footer-desc">
              Turn a sheet of Instagram links into a client-ready report. Built for influencer-marketing agencies.
            </p>
          </div>
          <div className="landing-footer-cols">
            <details className="landing-footer-col">
              <summary className="landing-footer-col-title">
                <span className="landing-footer-col-title-label"><PackageIcon size={15} />Product</span>
                <ChevronDownIcon size={14} className="landing-footer-col-chevron" />
              </summary>
              <div className="landing-footer-col-body">
                <button type="button" onClick={() => navigate(user ? '/reels' : '/signup')}>Reel Report</button>
                <button type="button" onClick={() => navigate(user ? '/profiles' : '/signup')}>Profile Report</button>
                <button type="button" onClick={() => navigate('/pricing')}>Pricing</button>
              </div>
            </details>
            <details className="landing-footer-col">
              <summary className="landing-footer-col-title">
                <span className="landing-footer-col-title-label"><TourIcon size={15} />Resources</span>
                <ChevronDownIcon size={14} className="landing-footer-col-chevron" />
              </summary>
              <div className="landing-footer-col-body">
                <a href="#how-it-works">How it works</a>
                <button type="button" onClick={() => navigate(user ? '/history' : '/login')}>Report history</button>
              </div>
            </details>
            <details className="landing-footer-col">
              <summary className="landing-footer-col-title">
                <span className="landing-footer-col-title-label"><ProfileIcon size={15} />Account</span>
                <ChevronDownIcon size={14} className="landing-footer-col-chevron" />
              </summary>
              <div className="landing-footer-col-body">
                {user ? (
                  <button type="button" onClick={() => navigate('/settings')}>Workspace settings</button>
                ) : (
                  <>
                    <button type="button" onClick={() => navigate('/signup')}>Get started</button>
                    <button type="button" onClick={() => navigate('/login')}>Log in</button>
                  </>
                )}
              </div>
            </details>
            <details className="landing-footer-col">
              <summary className="landing-footer-col-title">
                <span className="landing-footer-col-title-label"><ShieldIcon size={15} />Legal</span>
                <ChevronDownIcon size={14} className="landing-footer-col-chevron" />
              </summary>
              <div className="landing-footer-col-body">
                <button type="button" onClick={() => navigate('/terms')}>Terms of Service</button>
                <button type="button" onClick={() => navigate('/privacy')}>Privacy Policy</button>
              </div>
            </details>
          </div>
        </div>

        <NewsletterSignup />

        <div className="landing-footer-bottom">
          <div>
            © {new Date().getFullYear()} Reelytic. All rights reserved.
            <span className="rl-hide-mobile"> · Audited Creator Intelligence</span>
          </div>
          <div className="landing-footer-legal-links">
            <button type="button" onClick={() => navigate('/privacy')}>Privacy Policy</button>
            <span aria-hidden="true">|</span>
            <button type="button" onClick={() => navigate('/terms')}>Terms of Service</button>
          </div>
          {/* Not links -- no Instagram/LinkedIn/Twitter account exists for
              Reelytic yet, and a footer icon that looks clickable but goes
              nowhere (or worse, to someone else's account) is a worse first
              impression than no icon at all. Shown as plain, non-interactive
              marks so the design reads complete without claiming a presence
              that doesn't exist; swap in real hrefs the moment those
              accounts exist. */}
          {/* <div className="landing-footer-social" aria-hidden="true">
            <span className="landing-footer-social-icon"><InstagramIcon size={16} /></span>
            <span className="landing-footer-social-icon"><LinkedinIcon size={16} /></span>
            <span className="landing-footer-social-icon"><TwitterIcon size={16} /></span>
          </div> */}
        </div>
      </footer>
    </div>
  );
}