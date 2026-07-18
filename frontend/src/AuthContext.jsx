import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setAuthToken, getAuthToken } from './api';

const AuthContext = createContext(null);
const DATA_CHUNK_BYTES = 3 * 1024 * 1024;

function expandLargeEntries(data) {
  const entries = [];
  for (const [key, value] of Object.entries(data || {})) {
    if (key !== 'is_brands' || JSON.stringify(value).length <= DATA_CHUNK_BYTES) {
      entries.push([key, value]);
      continue;
    }
    const chunks = [];
    let current = [];
    let currentSize = 2;
    for (const brand of Array.isArray(value) ? value : []) {
      const brandSize = JSON.stringify(brand).length + 1;
      if (current.length && currentSize + brandSize > DATA_CHUNK_BYTES) {
        chunks.push(current);
        current = [];
        currentSize = 2;
      }
      current.push(brand);
      currentSize += brandSize;
    }
    if (current.length) chunks.push(current);
    chunks.forEach((chunk, index) => entries.push([`is_brands_chunk_${index}`, chunk]));
    entries.push([key, { __chunked: true, count: chunks.length }]);
  }
  return entries;
}

async function restoreLargeEntries(data) {
  const result = { ...(data || {}) };
  const manifest = result.is_brands;
  if (manifest?.__chunked && Number.isInteger(Number(manifest.count))) {
    const brands = [];
    for (let index = 0; index < Number(manifest.count); index += 1) {
      const chunkKey = `is_brands_chunk_${index}`;
      const response = await fetch(`/api/data/doc/${chunkKey}`, {
        headers: { Authorization: `Bearer ${getAuthToken()}` },
        credentials: 'same-origin',
      });
      if (response.ok) {
        const chunk = await response.json();
        if (Array.isArray(chunk)) brands.push(...chunk);
      }
    }
    result.is_brands = brands;
  }
  return result;
}

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
    sessionStorage.removeItem(`is_server_loaded_v3_${u.id}`);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch {}
    if (user?.id) sessionStorage.removeItem(`is_server_loaded_v3_${user.id}`);
    setAuthToken(null);
    setUser(null);
  }, [user?.id]);

  const hasRole = (...roles) => user && roles.includes(user.role);
  const hasDept = (...depts) => user && depts.includes(user.department);

  const saveData = useCallback(async (data) => {
    try {
      const entries = expandLargeEntries(data);
      for (let index = 0; index < entries.length; index += 4) {
        const batch = entries.slice(index, index + 4);
        const results = await Promise.all(batch.map(([key, value]) => api.request(
          `/data/doc/${encodeURIComponent(key)}`,
          { method: 'PUT', body: JSON.stringify(value) },
        ).then(() => true).catch(() => false)));
        if (results.some(result => !result)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/data/load', {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
        credentials: 'same-origin',
      });
      if (res.ok) return await restoreLargeEntries(await res.json());
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
