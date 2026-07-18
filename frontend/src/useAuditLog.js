import { useCallback } from 'react';

/**
 * useAuditLog : permet d'enregistrer automatiquement des actions RH
 * dans les Documents Sauvegardés de la session courante (par utilisateur).
 *
 * Chaque appel à log() crée une entrée dans savedDocs :
 *   { id, type, number, client, date, status, currency, totalHT, totalTTC, totalTVA, source }
 *
 * Le format est compatible avec la page "Documents sauvegardés".
 */
export function useAuditLog(setSavedDocs) {
  const log = useCallback((action) => {
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
      id,
      type, number, client, date, status, currency,
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

  return { log };
}
