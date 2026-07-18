import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useUserDoc } from '../useUserDoc';

const CODE_JOURNAUX = {
  achats: 'AC',
  vente: 'VT',
  ventes: 'VT',
  banque: 'BQ',
  od: 'OD',
  salaires: 'SL',
  tva: 'TV',
};

export default function GrandLivrePage({ showMsg }) {
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'comptable');

  const now = new Date();
  const [periodeDebut, setPeriodeDebut] = useState(`${now.getFullYear()}-01-01`);
  const [periodeFin, setPeriodeFin] = useState(`${now.getFullYear()}-12-31`);
  const [compteDebut, setCompteDebut] = useState('');
  const [compteFin, setCompteFin] = useState('');

  const pcgeDoc = useUserDoc('pcge_comptes', []);
  const pcgeComptes = pcgeDoc.data || [];

  const [ecritures, setEcritures] = useState([]);
  const [loading, setLoading] = useState(false);

  async function chargerEcritures() {
    setLoading(true);
    try {
      const data = await api.getCompta();
      setEcritures(Array.isArray(data) ? data : []);
    } catch (e) {
      setEcritures([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    chargerEcritures();
  }, []); // une seule fois au montage

  const ecrituresFiltrees = useMemo(() => {
    let filtered = ecritures.filter(e => {
      const d = e.date_operation || '';
      return d >= periodeDebut && d <= periodeFin;
    });
    if (compteDebut) filtered = filtered.filter(e => (e.compte || '') >= compteDebut);
    if (compteFin) filtered = filtered.filter(e => (e.compte || '') <= compteFin);
    return filtered;
  }, [ecritures, periodeDebut, periodeFin, compteDebut, compteFin]);

  const grouped = useMemo(() => {
    const map = new Map();
    const triees = [...ecrituresFiltrees].sort((a, b) => {
      const ca = (a.compte || '').padStart(8, '0');
      const cb = (b.compte || '').padStart(8, '0');
      if (ca !== cb) return ca.localeCompare(cb);
      return (a.date_operation || '').localeCompare(b.date_operation || '');
    });
    triees.forEach(e => {
      const key = e.compte || 'SANS COMPTE';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    });
    return map;
  }, [ecrituresFiltrees]);

  const pcgeMap = useMemo(() => {
    const m = {};
    (pcgeComptes || []).forEach(c => { m[c.numero] = c.intitule; });
    return m;
  }, [pcgeComptes]);

  function compteLabel(numero) {
    const intitule = pcgeMap[numero];
    return intitule ? `Compte ${numero} — ${intitule}` : `Compte ${numero}`;
  }

  function codeJournal(categorie) {
    return CODE_JOURNAUX[categorie?.toLowerCase()] || 'OD';
  }

  function calcSolde(entries) {
    let debit = 0, credit = 0;
    entries.forEach(e => {
      debit += Number(e.debit) || 0;
      credit += Number(e.credit) || 0;
    });
    return { debit, credit, solde: debit - credit };
  }

  function fmt(mt) {
    return (mt || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const totalComptes = grouped.size;
  const totalEcrituresAffichees = ecrituresFiltrees.length;

  return (
    <div>
      {/* Filtres */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>Période</label>
          <input type="date" value={periodeDebut} onChange={e => setPeriodeDebut(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, background: '#fff', outline: 'none' }} />
          <span style={{ color: '#94a3b8' }}>→</span>
          <input type="date" value={periodeFin} onChange={e => setPeriodeFin(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, background: '#fff', outline: 'none' }} />

          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginLeft: 10 }}>Comptes</label>
          <input type="text" value={compteDebut} onChange={e => setCompteDebut(e.target.value)} placeholder="Début (ex: 1111)"
            style={{ width: 100, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', background: '#fff', outline: 'none' }} />
          <span style={{ color: '#94a3b8' }}>→</span>
          <input type="text" value={compteFin} onChange={e => setCompteFin(e.target.value)} placeholder="Fin (ex: 9999)"
            style={{ width: 100, padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontFamily: 'monospace', background: '#fff', outline: 'none' }} />

          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            {loading ? '⏳...' : `${totalComptes} comptes, ${totalEcrituresAffichees} écritures`}
          </span>
        </div>
      </div>

      {/* Tableau du Grand Livre */}
      {totalEcrituresAffichees === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 14 }}>
          Aucune écriture pour cette période et cette fourchette de comptes
        </div>
      )}

      {Array.from(grouped.entries()).map(([compte, entries]) => {
        const s = calcSolde(entries);
        const nature = s.solde >= 0 ? 'Débiteur' : 'Créditeur';
        const isSoldePositif = s.solde >= 0;
        return (
          <div key={compte} style={{ marginBottom: 14, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            {/* En-tête du compte */}
            <div style={{ background: 'linear-gradient(135deg, #0f766e, #0d9488)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: 13 }}>{compteLabel(compte)}</div>
              <div style={{ color: '#ccfbf1', fontSize: 11 }}>
                {entries.length} écriture(s)
              </div>
            </div>

            {/* Lignes */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    {['Date', 'Journal', 'Pièce', 'Libellé', 'Débit (DH)', 'Crédit (DH)'].map((h, i) => (
                      <th key={i} style={{ textAlign: 'left', padding: '7px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 10.5, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={e.id || i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 12px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 11 }}>{e.date_operation || '—'}</td>
                      <td style={{ padding: '6px 12px', fontWeight: 600 }}>{codeJournal(e.categorie)}</td>
                      <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 11 }}>{e.piece || '—'}</td>
                      <td style={{ padding: '6px 12px' }}>{e.description || '—'}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'monospace', color: Number(e.debit) > 0 ? '#991b1b' : 'inherit' }}>{Number(e.debit) > 0 ? fmt(e.debit) : '—'}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right', fontFamily: 'monospace', color: Number(e.credit) > 0 ? '#065f46' : 'inherit' }}>{Number(e.credit) > 0 ? fmt(e.credit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f0fdf4' }}>
                    <td colSpan={4} style={{ padding: '8px 12px', fontWeight: 800, fontSize: 12, color: '#0f766e' }}>
                      SOLDE {nature}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, fontFamily: 'monospace', color: '#991b1b' }}>
                      {fmt(s.debit)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, fontFamily: 'monospace', color: '#065f46' }}>
                      {fmt(s.credit)}
                    </td>
                  </tr>
                  <tr style={{ background: isSoldePositif ? '#ecfdf5' : '#fef2f2' }}>
                    <td colSpan={6} style={{ padding: '8px 12px', fontWeight: 900, fontSize: 13, color: isSoldePositif ? '#065f46' : '#991b1b', textAlign: 'right' }}>
                      Solde {isSoldePositif ? 'Débiteur' : 'Créditeur'} : {fmt(Math.abs(s.solde))} DH
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
