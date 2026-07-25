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

  const signup = async ({ email, password, name }) => {
    const data = await apiFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name })
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

  const logout = async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => { });
    setUser(null);
    window.location.href = '/';
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
