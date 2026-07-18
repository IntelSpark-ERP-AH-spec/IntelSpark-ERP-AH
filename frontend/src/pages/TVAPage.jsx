import { useState } from 'react';
import { useUserDoc } from '../useUserDoc';
import { useAuth } from '../AuthContext';

const TAUX_TVA = [
  { taux: 20, label: '20 % — Taux normal', comptes: '4455 (Facturée) / 3455 (Récupérable)', suspense: '445600 / 345600', couleur: '#dc2626' },
  { taux: 14, label: '14 % — Transports, électricité', comptes: '4455 / 3455 (sous-comptes dédiés)', suspense: '445600 / 345600', couleur: '#f59e0b' },
  { taux: 10, label: '10 % — Hôtellerie, restauration, avocats', comptes: '4455 / 3455 (sous-comptes dédiés)', suspense: '445600 / 345600', couleur: '#3b82f6' },
  { taux: 7,  label: '7 % — Eau, produits pharmaceutiques', comptes: '4455 / 3455 (sous-comptes dédiés)', suspense: '445600 / 345600', couleur: '#10b981' },
];

const SEUIL_CA = 1_000_000;

export default function TVAPage({ showMsg }) {
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'comptable');

  const doc = useUserDoc('tva_config', { regime: 'encaissements', periodicite: 'trimestrielle', ca_annuel: 0 });
  const config = doc.data;
  const setConfig = doc.setData;

  const [showFormCA, setShowFormCA] = useState(false);
  const [caInput, setCaInput] = useState(String(config.ca_annuel || ''));

  const alerteCA = config.ca_annuel >= SEUIL_CA;

  function updateRegime(val) {
    setConfig({ ...config, regime: val });
  }

  function updatePeriodicite(val) {
    setConfig({ ...config, periodicite: val });
  }

  function saveCA() {
    const val = Number(caInput) || 0;
    setConfig({ ...config, ca_annuel: val });
    setShowFormCA(false);
  }

  return (
    <div>
      {/* Régime Fiscal */}
      <div className="no-print" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 8 }}>🏛️ Régime Fiscal</div>
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ fontWeight: 800, fontSize: 12, color: '#0f766e', marginBottom: 4 }}>🧠 Logique comptable — Régime des Débits</div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
            <li><strong>Journal de Ventes :</strong> Dès qu'une facture de vente est enregistrée, l'IA calcule la TVA et l'ajoute immédiatement au compte définitif <strong>4455</strong> (TVA facturée).</li>
            <li>La TVA est incluse dans la déclaration du mois en cours, sans attendre l'encaissement.</li>
            <li><strong>Indépendance :</strong> Même si le client ne paie que dans 3 mois, la TVA est due immédiatement à l'État.</li>
          </ul>
        </div>
      </div>

      {/* Périodicité + Alerte CA */}
      <div className="no-print" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 8 }}>📅 Périodicité de Déclaration</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={config.periodicite} onChange={e => updatePeriodicite(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#fff', outline: 'none', width: 180 }}>
            <option value="mensuelle">Mensuelle</option>
            <option value="trimestrielle">Trimestrielle</option>
          </select>
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Chiffre d'affaires annuel :</span>
          {showFormCA ? (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={caInput} onChange={e => setCaInput(e.target.value)} type="number"
                style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, width: 140, outline: 'none' }} />
              <span style={{ fontSize: 12, color: '#64748b' }}>DH</span>
              <button onClick={saveCA}
                style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>OK</button>
              <button onClick={() => setShowFormCA(false)}
                style={{ background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: 5, padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Annuler</button>
            </span>
          ) : (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <strong style={{ fontSize: 14, color: '#0f766e' }}>{Number(config.ca_annuel || 0).toLocaleString('fr-FR')} DH</strong>
              {canEdit && (
                <button onClick={() => { setCaInput(String(config.ca_annuel || '')); setShowFormCA(true); }}
                  style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>
                  ✏️ Modifier
                </button>
              )}
            </span>
          )}
        </div>

        {alerteCA && (
          <div style={{ marginTop: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>🚨</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 12, color: '#dc2626' }}>Alerte conformité</div>
              <div style={{ fontSize: 11, color: '#b91c1c' }}>
                Le chiffre d'affaires ({Number(config.ca_annuel).toLocaleString('fr-FR')} DH) a dépassé le seuil légal de {SEUIL_CA.toLocaleString('fr-FR')} DH. La déclaration de TVA doit obligatoirement passer au régime mensuel.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tableau des Taux */}
      <div style={{ fontWeight: 800, fontSize: 15, color: '#0f766e', marginBottom: 8 }}>📊 Taux de TVA Marocains</div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              {['Taux', 'Libellé', 'Comptes définitifs'].concat(config.regime === 'encaissements' ? ['Comptes d\'attente (Encaissements)'] : []).map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '9px 14px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 800, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TAUX_TVA.map(t => (
              <tr key={t.taux} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 14px' }}>
                  <span style={{ background: `${t.couleur}20`, color: t.couleur, padding: '4px 12px', borderRadius: 999, fontWeight: 800, fontSize: 13 }}>
                    {t.taux}%
                  </span>
                </td>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{t.label}</td>
                <td style={{ padding: '10px 14px', fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{t.comptes}</td>
                {config.regime === 'encaissements' && (
                  <td style={{ padding: '10px 14px', fontSize: 11, color: '#d97706', fontFamily: 'monospace', fontWeight: 600 }}>
                    {t.suspense}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Info complémentaire */}
      <div style={{ marginTop: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 12, color: '#16a34a', marginBottom: 4 }}>✅ Régime configuré</div>
        <div style={{ fontSize: 12, color: '#475569' }}>
          Régime : <strong>{config.regime === 'encaissements' ? 'Encaissements' : 'Débits'}</strong>
          {' · '}Périodicité : <strong>{config.periodicite}</strong>
          {' · '}CA annuel : <strong>{Number(config.ca_annuel).toLocaleString('fr-FR')} DH</strong>
        </div>
      </div>
    </div>
  );
}