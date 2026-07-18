import { useState, useEffect } from 'react';
import { useUserDoc } from '../useUserDoc';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useAudit } from '../AuditContext';

const DEFAULT_PCGE = [
  // Classe 1 — Financement permanent
  { numero: '1111', intitule: 'Capital social', classe: '1', journal: 'OD' },
  { numero: '1121', intitule: 'Primes d\'émission', classe: '1', journal: 'OD' },
  { numero: '1131', intitule: 'Réserves légales', classe: '1', journal: 'OD' },
  { numero: '1141', intitule: 'Réserves statutaires', classe: '1', journal: 'OD' },
  { numero: '1151', intitule: 'Report à nouveau', classe: '1', journal: 'OD' },
  { numero: '1161', intitule: 'Résultat net', classe: '1', journal: 'OD' },
  { numero: '1311', intitule: 'Subventions d\'investissement', classe: '1', journal: 'OD' },
  { numero: '1411', intitule: 'Emprunts auprès des établissements de crédit', classe: '1', journal: 'Banque' },
  { numero: '1421', intitule: 'Emprunts obligataires', classe: '1', journal: 'Banque' },
  { numero: '1511', intitule: 'Provisions pour risques', classe: '1', journal: 'OD' },
  // Classe 2 — Actif immobilisé
  { numero: '2111', intitule: 'Frais de constitution', classe: '2', journal: 'OD' },
  { numero: '2121', intitule: 'Frais de recherche et développement', classe: '2', journal: 'OD' },
  { numero: '2131', intitule: 'Brevets, licences, marques', classe: '2', journal: 'OD' },
  { numero: '2211', intitule: 'Terrains nus', classe: '2', journal: 'Achats' },
  { numero: '2221', intitule: 'Constructions', classe: '2', journal: 'Achats' },
  { numero: '2231', intitule: 'Installations techniques', classe: '2', journal: 'Achats' },
  { numero: '2241', intitule: 'Matériel et outillage', classe: '2', journal: 'Achats' },
  { numero: '2251', intitule: 'Matériel de transport', classe: '2', journal: 'Achats' },
  { numero: '2261', intitule: 'Mobilier de bureau', classe: '2', journal: 'Achats' },
  { numero: '2271', intitule: 'Matériel informatique', classe: '2', journal: 'Achats' },
  { numero: '2311', intitule: 'Titres de participation', classe: '2', journal: 'OD' },
  { numero: '2411', intitule: 'Prêts au personnel', classe: '2', journal: 'Banque' },
  { numero: '2421', intitule: 'Dépôts et cautionnements', classe: '2', journal: 'Banque' },
  { numero: '2511', intitule: 'Amortissements des immobilisations', classe: '2', journal: 'OD' },
  { numero: '2911', intitule: 'Provisions pour dépréciation des immobilisations', classe: '2', journal: 'OD' },
  // Classe 3 — Actif circulant
  { numero: '3111', intitule: 'Stocks de matières premières', classe: '3', journal: 'Achats' },
  { numero: '3121', intitule: 'Stocks de produits finis', classe: '3', journal: 'OD' },
  { numero: '3131', intitule: 'Stocks de marchandises', classe: '3', journal: 'Achats' },
  { numero: '3141', intitule: 'En-cours de production', classe: '3', journal: 'OD' },
  { numero: '3421', intitule: 'Clients', classe: '3', journal: 'Ventes' },
  { numero: '3425', intitule: 'Clients — Effets à recevoir', classe: '3', journal: 'Ventes' },
  { numero: '3431', intitule: 'Personnel — Avances et acomptes', classe: '3', journal: 'OD' },
  { numero: '3441', intitule: 'État — TVA déductible', classe: '3', journal: 'Achats' },
  { numero: '3451', intitule: 'État — TVA due', classe: '3', journal: 'Ventes' },
  { numero: '3461', intitule: 'Autres débiteurs', classe: '3', journal: 'OD' },
  { numero: '3481', intitule: 'Comptes de régularisation — Actif', classe: '3', journal: 'OD' },
  { numero: '3491', intitule: 'Provisions pour dépréciation des comptes clients', classe: '3', journal: 'OD' },
  // Classe 4 — Passif circulant
  { numero: '4411', intitule: 'Fournisseurs', classe: '4', journal: 'Achats' },
  { numero: '4415', intitule: 'Fournisseurs — Effets à payer', classe: '4', journal: 'Achats' },
  { numero: '4421', intitule: 'Personnel — Rémunérations dues', classe: '4', journal: 'OD' },
  { numero: '4431', intitule: 'Organismes sociaux', classe: '4', journal: 'OD' },
  { numero: '4441', intitule: 'État — Impôts et taxes', classe: '4', journal: 'OD' },
  { numero: '4451', intitule: 'État — TVA collectée', classe: '4', journal: 'Ventes' },
  { numero: '4461', intitule: 'Autres créditeurs', classe: '4', journal: 'OD' },
  { numero: '4471', intitule: 'Comptes courants d\'associés', classe: '4', journal: 'OD' },
  { numero: '4481', intitule: 'Comptes de régularisation — Passif', classe: '4', journal: 'OD' },
  // Classe 5 — Trésorerie
  { numero: '5111', intitule: 'Banque (compte courant)', classe: '5', journal: 'Banque' },
  { numero: '5121', intitule: 'Caisse', classe: '5', journal: 'Banque' },
  { numero: '5131', intitule: 'Chèques postaux', classe: '5', journal: 'Banque' },
  { numero: '5141', intitule: 'Virements internes', classe: '5', journal: 'Banque' },
  { numero: '5161', intitule: 'Titres de placement', classe: '5', journal: 'Banque' },
  // Classe 6 — Charges
  { numero: '6111', intitule: 'Achats de matières premières', classe: '6', journal: 'Achats' },
  { numero: '6121', intitule: 'Achats de fournitures consommables', classe: '6', journal: 'Achats' },
  { numero: '6125', intitule: 'Achats non stockables (eau, électricité)', classe: '6', journal: 'Achats' },
  { numero: '6131', intitule: 'Services extérieurs (locations, entretien)', classe: '6', journal: 'Achats' },
  { numero: '6136', intitule: 'Honoraires', classe: '6', journal: 'Achats' },
  { numero: '6141', intitule: 'Impôts et taxes', classe: '6', journal: 'OD' },
  { numero: '6161', intitule: 'Charges de personnel', classe: '6', journal: 'OD' },
  { numero: '6171', intitule: 'Charges financières (intérêts)', classe: '6', journal: 'Banque' },
  { numero: '6181', intitule: 'Dotations aux amortissements', classe: '6', journal: 'OD' },
  { numero: '6191', intitule: 'Dotations aux provisions', classe: '6', journal: 'OD' },
  // Classe 7 — Produits
  { numero: '7111', intitule: 'Ventes de produits finis', classe: '7', journal: 'Ventes' },
  { numero: '7121', intitule: 'Ventes de marchandises', classe: '7', journal: 'Ventes' },
  { numero: '7131', intitule: 'Prestations de services', classe: '7', journal: 'Ventes' },
  { numero: '7141', intitule: 'Produits accessoires', classe: '7', journal: 'Ventes' },
  { numero: '7161', intitule: 'Produits financiers', classe: '7', journal: 'Banque' },
  { numero: '7181', intitule: 'Reprises sur provisions', classe: '7', journal: 'OD' },
];

