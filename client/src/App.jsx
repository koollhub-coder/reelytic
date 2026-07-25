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
import { ApifySpend } from './pages/admin/ApifySpend';
import { Pricing } from './pages/Pricing';
import { Checkout } from './pages/Checkout';
import { AdminPricingEditor } from './pages/admin/AdminPricingEditor';
import { CostMonitor } from './pages/admin/CostMonitor';
import { Dashboard } from './pages/Dashboard';
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

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  // If user is logged in and visits /login, redirect to /reels. But visiting / (Landing) is allowed while logged in!
  if (user && (window.location.pathname === '/login' || window.location.pathname === '/signup')) return <Navigate to="/reels" replace />;
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

              <Route element={<ProtectedRoute><Shell /></ProtectedRoute>}>
                <Route path="/reels" element={<ReelReport />} />
                <Route path="/profiles" element={<ProfileReport />} />
                <Route path="/history" element={<History />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/admin/dashboard" element={<AdminDashboard />} />
                <Route path="/admin/clients" element={<Clients />} />
                <Route path="/admin/cost-monitor" element={<CostMonitor />} />
                <Route path="/admin/ledger" element={<Ledger />} />
                <Route path="/admin/sessions" element={<SessionsLog />} />
                <Route path="/admin/apify-usage" element={<ApifySpend />} />
                <Route path="/dashboard" element={<Dashboard />} />
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
