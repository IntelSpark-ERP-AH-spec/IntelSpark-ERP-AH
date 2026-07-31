import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, setAuthToken, getAuthToken } from './api';
import { subscribeOrganization } from './supabaseRealtime';

const AuthContext = createContext(null);
const DATA_CHUNK_BYTES = 3 * 1024 * 1024;
const LOAD_RETRY_DELAY_MS = 80;
const REALTIME_COALESCE_DELAY_MS = 60;
const WRITE_ECHO_SUPPRESS_MS = 2_500;
const DOC_FETCH_CONCURRENCY = 8;

const wait = delay => new Promise(resolve => window.setTimeout(resolve, delay));

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
    const count = Number(manifest.count);
    const brands = [];
    for (let start = 0; start < count; start += DOC_FETCH_CONCURRENCY) {
      const slice = Array.from(
        { length: Math.min(DOC_FETCH_CONCURRENCY, count - start) },
        (_, offset) => start + offset,
      );
      const chunks = await Promise.all(slice.map(async (index) => {
        const chunkKey = `is_brands_chunk_${index}`;
        const response = await fetch(`/api/data/doc/${chunkKey}`, {
          headers: { Authorization: `Bearer ${getAuthToken()}` },
          credentials: 'same-origin',
        });
        if (!response.ok) return [];
        const chunk = await response.json();
        return Array.isArray(chunk) ? chunk : [];
      }));
      for (const chunk of chunks) brands.push(...chunk);
    }
    result.is_brands = brands;
  }
  return result;
}

