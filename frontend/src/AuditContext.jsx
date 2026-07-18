import { createContext, useContext, useCallback, useMemo } from 'react';
import { useUserDoc } from './useUserDoc';
import { useAuth } from './AuthContext';

/**
 * Contexte d'audit : toutes les pages RH (et autres) peuvent appeler
 * useAudit() pour enregistrer automatiquement leurs actions dans
 * la liste "Documents sauvegardés" de la session courante (par utilisateur).
 */
const AuditContext = createContext(null);

export function AuditProvider({ children }) {
  const { user } = useAuth();
  const savedDocsDoc = useUserDoc(`saved_documents_${user?.id || 'anonymous'}`, []);
  const savedDocs = savedDocsDoc.data;
  const setSavedDocs = savedDocsDoc.setData;

  const log = useCallback((action = {}) => {
    const {
      type         = 'Action RH',
      number       = '',
      client       = '',
      date         = new Date().toISOString().slice(0, 10),
      status       = 'valide',
      details      = '',
      totalHT      = 0,
      totalTVA     = 0,
      totalTTC     = 0,
      currency     = '€',
      extra        = {},
    } = action;

    const id = 'LOG-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const entry = {
      id, type, number, client, date, status, currency,
      totalHT: Number(totalHT) || 0,
      totalTVA: Number(totalTVA) || 0,
      totalTTC: Number(totalTTC) || 0,
      description: details,
      source: 'rh_audit',
      ...extra,
    };
    setSavedDocs(prev => [entry, ...(prev || [])]);
    return entry;
  }, [setSavedDocs]);

  const value = useMemo(() => ({ savedDocs, log, setSavedDocs }), [savedDocs, log]);

  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>;
}

export function useAudit() {
  const ctx = useContext(AuditContext);
  if (!ctx) {
    return {
      savedDocs: [],
      log: () => ({ id: 'noop', noop: true }),
      setSavedDocs: () => {},
    };
  }
  return ctx;
}
