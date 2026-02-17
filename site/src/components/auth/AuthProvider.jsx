import React, { createContext, useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const token = localStorage.getItem('fg_access_token');
    if (token) {
      // Decode JWT payload (no verification needed client-side)
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 > Date.now()) {
          setUser({ id: payload.userId, email: payload.email });
        } else {
          // Try refresh
          api.refreshToken().then((refreshed) => {
            if (refreshed) {
              const newToken = localStorage.getItem('fg_access_token');
              const newPayload = JSON.parse(atob(newToken.split('.')[1]));
              setUser({ id: newPayload.userId, email: newPayload.email });
            }
          });
        }
      } catch {
        api.clearTokens();
      }
    }
    setLoading(false);
  }, []);

  // Listen for forced logout events
  useEffect(() => {
    const handleLogout = () => {
      setUser(null);
    };
    window.addEventListener('auth:logout', handleLogout);
    return () => window.removeEventListener('auth:logout', handleLogout);
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.login(email, password);
    setUser(data.user);
    return data;
  }, []);

  const register = useCallback(async (email, password, displayName) => {
    const data = await api.register(email, password, displayName);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(() => {
    api.logout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}
