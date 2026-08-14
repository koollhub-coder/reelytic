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

  const login = async (username, password) => {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setUser(data.user);
    return data.user;
  };

  const signup = async ({ email, password, username }) => {
    const data = await apiFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, username })
    });
    setUser(data.user);
    return data.user;
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
    <AuthContext.Provider value={{ user, login, signup, googleLogin, logout, refreshUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
