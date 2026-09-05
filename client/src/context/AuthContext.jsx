import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/auth/me')
      .then(data => {
        setUser(data.user);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const login = async (username, password, rememberMe) => {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, rememberMe })
    });
    setUser(data.user);
    return data.user;
  };

  // Returns { pendingVerification: true, username, email } now instead of a
  // user -- signup no longer starts a session by itself. verifyOtp below is
  // what actually logs the new account in, once they've proven the email is
  // theirs.
  const signup = async ({ email, password, username, acceptedTerms }) => {
    const data = await apiFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, username, acceptedTerms })
    });
    return data;
  };

  const verifyOtp = async (username, code) => {
    const data = await apiFetch('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ username, code })
    });
    setUser(data.user);
    return data.user;
  };

  // Same effect as verifyOtp above (flips emailVerified, starts the
  // session), reached from the "Verify email" link in the OTP email instead
  // of the typed code -- see VerifyEmailLink.jsx and auth.routes.js's
  // POST /verify-otp-link for why this is a page making its own POST rather
  // than the email link hitting a GET endpoint directly.
  const verifyOtpLink = async (username, token) => {
    const data = await apiFetch('/auth/verify-otp-link', {
      method: 'POST',
      body: JSON.stringify({ username, token })
    });
    setUser(data.user);
    return data.user;
  };

  const resendOtp = async (username) => {
    return apiFetch('/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify({ username })
    });
  };

  // Always resolves { sent: true } regardless of whether the email has an
  // account -- see auth.routes.js POST /forgot-password for why. No user
  // state changes here; the reset itself only happens once someone clicks
  // the emailed link and lands on resetPassword below.
  const forgotPassword = async (email) => {
    return apiFetch('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
  };

  // Read-only check used by ResetPassword.jsx to show "link invalid/expired"
  // immediately on page load, before the person has typed anything -- does
  // NOT consume the token (see peekResetToken's own note server-side).
  const checkResetToken = async (token) => {
    return apiFetch(`/auth/reset-password/${encodeURIComponent(token)}`);
  };

  const resetPassword = async (token, newPassword) => {
    return apiFetch('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword })
    });
  };

  // credential = real Google ID token; { email, name } = dummy-mode fallback.
  const googleLogin = async (payload) => {
    const data = await apiFetch('/auth/google', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setUser(data.user);
    return data.user;
  };

  // Deliberately does NOT call setUser(null) before navigating. Doing so used
  // to trigger an SPA re-render mid-logout: ProtectedRoute would see user go
  // null and instantly client-side-navigate to /login for a frame, before the
  // hard window.location.href redirect below finished landing on its real
  // target -- a visible login-page flash on every logout. The hard navigation
  // remounts the whole app anyway, which re-checks /auth/me and lands on
  // "logged out" cleanly, so the extra state update was redundant as well as
  // buggy.
  const logout = async (redirectTo = '/') => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => { });
    window.location.href = redirectTo;
  };

  const refreshUser = async () => {
    try {
      const data = await apiFetch('/auth/me');
      setUser(data.user);
    } catch (e) {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, signup, verifyOtp, verifyOtpLink, resendOtp, forgotPassword, checkResetToken, resetPassword, googleLogin, logout, refreshUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
