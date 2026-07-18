import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setAuthToken, getAuthToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api.me().then(u => {
      setUser(u);
    }).catch(() => {
      setAuthToken(null);
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api.login(username, password);
    if (data.token) setAuthToken(data.token);
    const u = data.user || data;
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch {}
    setAuthToken(null);
    setUser(null);
  }, []);

  const hasRole = (...roles) => user && roles.includes(user.role);
  const hasDept = (...depts) => user && depts.includes(user.department);

  const saveData = useCallback(async (data) => {
    try {
      await fetch('/api/data/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify(data),
        credentials: 'same-origin',
      });
    } catch {}
  }, []);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/data/load', {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
        credentials: 'same-origin',
      });
      if (res.ok) return await res.json();
    } catch {}
    return null;
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, hasRole, hasDept, saveData, loadData }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
