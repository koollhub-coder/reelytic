import React, { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Logo } from './Logo';
import { WelcomeTour } from './WelcomeTour';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../api/client';

export function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, refreshUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
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
  const navItems = [
    { label: 'Reel Report', path: '/reels', icon: '🎬' },
    { label: 'Profile Report', path: '/profiles', icon: '👤' },
    ...(isAdmin ? [] : [{ label: 'Dashboard', path: '/dashboard', icon: '📊' }]),
    { label: 'History', path: '/history', icon: '⏱️' },
    { label: 'How Is This Calculated?', path: '/how-it-works', icon: 'ℹ️' },
    { label: 'Settings', path: '/settings', icon: '⚙️' }
  ];

  // Grouped by real admin workflow (overview, then people, then money,
  // then scan configuration) rather than the order features were built in.
  const adminGroups = [
    {
      heading: 'Overview',
      items: [
        { label: 'Admin Dashboard', path: '/admin/dashboard', icon: '📈' },
      ],
    },
    {
      heading: 'Clients & Access',
      items: [
        { label: 'Clients', path: '/admin/clients', icon: '👥' },
        { label: 'Sessions Log', path: '/admin/sessions', icon: '🔐' },
      ],
    },
    {
      heading: 'Billing & Costs',
      items: [
        { label: 'Ledger', path: '/admin/ledger', icon: '📖' },
        { label: 'Pricing Editor', path: '/admin/pricing', icon: '💰' },
        { label: 'Cost Monitor', path: '/admin/cost-monitor', icon: '📊' },
        { label: 'Usage & Spend', path: '/admin/usage', icon: '💸' },
      ],
    },
    {
      heading: 'Scan Configuration',
      items: [
        { label: 'Scan Settings', path: '/admin/scan-settings', icon: '🔀' },
        { label: 'How It\'s Calculated', path: '/admin/profile-methodology', icon: 'ℹ️' },
      ],
    },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      {/* Sidebar Desktop */}
      {/* Mobile top bar, only visible <=768px (display:none on desktop via .rl-mobile-only) */}
      <header className="rl-mobile-only rl-topbar">
        <button className="rl-icon-btn rl-hamburger" aria-label="Open navigation menu" onClick={() => setMobileOpen(true)}>☰</button>
        <Logo />
        <button className="rl-icon-btn" aria-label="Toggle theme" onClick={toggleTheme}>{theme === 'dark' ? '☀️' : '🌙'}</button>
      </header>

      {/* Backdrop behind the open drawer (mobile only) */}
      {mobileOpen && <button className="rl-mobile-only rl-backdrop" aria-label="Close navigation menu" onClick={() => setMobileOpen(false)} />}

      {/* Sidebar (desktop) / slide-in drawer (mobile). Same markup for both so theming stays correct. */}
      <aside style={{ width: 'var(--sidebar-w)', backgroundColor: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 50 }} className={`desktop-sidebar rl-shell-sidebar${mobileOpen ? ' rl-open' : ''}`}>
        <div style={{ padding: 'var(--s5)', borderBottom: '1px solid var(--border)' }}>
          <Logo />
        </div>

        <nav style={{ padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, overflowY: 'auto' }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: 'var(--s2) var(--s3)', fontWeight: 600 }}>
            Reports
          </div>
          {navItems.map(item => (
            <button
              key={item.path}
              onClick={() => { navigate(item.path); setMobileOpen(false); }}
              style={{
                display: 'flex',
                alignItem: 'center',
                gap: '12px',
                width: '100%',
                padding: '10px var(--s3)',
                borderRadius: 'var(--r-sm)',
                backgroundColor: isActive(item.path) ? 'var(--accent-soft)' : 'transparent',
                color: isActive(item.path) ? 'var(--accent)' : 'var(--text)',
                fontWeight: isActive(item.path) ? 600 : 500,
                textAlign: 'left',
                border: 'none',
                cursor: 'pointer',
                transition: 'background var(--t-fast)'
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}

          {user && user.role === 'admin' && (
            <>
              {adminGroups.map(group => (
                <React.Fragment key={group.heading}>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: 'var(--s4) var(--s3) var(--s2) var(--s3)', fontWeight: 600, marginTop: 'var(--s2)' }}>
                    {group.heading}
                  </div>
                  {group.items.map(item => (
                    <button
                      key={item.path}
                      onClick={() => { navigate(item.path); setMobileOpen(false); }}
                      style={{
                        display: 'flex',
                        alignItem: 'center',
                        gap: '12px',
                        width: '100%',
                        padding: '10px var(--s3)',
                        borderRadius: 'var(--r-sm)',
                        backgroundColor: isActive(item.path) ? 'var(--accent-soft)' : 'transparent',
                        color: isActive(item.path) ? 'var(--accent)' : 'var(--text)',
                        fontWeight: isActive(item.path) ? 600 : 500,
                        textAlign: 'left',
                        border: 'none',
                        cursor: 'pointer'
                      }}
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                    </button>
                  ))}
                </React.Fragment>
              ))}
            </>
          )}
        </nav>

        {/* Credits panel */}
        <div style={{ padding: 'var(--s4)', borderTop: '1px solid var(--border)' }}>
          <div
            onClick={() => { if (user?.role !== 'admin') { navigate('/pricing'); setMobileOpen(false); } }}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: 'var(--r-md)', backgroundColor: 'var(--surface-2)', cursor: user?.role === 'admin' ? 'default' : 'pointer' }}
            title={user?.role === 'admin' ? 'Admin: unlimited credits' : 'View plans & top up'}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Credits</div>
              <div style={{ fontFamily: 'var(--font-data)', fontWeight: 700, fontSize: 'var(--fs-md)' }}>
                {user?.plan === 'unlimited' ? '∞ Unlimited' : (user?.credits ?? 0).toLocaleString()}
              </div>
            </div>
            <span className="chip accent" style={{ textTransform: 'capitalize', flexShrink: 0 }}>{user?.plan || 'free'}</span>
          </div>
        </div>

        {/* Bottom User Bar */}
        <div style={{ padding: 'var(--s4)', borderTop: '1px solid var(--border)', position: 'relative' }}>
          {userMenuOpen && (
            <div style={{ position: 'absolute', bottom: '100%', left: 'var(--s4)', right: 'var(--s4)', marginBottom: '8px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-lg)', padding: 'var(--s2)', zIndex: 100 }}>
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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={() => setUserMenuOpen(prev => !prev)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flex: 1 }}
            >
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '14px' }}>
                {(user?.name || user?.username)?.[0]?.toUpperCase() || 'U'}
              </div>
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={user?.email || user?.username}>{user?.name || user?.username}</div>
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
            </button>

            <button
              onClick={toggleTheme}
              aria-label="Toggle theme"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '6px', borderRadius: 'var(--r-sm)' }}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="rl-shell-main" style={{ flex: 1, marginLeft: 'var(--sidebar-w)', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="rl-shell-content" style={{ padding: 'var(--s6) var(--s7)', flex: 1, maxWidth: '1600px', width: '100%', margin: '0 auto' }}>
          <Outlet />
        </div>
      </main>

      {showTour && <WelcomeTour onDone={handleTourDone} />}
    </div>
  );
}
