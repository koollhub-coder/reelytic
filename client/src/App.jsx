import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';

import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { ForceChangePassword } from './pages/ForceChangePassword';
import { Settings } from './pages/Settings';
import { HowItsCalculated } from './pages/HowItsCalculated';
import { ReelReport } from './pages/ReelReport';
import { ProfileReport } from './pages/ProfileReport';
import { History } from './pages/History';

import { DevUnlock } from './pages/admin/DevUnlock';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { Clients } from './pages/admin/Clients';
import { Ledger } from './pages/admin/Ledger';
import { SessionsLog } from './pages/admin/SessionsLog';

import { Shell } from './components/Shell';
import { NotFound } from './components/NotFound';
import { UsageSpend } from './pages/admin/UsageSpend';
import { Pricing } from './pages/Pricing';
import { BillingPlans } from './pages/BillingPlans';
import { Checkout } from './pages/Checkout';
import { AdminPricingEditor } from './pages/admin/AdminPricingEditor';
import { CostMonitor } from './pages/admin/CostMonitor';
import { ScanSettings } from './pages/admin/ScanSettings';
import { ProfileMethodology } from './pages/admin/ProfileMethodology';
import { Dashboard } from './pages/Dashboard';
import { BrandedReport } from './pages/BrandedReport';
import { PublicReport } from './pages/PublicReport';
import './styles/base.css';
import './styles/components.css';
import './styles/mobile.css';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && window.location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

// Shown instead of silently redirecting when an already-logged-in user lands
// on /login or /signup -- e.g. from a bookmarked or shared link. A silent
// redirect gives them no way to tell who they're signed in as or to switch
// accounts; this makes both explicit.
function AlreadySignedIn() {
  const { user, logout } = useAuth();
  const displayName = user?.name || user?.username;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg)', padding: 'var(--s6)' }}>
      <div className="card" style={{ maxWidth: '380px', width: '100%', textAlign: 'center', padding: 'var(--s7)' }}>
        <div style={{
          width: '56px', height: '56px', borderRadius: '50%', margin: '0 auto var(--s4) auto',
          background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-display)',
        }}>
          {(displayName || '?').charAt(0).toUpperCase()}
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s1)' }}>
          You're signed in as {displayName}
        </h2>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s5)' }}>{user?.email || user?.username}</p>
        <a
          href="/reels"
          onClick={(e) => { e.preventDefault(); window.location.href = '/reels'; }}
          className="btn btn-primary"
          style={{ width: '100%', height: '40px', marginBottom: 'var(--s4)' }}
        >
          Continue to your workspace →
        </a>
        <button
          type="button"
          onClick={logout}
          className="rl-text-link"
          style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}
        >
          Not {displayName}? Log out and use a different account
        </button>
      </div>
    </div>
  );
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  // A logged-in user landing on /login or /signup (bookmark, shared link,
  // etc) sees an explicit "continue as X, or switch accounts" screen instead
  // of being silently bounced straight to the workspace. Visiting / (Landing)
  // while logged in is still allowed through untouched.
  if (user && (window.location.pathname === '/login' || window.location.pathname === '/signup')) return <AlreadySignedIn />;
  return children;
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
              <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
              <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
              <Route path="/dev-unlock" element={<DevUnlock />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/change-password" element={<ProtectedRoute><ForceChangePassword /></ProtectedRoute>} />
              {/* Standalone, no Shell sidebar -- this is meant to be viewed
                  and printed as a clean document, not as an app screen. */}
              <Route path="/reports/:jobId/branded" element={<ProtectedRoute><BrandedReport /></ProtectedRoute>} />
              {/* Public, unauthenticated -- this is the "anyone with the
                  link" view a client with no Reelytic account opens. Must
                  stay outside ProtectedRoute. */}
              <Route path="/share/:token" element={<PublicReport />} />

              <Route element={<ProtectedRoute><Shell /></ProtectedRoute>}>
                <Route path="/reels" element={<ReelReport />} />
                <Route path="/profiles" element={<ProfileReport />} />
                <Route path="/history" element={<History />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/how-it-works" element={<HowItsCalculated />} />
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                <Route path="/admin/clients" element={<Clients />} />
                <Route path="/admin/cost-monitor" element={<CostMonitor />} />
                <Route path="/admin/scan-settings" element={<ScanSettings />} />
                <Route path="/admin/profile-methodology" element={<ProfileMethodology />} />
                <Route path="/admin/ledger" element={<Ledger />} />
                <Route path="/admin/sessions" element={<SessionsLog />} />
                <Route path="/admin/usage" element={<UsageSpend />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/billing" element={<BillingPlans />} />
                <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
                <Route path="/admin/pricing" element={<ProtectedRoute><AdminPricingEditor /></ProtectedRoute>} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
