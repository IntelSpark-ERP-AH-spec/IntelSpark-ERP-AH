import { useEffect, useRef, useState, useCallback } from 'react';
import { getApiRoot, getAuthToken, getCsrfToken } from './api';

function authHeaders(method = 'GET') {
  const headers = { Authorization: `Bearer ${getAuthToken()}` };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers['Content-Type'] = 'application/json';
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  return headers;
}

function apiCredentials() {
  return getApiRoot().startsWith('http') ? 'include' : 'same-origin';
}

/**
 * Hook de persistance automatique côté serveur pour des données spécifiques à l'utilisateur.
 * - Charge la donnée depuis /api/data/doc/:key au montage
 * - Sauvegarde AUTOMATIQUEMENT sur le serveur à chaque changement (debounce 250ms)
 * - Pas de localStorage : les données sont isolées par utilisateur mais survivent aux changements de session
 * - Upsert atomique par clé : pas de collision entre pages qui écrivent en parallèle
 *
 * @param {string} key    - Clé de stockage (ex: 'rh_relations_instances')
 * @param {any}    initial - Valeur initiale si rien en base
 */
export function useUserDoc(key, initial) {
  const [data, setData]       = useState(initial);
  const [loaded, setLoaded]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const timeoutRef            = useRef(null);
  const lastSavedRef          = useRef(null);
  const dataRef               = useRef(data);
  const keyRef                = useRef(key);
  const savingRef             = useRef(false);
  const deferredReloadRef     = useRef(false);

  useEffect(() => { keyRef.current = key; }, [key]);
  // Keep latest draft visible to stable organization-change listener.
  useEffect(() => { dataRef.current = data; }, [data]);

  // ── Chargement initial ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    if (!getAuthToken()) {
      setLoaded(true);
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const res = await fetch(`${getApiRoot()}/data/doc/` + encodeURIComponent(key), {
          credentials: apiCredentials(),
          headers: authHeaders('GET'),
        });
        if (cancelled) return;
        if (res.ok) {
          const stored = await res.json();
          if (stored !== null && stored !== undefined) {
            setData(stored);
            lastSavedRef.current = JSON.stringify(stored);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [key]);

  useEffect(() => {
    let cancelled = false;
    const reload = async (event) => {
      const change = event?.detail || {};
      if (change.entity && change.entity !== 'organization_documents') return;
      if (change.key && change.key !== keyRef.current
        && !(Array.isArray(change.keys) && change.keys.includes(keyRef.current))) return;
      if (savingRef.current) {
        deferredReloadRef.current = true;
        return;
      }
      // A different page/device may announce a change while this document has
      // a debounce timer pending. Do not replace that local draft with the
      // older server value; the successful PUT will trigger a deferred reload
      // once the local value is safely persisted.
      if (lastSavedRef.current !== null
        && JSON.stringify(dataRef.current) !== lastSavedRef.current) {
        deferredReloadRef.current = true;
        return;
      }
      if (!getAuthToken()) return;
      try {
        const res = await fetch(`${getApiRoot()}/data/doc/` + encodeURIComponent(keyRef.current), {
          credentials: apiCredentials(), headers: authHeaders('GET'),
        });
        if (!cancelled && res.ok) {
          const stored = await res.json();
          if (stored !== null && stored !== undefined) {
            lastSavedRef.current = JSON.stringify(stored);
            setData(stored);
          }
        }
      } catch (e) { if (!cancelled) setError(e.message); }
    };
    window.addEventListener('organization:changed', reload);
    return () => { cancelled = true; window.removeEventListener('organization:changed', reload); };
  }, [key]);

  // ── Sauvegarde atomique debouncée ─────────────────────────────────────────
  const persist = useCallback(async (value, k) => {
    if (!getAuthToken()) return;
    const keyName = k || keyRef.current;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    let persisted = false;
    try {
      const res = await fetch(`${getApiRoot()}/data/doc/` + encodeURIComponent(keyName), {
        method: 'PUT',
        headers: authHeaders('PUT'),
        credentials: apiCredentials(),
        keepalive: true,
        body: JSON.stringify(value),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'HTTP ' + res.status);
      }
      lastSavedRef.current = JSON.stringify(value);
      persisted = true;
    } catch (e) {
      setError(e.message);
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (deferredReloadRef.current) {
        deferredReloadRef.current = false;
        if (persisted) window.dispatchEvent(new CustomEvent('organization:changed', { detail: { deferred: true } }));
      }
    }
  }, []);

  // ── Effet : à chaque changement de data, planifie une sauvegarde ─────────
  useEffect(() => {
    if (!loaded) return;
    const serialized = JSON.stringify(data);
    if (serialized === lastSavedRef.current) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      persist(data, keyRef.current);
    }, 80);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [data, loaded, persist]);

  const update = useCallback((updater) => {
    setData(prev => typeof updater === 'function' ? updater(prev) : updater);
  }, []);

  const remove = useCallback(async () => {
    try {
      await fetch(`${getApiRoot()}/data/doc/` + encodeURIComponent(keyRef.current), {
        method: 'DELETE',
        headers: authHeaders('DELETE'),
        credentials: apiCredentials(),
      });
      setData(initial);
      lastSavedRef.current = JSON.stringify(initial);
    } catch (e) { setError(e.message); }
  }, [initial]);

  return { data, setData: update, loaded, saving, error, remove };
}