function isRetryableError(error) {
  return !error?.status || error.status === 408 || error.status === 429 || error.status >= 500;
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
  const loadRequestRef = useRef(null);
  const lastLoadedDataRef = useRef(null);
  const recentWriteKeysRef = useRef(new Map());
  const lastRealtimePayloadRef = useRef(null);

  const markKeysWritten = useCallback((keys) => {
    const now = Date.now();
    for (const key of keys) recentWriteKeysRef.current.set(String(key), now);
  }, []);

  const shouldIgnoreRealtimeEcho = useCallback((payload = {}) => {
    const now = Date.now();
    for (const [key, writtenAt] of [...recentWriteKeysRef.current.entries()]) {
      if (now - writtenAt > WRITE_ECHO_SUPPRESS_MS) recentWriteKeysRef.current.delete(key);
    }
    const keys = [
      ...(Array.isArray(payload.keys) ? payload.keys : []),
      payload?.key,
    ].map(key => String(key || '')).filter(Boolean);

    if (keys.length) {
      let ignored = 0;
      for (const key of keys) {
        const writtenAt = recentWriteKeysRef.current.get(key);
        if (writtenAt && now - writtenAt <= WRITE_ECHO_SUPPRESS_MS) {
          recentWriteKeysRef.current.delete(key);
          ignored += 1;
        }
      }
      if (ignored > 0 && ignored === keys.length) return true;
      return false;
    }

    if (payload?.entity === 'company_settings') {
      for (const [key, writtenAt] of recentWriteKeysRef.current.entries()) {
        if (!/^is_(company_|footer$|logo$|brands$)/.test(key)) continue;
        if (now - writtenAt <= WRITE_ECHO_SUPPRESS_MS) return true;
      }
    }
    return false;
  }, []);

  const emitOrganizationChange = useCallback((payload = {}) => {
    if (shouldIgnoreRealtimeEcho(payload)) return;
    lastRealtimePayloadRef.current = payload;
    setRealtimeRevision(value => value + 1);
    window.dispatchEvent(new CustomEvent('organization:changed', { detail: payload }));
  }, [shouldIgnoreRealtimeEcho]);

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
    let realtimeTimer = null;
    let latestRealtimePayload = null;
    api.request('/data/context').then(context => {
      if (cancelled) return;
      setOrganization(context);
      setSyncError(null);
      unsubscribe = subscribeOrganization(context.realtime_topic, payload => {
        const nextPayload = payload || {};
        if (activeWritesRef.current > 0) {
          const previous = deferredRealtimeRef.current || {};
          deferredRealtimeRef.current = {
            ...nextPayload,
            keys: [...new Set([
              ...(Array.isArray(previous.keys) ? previous.keys : []),
              previous.key,
              nextPayload.key,
            ].map(key => String(key || '')).filter(Boolean))],
          };
          return;
        }
        latestRealtimePayload = {
          ...nextPayload,
          keys: [...new Set([
            ...(Array.isArray(latestRealtimePayload?.keys) ? latestRealtimePayload.keys : []),
            ...(Array.isArray(nextPayload.keys) ? nextPayload.keys : []),
            nextPayload.key,
          ].map(key => String(key || '')).filter(Boolean))],
        };
        if (realtimeTimer) window.clearTimeout(realtimeTimer);
        realtimeTimer = window.setTimeout(() => {
          realtimeTimer = null;
          const merged = latestRealtimePayload || {};
          latestRealtimePayload = null;
          emitOrganizationChange(merged);
        }, REALTIME_COALESCE_DELAY_MS);
      }, setRealtimeStatus);
    }).catch(error => {
      if (!cancelled) setSyncError(error.message || 'Synchronisation indisponible');
    });
    return () => {
      cancelled = true;
      if (realtimeTimer) window.clearTimeout(realtimeTimer);
      unsubscribe();
    };
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
      if (!entries.length) return true;
      const payload = Object.fromEntries(entries);
      markKeysWritten(Object.keys(payload));

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await api.request('/data/save', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          setSyncError(null);
          return true;
        } catch (error) {
          if (!isRetryableError(error) || attempt === 1) {
            setSyncError(error.message || 'Sauvegarde impossible');
            return false;
          }
          await wait(LOAD_RETRY_DELAY_MS);
        }
      }
      return false;
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
  }, [emitOrganizationChange, markKeysWritten]);

  const saveCompanyData = useCallback(async (scope, data) => {
    activeWritesRef.current += 1;
    try {
      markKeysWritten(Object.keys(data || {}));
      const result = await api.request(`/data/company-settings/${encodeURIComponent(scope)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      setSyncError(null);
      return result.settings || {};
    } catch (error) {
      setSyncError(error.message || 'Sauvegarde entreprise impossible');
      throw error;
    } finally {
      activeWritesRef.current = Math.max(0, activeWritesRef.current - 1);
      if (activeWritesRef.current === 0 && deferredRealtimeRef.current) {
        const payload = deferredRealtimeRef.current;
        deferredRealtimeRef.current = null;
        window.setTimeout(() => emitOrganizationChange(payload), 0);
      }
    }
  }, [emitOrganizationChange, markKeysWritten]);

  const loadData = useCallback((options = {}) => {
    const background = options?.background === true;
    if (loadRequestRef.current) return loadRequestRef.current;

    const request = (async () => {
      let lastError = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const data = await restoreLargeEntries(await api.request('/data/load'));
          lastLoadedDataRef.current = data;
          setSyncError(null);
          return data;
        } catch (error) {
          lastError = error;
          if (!isRetryableError(error) || attempt === 1) break;
          await wait(LOAD_RETRY_DELAY_MS);
        }
      }

      // Realtime and focus refreshes are opportunistic. Keep the last valid
      // snapshot without flashing an error for a short network interruption.
      if (!background) setSyncError(lastError?.message || 'Synchronisation temporairement indisponible');
      return lastLoadedDataRef.current;
    })();

    loadRequestRef.current = request.finally(() => {
      loadRequestRef.current = null;
    });
    return loadRequestRef.current;
  }, []);

  const loadDocsByKeys = useCallback(async (keys = []) => {
    const uniqueKeys = [...new Set(keys.map(key => String(key || '')).filter(Boolean))];
    if (!uniqueKeys.length) return null;
    const result = {};
    for (let start = 0; start < uniqueKeys.length; start += DOC_FETCH_CONCURRENCY) {
      const slice = uniqueKeys.slice(start, start + DOC_FETCH_CONCURRENCY);
      await Promise.all(slice.map(async (key) => {
        try {
          const value = await api.request(`/data/doc/${encodeURIComponent(key)}`);
          result[key] = value;
        } catch {
          // Keep existing local value when a single key refresh fails.
        }
      }));
    }
    return result;
  }, []);

  return (
    <AuthContext.Provider value={{
      user, login, logout, loading, hasRole, hasDept,
      saveData, saveCompanyData, loadData, loadDocsByKeys,
      organization, realtimeStatus, realtimeRevision, syncError,
      lastRealtimePayloadRef,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
