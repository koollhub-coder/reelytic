import React, { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Logo } from './Logo';
import { ErrorBoundary } from './ErrorBoundary';
import { WelcomeTour } from './WelcomeTour';
import { Tooltip } from './Tooltip';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../api/client';
import {
  SunIcon, MoonIcon, MenuIcon, ReelIcon, ProfileIcon, DashboardIcon, HistoryIcon,
  HelpIcon, SettingsIcon, CreditCardIcon, ActivityIcon, UsersIcon, ListIcon,
  ReceiptIcon, TagIcon, ChartIcon, SlidersIcon, FileIcon,
  SidebarCollapseIcon, SidebarExpandIcon,
} from './Icon';

const SIDEBAR_COLLAPSED_KEY = 'reelytic-sidebar-collapsed';
const SIDEBAR_COLLAPSED_W = '72px';

// The collapsed credits pill is ~64px wide -- a full "1,284,500" would
// overflow it, so admin's platform total gets the same K/M compaction the
// report engine already uses for on-screen metric counts. null (still
// loading) reads as an en dash rather than a misleading 0.
function formatCompactCredits(n) {
  if (n == null) return '–';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, refreshUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  // Desktop-only preference, persisted across sessions like theme already
  // is. Mobile's drawer shares this same <aside> markup (see the render
  // below), so "collapsed" is deliberately never applied while the drawer
  // is open -- see effectiveCollapsed -- a slide-out nav showing icons only
  // would defeat the point of opening it in the first place. The width
  // itself is additionally guarded in mobile.css (width: ... !important
  // inside the 768px query), so even a stale localStorage value from a
  // previous desktop session can't visually shrink the drawer.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'; } catch (e) { return false; }
  });
  const effectiveCollapsed = sidebarCollapsed && !mobileOpen;
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)); } catch (e) { /* ignore */ }
      return next;
    });
  };
  /*
    Unresolved production faults, shown as a badge beside the Health nav item.
    Polled slowly: this is an ambient "is anything on fire" signal, not a
    live feed, and the Health page itself refreshes properly when opened.
  */
  const [healthCount, setHealthCount] = useState(0);
  useEffect(() => {
    if (user?.role !== 'admin') return undefined;
    let alive = true;
    const check = () => {
      apiFetch('/admin/health/count')
        .then((r) => { if (alive) setHealthCount(r.unresolved || 0); })
        .catch(() => {});
    };
    check();
    const t = setInterval(check, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [user]);

  // Admin's own credits panel would otherwise show '∞' -- meaningless, since
  // an admin's balance is a fixed placeholder (see credits.service.js's
  // ADMIN_CREDITS), not a real number. Platform-wide total is the number
  // that's actually useful to an admin here.
  const [totalPlatformCredits, setTotalPlatformCredits] = useState(null);
  useEffect(() => {
    if (user?.role !== 'admin') return;
    apiFetch('/admin/credits-total')
      .then((r) => setTotalPlatformCredits(r.totalCredits))
      .catch(() => {});
  }, [user]);
  // Only the automatic first-login show lives here. Settings' "Replay tour"
  // renders its own independent WelcomeTour instance -- simpler than
  // threading a trigger down through Outlet for what's just a modal toggle.
  const showTour = user?.hasSeenTour === false;

  const handleTourDone = () => {
    apiFetch('/auth/tour-seen', { method: 'POST' }).then(refreshUser).catch(() => {});
  };

  const isActive = (path) => location.pathname.startsWith(path);

  const isAdmin = user?.role === 'admin';

  // Admin has its own "Admin Dashboard" below -- showing the client-usage
  // "Dashboard" too just duplicates it with nothing an admin actually needs.
  // Same reasoning for "How Is This Calculated?": admin already has a richer,
  // pipeline-aware version of that page under Scan Configuration below, so
  // showing the plain client-facing one too just reads as a copy-paste
  // mistake (two near-identical ℹ️ items).
  //
  // Two groups instead of one flat list -- NAVIGATION (the report tools) vs
  // WORKSPACE (account-level pages) -- so "Workspace Settings" and "Pricing
  // & Plans" read as a different kind of thing from "go run a report,"
  // which they are.
  const navGroups = [
    {
      heading: 'Navigation',
      items: [
        ...(isAdmin ? [] : [{ label: 'Dashboard', path: '/dashboard', icon: DashboardIcon }]),
        { label: 'Reel Report', path: '/reels', icon: ReelIcon },
        { label: 'Profile Report', path: '/profiles', icon: ProfileIcon },
        { label: 'History', path: '/history', icon: HistoryIcon },
        ...(isAdmin ? [] : [{ label: 'How Is This Calculated?', path: '/how-it-works', icon: HelpIcon }]),
      ],
    },
    {
      heading: 'Workspace',
      items: [
        { label: 'Workspace Settings', path: '/settings', icon: SettingsIcon },
        // Previously the only way here was clicking the unlabeled credits box
        // below -- not discoverable. Points at /billing (rendered inside this
        // same Shell), not the public /pricing marketing page -- that page has
        // its own separate nav bar and no sidebar, so routing here to it used to
        // eject the user from their whole workspace for what looked like a
        // different site. Admin has unlimited credits and never needs this.
        ...(isAdmin ? [] : [{ label: 'Pricing & Plans', path: '/billing', icon: CreditCardIcon }]),
      ],
    },
  ];

  // Grouped by real admin workflow (overview, then people, then money,
  // then scan configuration) rather than the order features were built in.
  const adminGroups = [
    {
      heading: 'Overview',
      items: [
        { label: 'Admin Dashboard', path: '/admin/dashboard', icon: DashboardIcon },
        // Sits in Overview rather than buried under a submenu: an
        // unnoticed health page is the same as no health page.
        { label: 'Health', path: '/admin/health', badge: healthCount, icon: ActivityIcon },
      ],
    },
    {
      heading: 'Clients & Access',
      items: [
        { label: 'Clients', path: '/admin/clients', icon: UsersIcon },
        { label: 'Sessions Log', path: '/admin/sessions', icon: ListIcon },
      ],
    },
    {
      heading: 'Billing & Costs',
      items: [
        { label: 'Ledger', path: '/admin/ledger', icon: ReceiptIcon },
        { label: 'Pricing Editor', path: '/admin/pricing', icon: TagIcon },
        { label: 'Cost Monitor', path: '/admin/cost-monitor', icon: ChartIcon },
        { label: 'Usage & Spend', path: '/admin/usage', icon: ChartIcon },
      ],
    },
    {
      heading: 'Scan Configuration',
      items: [
        { label: 'Scan Settings', path: '/admin/scan-settings', icon: SlidersIcon },
        { label: 'How It\'s Calculated', path: '/admin/profile-methodology', icon: HelpIcon },
      ],
    },
    {
      heading: 'Compliance',
      items: [
        { label: 'Legal Pages', path: '/admin/legal', icon: FileIcon },
      ],
    },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      {/* Sidebar Desktop */}
      {/* Mobile top bar, only visible <=768px (display:none on desktop via .rl-mobile-only) */}
      <header className="rl-mobile-only rl-topbar">
        <button className="rl-icon-btn rl-hamburger" aria-label="Open navigation menu" onClick={() => setMobileOpen(true)}><MenuIcon size={18} /></button>
        <Logo />
        <button className="rl-icon-btn" aria-label="Toggle theme" onClick={toggleTheme}>{theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}</button>
      </header>

      {/* Backdrop behind the open drawer (mobile only) */}
      {mobileOpen && <button className="rl-mobile-only rl-backdrop" aria-label="Close navigation menu" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar (desktop) / slide-in drawer (mobile). Same markup for both so theming stays correct. */}
      <aside style={{ width: effectiveCollapsed ? SIDEBAR_COLLAPSED_W : 'var(--sidebar-w)', backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 50, transition: 'width var(--t-base)' }} className={`desktop-sidebar rl-shell-sidebar${mobileOpen ? ' rl-open' : ''}`}>
        <div
          style={{
            padding: effectiveCollapsed ? 'var(--s4) var(--s2)' : 'var(--s5)',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            // Collapsed: stacked, not side-by-side -- squeezing the logo AND
            // a bordered toggle button into the same row left them crammed
            // together in a 72px-wide column with no real room for either.
            flexDirection: effectiveCollapsed ? 'column' : 'row',
            alignItems: 'center',
            justifyContent: effectiveCollapsed ? 'center' : 'space-between',
            gap: effectiveCollapsed ? '10px' : 'var(--s2)',
          }}
        >
          <Logo compact={effectiveCollapsed} size={effectiveCollapsed ? 26 : undefined} />
          {/* Hidden on mobile (rl-hide-mobile) -- the drawer already has its
              own dedicated close affordance (the backdrop / hamburger), a
              second collapse control here would just be a second button
              that does something different than it looks like it does.
              Collapsed: borderless and smaller, so it reads as a secondary
              affordance under the logo rather than competing with it. */}
          <button
            type="button"
            className="rl-hide-mobile"
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: effectiveCollapsed ? '22px' : '28px', height: effectiveCollapsed ? '22px' : '28px', flexShrink: 0,
              background: effectiveCollapsed ? 'none' : 'var(--surface-2)',
              border: effectiveCollapsed ? 'none' : '1px solid var(--border)',
              borderRadius: 'var(--r-sm)', color: 'var(--text-3)', cursor: 'pointer',
            }}
          >
            {sidebarCollapsed ? <SidebarExpandIcon size={13} /> : <SidebarCollapseIcon size={13} />}
          </button>
        </div>

        <nav style={{ padding: effectiveCollapsed ? 'var(--s4) var(--s2)' : 'var(--s4)', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, overflowY: 'auto' }}>
          {navGroups.map((group, gi) => (
            <React.Fragment key={group.heading}>
              {!effectiveCollapsed && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: `${gi === 0 ? 'var(--s2)' : 'var(--s4)'} var(--s3) var(--s2) var(--s3)`, fontWeight: 600 }}>
                  {group.heading}
                </div>
              )}
              {group.items.map(item => {
                const active = isActive(item.path);
                return (
                  <Tooltip key={item.path} content={effectiveCollapsed ? item.label : null} position="right" style={{ display: 'flex', width: '100%' }}>
                    <button
                      onClick={() => { navigate(item.path); setMobileOpen(false); }}
                      style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: effectiveCollapsed ? 'center' : 'flex-start',
                        gap: '12px',
                        width: '100%',
                        padding: effectiveCollapsed ? '10px' : '10px var(--s3)',
                        // A touch tighter than --r-sm (6px) -- 8px is what the
                        // spec calls for on the active-row treatment
                        // specifically, kept the same for inactive rows too
                        // so a hover doesn't change the row's own shape.
                        borderRadius: '8px',
                        backgroundColor: active ? 'var(--surface-2)' : 'transparent',
                        color: active ? 'var(--accent)' : 'var(--text-2)',
                        fontWeight: active ? 600 : 500,
                        textAlign: 'left',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'background var(--t-fast)'
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      {/* 4px vertical accent bar, active state only -- an
                          absolutely-positioned bar rather than a left
                          border, so it doesn't shift the row's own padding
                          when it appears. */}
                      {active && (
                        <span aria-hidden="true" style={{
                          position: 'absolute', left: 0, top: '6px', bottom: '6px', width: '4px',
                          borderRadius: '0 3px 3px 0', backgroundColor: 'var(--accent)',
                        }} />
                      )}
                      {item.icon && <item.icon size={16} style={{ flexShrink: 0, color: active ? 'var(--accent)' : 'var(--text-3)' }} />}
                      {!effectiveCollapsed && <span style={{ color: active ? 'var(--text)' : 'var(--text-2)' }}>{item.label}</span>}
                    </button>
                  </Tooltip>
                );
              })}
            </React.Fragment>
          ))}

          {user && user.role === 'admin' && (
            <>
              {adminGroups.map(group => (
                <React.Fragment key={group.heading}>
                  {!effectiveCollapsed && (
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: 'var(--s4) var(--s3) var(--s2) var(--s3)', fontWeight: 600, marginTop: 'var(--s2)' }}>
                      {group.heading}
                    </div>
                  )}
                  {group.items.map(item => (
                    <Tooltip key={item.path} content={effectiveCollapsed ? item.label : null} position="right" style={{ display: 'flex', width: '100%' }}>
                    <button
                      onClick={() => { navigate(item.path); setMobileOpen(false); }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: effectiveCollapsed ? 'center' : 'space-between',
                        gap: '12px',
                        width: '100%',
                        padding: effectiveCollapsed ? '10px' : '10px var(--s3)',
                        borderRadius: 'var(--r-sm)',
                        backgroundColor: isActive(item.path) ? 'var(--accent-soft)' : 'transparent',
                        color: isActive(item.path) ? 'var(--accent)' : 'var(--text)',
                        fontWeight: isActive(item.path) ? 600 : 500,
                        textAlign: 'left',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                        {item.icon && <item.icon size={16} style={{ flexShrink: 0 }} />}
                        {!effectiveCollapsed && <span>{item.label}</span>}
                      </span>
                      {/* Only rendered when something is actually wrong, so
                          its presence alone is the signal. A permanent "0"
                          badge is wallpaper and stops being noticed. */}
                      {!effectiveCollapsed && item.badge > 0 && (
                        <Tooltip content={`${item.badge} unresolved issue${item.badge === 1 ? '' : 's'}`}>
                        <span
                          className="mono"
                          style={{
                            backgroundColor: 'var(--err)', color: '#fff',
                            fontSize: '10px', fontWeight: 700, lineHeight: 1,
                            padding: '3px 6px', borderRadius: 'var(--r-full)',
                            flexShrink: 0, minWidth: '18px', textAlign: 'center',
                          }}
                        >
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                        </Tooltip>
                      )}
                    </button>
                    </Tooltip>
                  ))}
                </React.Fragment>
              ))}
            </>
          )}
        </nav>

        {/* Credits panel. Admin's own balance is a fixed 1,000,000
            placeholder (see credits.service.js's ADMIN_CREDITS) so their
            runs never block -- showing it, or '∞', here means nothing to an
            admin. Platform-wide total across every client is the number
            that's actually useful in this spot for that role. A real client
            on the paid Unlimited plan is unaffected -- they still see their
            own genuine balance as '∞ Unlimited', same as always. */}
        <div style={{ padding: effectiveCollapsed ? 'var(--s3) var(--s2)' : 'var(--s4)', borderTop: '1px solid var(--border)' }}>
          {effectiveCollapsed ? (
            <Tooltip
              position="right"
              content={user?.role === 'admin'
                ? `${(totalPlatformCredits ?? 0).toLocaleString()} credits held across every client`
                : `${(user?.credits ?? 0).toLocaleString()} credits: view plans & top up`}
              style={{ display: 'flex', width: '100%' }}
            >
            <div
              onClick={() => { if (user?.role !== 'admin') { navigate('/billing'); setMobileOpen(false); } }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%',
                padding: '10px 4px', borderRadius: 'var(--r-md)', backgroundColor: 'var(--surface-2)',
                cursor: user?.role === 'admin' ? 'default' : 'pointer', fontFamily: 'var(--font-data)',
                fontWeight: 700, fontSize: 'var(--fs-xs)', color: 'var(--accent)',
              }}
            >
              {user?.role === 'admin'
                ? formatCompactCredits(totalPlatformCredits)
                : (user?.plan === 'unlimited' ? '∞' : (user?.credits ?? 0))}
            </div>
            </Tooltip>
          ) : (
            <Tooltip
              content={user?.role === 'admin' ? 'Total credits held across every client account' : 'View plans & top up'}
              style={{ display: 'flex', width: '100%' }}
            >
            <div
              onClick={() => { if (user?.role !== 'admin') { navigate('/billing'); setMobileOpen(false); } }}
              style={{ padding: '10px 12px', borderRadius: 'var(--r-md)', backgroundColor: 'var(--surface-2)', cursor: user?.role === 'admin' ? 'default' : 'pointer', width: '100%' }}
            >
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '6px' }}>
                {user?.role === 'admin' ? 'Platform Credits' : 'Credits'}
              </div>
              {/* Number and plan chip share one baseline instead of the chip
                  sitting centered against the whole label+number block --
                  centering it there put the chip floating between the two
                  lines rather than lined up with the number. */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                <div style={{ fontFamily: 'var(--font-data)', fontWeight: 700, fontSize: 'var(--fs-md)', minWidth: 0 }}>
                  {user?.role === 'admin'
                    ? (totalPlatformCredits ?? 0).toLocaleString()
                    : (user?.plan === 'unlimited' ? '∞ Unlimited' : (user?.credits ?? 0).toLocaleString())}
                </div>
                {user?.role !== 'admin' && (
                  <span className="chip accent" style={{ textTransform: 'capitalize', flexShrink: 0 }}>{user?.plan || 'free'}</span>
                )}
              </div>
            </div>
            </Tooltip>
          )}
        </div>

        {/* Bottom User Bar */}
        <div style={{ padding: 'var(--s4)', borderTop: '1px solid var(--border)', position: 'relative' }}>
          {userMenuOpen && (
            <div style={{ position: 'absolute', bottom: '100%', left: 'var(--s4)', width: effectiveCollapsed ? '180px' : undefined, right: effectiveCollapsed ? undefined : 'var(--s4)', marginBottom: '8px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)', padding: 'var(--s2)', zIndex: 100 }}>
              <button
                onClick={() => { setUserMenuOpen(false); logout('/login'); }}
                style={{ width: '100%', padding: '8px var(--s3)', textAlign: 'left', borderRadius: 'var(--r-sm)', color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
              >
                Switch account
              </button>
              <button
                onClick={() => { setUserMenuOpen(false); logout(); }}
                style={{ width: '100%', padding: '8px var(--s3)', textAlign: 'left', borderRadius: 'var(--r-sm)', color: 'var(--err)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
              >
                Log out
              </button>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: effectiveCollapsed ? 'column' : 'row', justifyContent: effectiveCollapsed ? 'center' : 'space-between', alignItems: 'center', gap: effectiveCollapsed ? '10px' : 0 }}>
            <Tooltip content={effectiveCollapsed ? (user?.email || user?.username) : null} style={{ flex: effectiveCollapsed ? 'none' : 1 }}>
            <button
              onClick={() => setUserMenuOpen(prev => !prev)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: effectiveCollapsed ? 'center' : 'flex-start', gap: '8px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flex: effectiveCollapsed ? 'none' : 1, width: effectiveCollapsed ? '100%' : 'auto' }}
            >
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>
                {user?.username?.[0]?.toUpperCase() || 'U'}
              </div>
              {!effectiveCollapsed && (
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.username}</div>
                  {user?.role === 'admin' && (
                    <div
                      style={{
                        fontSize: 'var(--fs-xs)',
                        color: 'var(--text-3)',
                        textTransform: 'uppercase'
                      }}
                    >
                      {user?.role}
                    </div>
                  )}
                </div>
              )}
            </button>
            </Tooltip>

            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: '32px', height: '32px', flexShrink: 0,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
                cursor: 'pointer', borderRadius: 'var(--r-full)', color: 'var(--text-2)',
              }}
            >
              {theme === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="rl-shell-main" style={{ flex: 1, marginLeft: effectiveCollapsed ? SIDEBAR_COLLAPSED_W : 'var(--sidebar-w)', minWidth: 0, display: 'flex', flexDirection: 'column', transition: 'margin-left var(--t-base)' }}>
        <div className="rl-shell-content" style={{ padding: 'var(--s6) var(--s7)', flex: 1, maxWidth: '1600px', width: '100%', margin: '0 auto' }}>
          {/* Wraps only the routed page, not the shell. A crash on one
              screen therefore leaves the sidebar, navigation and account
              menu intact, so the user can walk away from the broken page
              instead of losing the whole app. */}
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      {showTour && <WelcomeTour onDone={handleTourDone} username={user?.username} />}
    </div>
  );
}
