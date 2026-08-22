import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';

/*
  Every routed page below is lazy -- before this, a single JS bundle held
  every page in the app (every admin screen, every report type, settings,
  billing, the whole thing) and every visitor downloaded and parsed all of
  it before the FIRST page could render, landing page included. Vite's build
  was warning about this on every build ("chunks larger than 500 kB") and
  nobody was acting on it.

  Split per-route, a first-time visitor hitting the landing page now only
  ever downloads Landing's own code (plus the shared React/router runtime
  chunk); the admin dashboard, the report engines, settings, billing --
  everything else -- only loads the moment someone actually navigates there.
  That's the single highest-leverage change available for "loads fast the
  moment someone hits the site": it's not a build tweak, it's not downloading
  less of the same thing, it's not downloading the other 90% of the app at
  all until it's needed.

  Named exports (not default), so each entry adapts .then(m => ({ default:
  m.X })) -- React.lazy only accepts a module with a default export.
*/
const Landing = lazy(() => import('./pages/Landing').then(m => ({ default: m.Landing })));
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Signup = lazy(() => import('./pages/Signup').then(m => ({ default: m.Signup })));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword').then(m => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/ResetPassword').then(m => ({ default: m.ResetPassword })));
const ForceChangePassword = lazy(() => import('./pages/ForceChangePassword').then(m => ({ default: m.ForceChangePassword })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const HowItsCalculated = lazy(() => import('./pages/HowItsCalculated').then(m => ({ default: m.HowItsCalculated })));
const ReelReport = lazy(() => import('./pages/ReelReport').then(m => ({ default: m.ReelReport })));
const ProfileReport = lazy(() => import('./pages/ProfileReport').then(m => ({ default: m.ProfileReport })));
const History = lazy(() => import('./pages/History').then(m => ({ default: m.History })));

const DevUnlock = lazy(() => import('./pages/admin/DevUnlock').then(m => ({ default: m.DevUnlock })));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const Clients = lazy(() => import('./pages/admin/Clients').then(m => ({ default: m.Clients })));
const Ledger = lazy(() => import('./pages/admin/Ledger').then(m => ({ default: m.Ledger })));
const SessionsLog = lazy(() => import('./pages/admin/SessionsLog').then(m => ({ default: m.SessionsLog })));
const UsageSpend = lazy(() => import('./pages/admin/UsageSpend').then(m => ({ default: m.UsageSpend })));
const Health = lazy(() => import('./pages/admin/Health').then(m => ({ default: m.Health })));
const AdminPricingEditor = lazy(() => import('./pages/admin/AdminPricingEditor').then(m => ({ default: m.AdminPricingEditor })));
const CostMonitor = lazy(() => import('./pages/admin/CostMonitor').then(m => ({ default: m.CostMonitor })));
const ScanSettings = lazy(() => import('./pages/admin/ScanSettings').then(m => ({ default: m.ScanSettings })));
const ProfileMethodology = lazy(() => import('./pages/admin/ProfileMethodology').then(m => ({ default: m.ProfileMethodology })));
const LegalEditor = lazy(() => import('./pages/admin/LegalEditor').then(m => ({ default: m.LegalEditor })));

const Legal = lazy(() => import('./pages/Legal').then(m => ({ default: m.Legal })));
const Pricing = lazy(() => import('./pages/Pricing').then(m => ({ default: m.Pricing })));
const BillingPlans = lazy(() => import('./pages/BillingPlans').then(m => ({ default: m.BillingPlans })));
const Checkout = lazy(() => import('./pages/Checkout').then(m => ({ default: m.Checkout })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const BrandedReport = lazy(() => import('./pages/BrandedReport').then(m => ({ default: m.BrandedReport })));
const PublicReport = lazy(() => import('./pages/PublicReport').then(m => ({ default: m.PublicReport })));

// Not lazy: Shell is the layout every protected route mounts into (lazy-
// loading it would just move the waterfall one level up, not remove it),
// NotFound is trivially small, and BrandLoader IS the Suspense fallback --
// it has to already be in the initial bundle to show anything while other
// chunks are still loading.
import { Shell } from './components/Shell';
import { NotFound } from './components/NotFound';
import { BrandLoader } from './components/BrandLoader';
import './styles/base.css';
import './styles/components.css';
import './styles/mobile.css';
import { DemoGuide } from './components/DemoGuide';

/*
  Renders the guided tour only for a signed-in user, and keys its progress to
  that user's name so two accounts sharing one browser never inherit each
  other's position in the tour.
*/
// Public pages the tour must never appear over, even for a signed-in user:
// landing, pricing, and the "you're signed in as X, switch account?" screen
// that /login shows. Being logged in is not enough on its own -- that is how
// a half-finished tour ended up floating over the login form.
const NO_TOUR_ROUTES = ['/', '/login', '/signup', '/pricing', '/change-password', '/terms', '/privacy', '/forgot-password', '/reset-password'];

function TourHost() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  if (loading || !user) return null;
  if (NO_TOUR_ROUTES.includes(pathname) || pathname.startsWith('/share/')) return null;
  return <DemoGuide username={user.username} />;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  // Was `return null`, which meant a blank screen for the length of the
  // /auth/me round trip -- right after the boot splash faded, so it read as
  // the app failing to load rather than still working.
  if (loading) return <BrandLoader variant="full" message="Loading your workspace..." />;
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
  const displayName = user?.username;

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
  if (loading) return <BrandLoader variant="full" message="Loading your workspace..." />;
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
            <Suspense fallback={<BrandLoader variant="full" message="Loading..." />}>
              <Routes>
                <Route path="/" element={<PublicRoute><Landing /></PublicRoute>} />
                <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
                <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/dev-unlock" element={<DevUnlock />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/terms" element={<Legal type="terms" />} />
                <Route path="/privacy" element={<Legal type="privacy" />} />
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
                  <Route path="/admin/legal" element={<LegalEditor />} />
                  <Route path="/admin/ledger" element={<Ledger />} />
                  <Route path="/admin/sessions" element={<SessionsLog />} />
                  <Route path="/admin/usage" element={<UsageSpend />} />
                  <Route path="/admin/health" element={<Health />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/billing" element={<BillingPlans />} />
                  <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
                  <Route path="/admin/pricing" element={<ProtectedRoute><AdminPricingEditor /></ProtectedRoute>} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            {/* Inside the router because the tour spans the results page
                (in Shell) and the branded report (standalone), so it cannot
                live in either. Gated on being signed in because it used to
                render on /login too: tour state lives in localStorage, which
                is per browser rather than per account, so switching accounts
                floated a half-finished tour over the login form. */}
            <TourHost />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default App;