const CLASSES = [
  { id: '1', label: 'Classe 1 — Financement permanent', color: '#0f766e' },
  { id: '2', label: 'Classe 2 — Actif immobilisé',      color: '#3b82f6' },
  { id: '3', label: 'Classe 3 — Actif circulant',       color: '#8b5cf6' },
  { id: '4', label: 'Classe 4 — Passif circulant',      color: '#f59e0b' },
  { id: '5', label: 'Classe 5 — Trésorerie',            color: '#10b981' },
  { id: '6', label: 'Classe 6 — Charges',               color: '#dc2626' },
  { id: '7', label: 'Classe 7 — Produits',              color: '#16a34a' },
];

const inp = { padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' };

export default function PCGE({ showMsg }) {
  const { hasRole } = useAuth();
  const { log: logAudit } = useAudit();
  const canEdit = hasRole('admin', 'comptable');
  const canDelete = hasRole('admin');

  const doc = useUserDoc('pcge_comptes', DEFAULT_PCGE);
  const comptes = doc.data;
  const setComptes = doc.setData;

  const [filterClasse, setFilterClasse] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ numero: '', intitule: '', classe: '6', journal: 'Achats' });

  function notify(msg, type = 'success') { showMsg && showMsg(msg, type); }

  const filtered = filterClasse
    ? comptes.filter(c => c.classe === filterClasse)
    : comptes;

  function startNew() {
    setEditing(null);
    setDraft({ numero: '', intitule: '', classe: '6', journal: 'Achats' });
    setShowForm(true);
  }

  function startEdit(c) {
    setEditing(c);
    setDraft({ numero: c.numero, intitule: c.intitule, classe: c.classe, journal: c.journal });
    setShowForm(true);
  }

  function save() {
    if (!draft.numero.trim() || !draft.intitule.trim()) return notify('Numéro et intitulé obligatoires', 'error');
    if (draft.numero.length !== 4 && draft.numero.length !== 6) return notify('Le numéro doit comporter 4 ou 6 chiffres', 'error');
    if (editing) {
      const next = comptes.map(c => c.numero === editing.numero ? { ...draft } : c);
      setComptes(next);
      logAudit({ type: 'PCGE', client: draft.intitule, number: draft.numero, status: 'valide', details: 'Modifié' });
      notify('Compte modifié');
    } else {
      const exists = comptes.find(c => c.numero === draft.numero);
      if (exists) return notify('Ce numéro de compte existe déjà', 'error');
      setComptes([...comptes, draft]);
      logAudit({ type: 'PCGE', client: draft.intitule, number: draft.numero, status: 'valide', details: 'Créé manuellement' });
      notify('Compte ajouté');
    }
    setShowForm(false);
    setEditing(null);
  }

  async function remove(c) {
    if (!canDelete) return;
    if (!(await systemConfirm(`Supprimer le compte ${c.numero} — ${c.intitule} ?`))) return;
    const next = comptes.filter(x => x.numero !== c.numero);
    setComptes(next);
    logAudit({ type: 'PCGE', client: c.intitule, number: c.numero, status: 'annule', details: 'Supprimé' });
    notify('Compte supprimé');
  }

  return (
    <div>
      {/* Filtres par Classe */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setFilterClasse(null)}
          style={{ padding: '7px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12, background: !filterClasse ? '#0f766e' : '#f1f5f9', color: !filterClasse ? '#fff' : '#475569' }}>
          Toutes les classes
        </button>
        {CLASSES.map(cls => (
          <button key={cls.id} onClick={() => setFilterClasse(cls.id)}
            style={{ padding: '7px 14px', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12, background: filterClasse === cls.id ? cls.color : '#f1f5f9', color: filterClasse === cls.id ? '#fff' : '#475569' }}>
            {cls.label}
          </button>
        ))}
      </div>

      {/* Barre d'outils */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#0f766e' }}>
          📒 Plan Comptable Général des Entreprises ({filtered.length} comptes)
        </div>
        {canEdit && (
          <button onClick={startNew} className="no-print"
            style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            + Compte
          </button>
        )}
      </div>

      {/* Formulaire d'ajout/modification */}
      {showForm && (
        <div className="no-print" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>N° compte</label>
            <input value={draft.numero} onChange={e => setDraft({ ...draft, numero: e.target.value })}
              placeholder="4 ou 6 chiffres" maxLength={6}
              style={{ ...inp, width: 100 }} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Intitulé</label>
            <input value={draft.intitule} onChange={e => setDraft({ ...draft, intitule: e.target.value })}
              placeholder="Ex: Client A — Atlas"
              style={{ ...inp, width: '100%' }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Classe</label>
            <select value={draft.classe} onChange={e => setDraft({ ...draft, classe: e.target.value })}
              style={{ ...inp, width: 80 }}>
              {CLASSES.map(cls => <option key={cls.id} value={cls.id}>{cls.id}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Journal</label>
            <select value={draft.journal} onChange={e => setDraft({ ...draft, journal: e.target.value })}
              style={{ ...inp, width: 100 }}>
              <option>Achats</option><option>Ventes</option><option>Banque</option><option>OD</option>
            </select>
          </div>
          <button onClick={save}
            style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            {editing ? '💾 Modifier' : '➕ Ajouter'}
          </button>
          <button onClick={() => { setShowForm(false); setEditing(null); }}
            style={{ background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: 5, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            Annuler
          </button>
        </div>
      )}

      {/* Tableau */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
              {['Numéro', 'Intitulé du compte', 'Classe', 'Journal par défaut', ''].map((h, i) => (
                <th key={i} className={h === '' ? 'no-print' : ''} style={{
                  textAlign: 'left', padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                  color: '#475569', fontWeight: 800, fontSize: 11,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
                Aucun compte trouvé
              </td></tr>
            )}
            {filtered.map(c => {
              const cls = CLASSES.find(x => x.id === c.classe);
              return (
                <tr key={c.numero} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '7px 10px', fontWeight: 700, fontFamily: 'monospace', fontSize: 13 }}>{c.numero}</td>
                  <td style={{ padding: '7px 10px' }}>{c.intitule}</td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{
                      background: cls ? `${cls.color}20` : '#f1f5f9',
                      color: cls ? cls.color : '#64748b',
                      padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                    }}>Classe {c.classe}</span>
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{
                      background: c.journal === 'Achats' ? '#dbeafe' : c.journal === 'Ventes' ? '#dcfce7' : c.journal === 'Banque' ? '#fef3c7' : '#f3e8ff',
                      color: c.journal === 'Achats' ? '#2563eb' : c.journal === 'Ventes' ? '#16a34a' : c.journal === 'Banque' ? '#d97706' : '#8b5cf6',
                      padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                    }}>{c.journal}</span>
                  </td>
                  <td className="no-print" style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canEdit && (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <button onClick={() => startEdit(c)}
                          style={{ background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>
                          ✏️
                        </button>
                        {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(c)}
                          style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>
                          ×
                        </button>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
