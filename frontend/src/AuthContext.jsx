import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, setAuthToken, getAuthToken } from './api';
import { subscribeOrganization } from './supabaseRealtime';

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
  const [organization, setOrganization] = useState(null);
  const [realtimeStatus, setRealtimeStatus] = useState('idle');
  const [realtimeRevision, setRealtimeRevision] = useState(0);
  const [syncError, setSyncError] = useState(null);
  const activeWritesRef = useRef(0);
  const deferredRealtimeRef = useRef(null);

  const emitOrganizationChange = useCallback((payload = {}) => {
    setRealtimeRevision(value => value + 1);
    window.dispatchEvent(new CustomEvent('organization:changed', { detail: payload }));
  }, []);

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

  useEffect(() => {
    if (!user || !getAuthToken()) {
      setOrganization(null);
      setRealtimeStatus('idle');
      return undefined;
    }
    let unsubscribe = () => {};
    let cancelled = false;
    api.request('/data/context').then(context => {
      if (cancelled) return;
      setOrganization(context);
      setSyncError(null);
      unsubscribe = subscribeOrganization(context.realtime_topic, payload => {
        if (activeWritesRef.current > 0) {
          deferredRealtimeRef.current = payload;
          return;
        }
        emitOrganizationChange(payload);
      }, setRealtimeStatus);
    }).catch(error => {
      if (!cancelled) setSyncError(error.message || 'Synchronisation indisponible');
    });
    return () => { cancelled = true; unsubscribe(); };
  }, [user?.id, user?.organization_id, emitOrganizationChange]);

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
  }, [user?.id]);

  const hasRole = (...roles) => user && roles.includes(user.role);
  const hasDept = (...depts) => user && depts.includes(user.department);

  const saveData = useCallback(async (data) => {
    activeWritesRef.current += 1;
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
    } catch (error) {
      setSyncError(error.message || 'Sauvegarde impossible');
      return false;
    } finally {
      activeWritesRef.current = Math.max(0, activeWritesRef.current - 1);
      if (activeWritesRef.current === 0 && deferredRealtimeRef.current) {
        const payload = deferredRealtimeRef.current;
        deferredRealtimeRef.current = null;
        window.setTimeout(() => emitOrganizationChange(payload), 0);
      }
    }
  }, [emitOrganizationChange]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/data/load', {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` },
        credentials: 'same-origin',
      });
      if (res.ok) {
        setSyncError(null);
        return await restoreLargeEntries(await res.json());
      }
      throw new Error('Chargement partagé impossible');
    } catch (error) { setSyncError(error.message || 'Chargement partagé impossible'); }
    return null;
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, hasRole, hasDept, saveData, loadData, organization, realtimeStatus, realtimeRevision, syncError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
