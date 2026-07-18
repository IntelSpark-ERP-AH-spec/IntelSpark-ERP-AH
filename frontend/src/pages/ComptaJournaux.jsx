import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';

const JOURNAUX = [
  { id: 'achats', label: "📋 Journal d'Achat", categories: ['achat', 'achats', 'fournisseur', 'approvisionnement'] },
  { id: 'ventes', label: '💰 Journal de Ventes', categories: ['vente', 'ventes', 'client', 'clients', 'facturation'] },
  { id: 'banque', label: '🏦 Journal de Banque', categories: ['banque', 'banq', 'frais_bancaire', 'interet', 'decouvert'] },
  { id: 'od', label: '📝 Journal des Opérations Diverses', categories: ['divers', 'od', 'general', 'transfert', 'ajustement'] },
  { id: 'salaires', label: '👥 Journal des Salaires', categories: ['salaire', 'salaires', 'paie', 'paye', 'rh', 'personnel'] },
  { id: 'tva', label: '🧾 Journal de TVA', categories: ['tva', 'TVA', 'taxe', 'fisc'] },
];

export default function ComptaJournaux({ initialJournal }) {
  const t = useT();
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'comptable', 'financier');
  const canDelete = hasRole('admin');
  const journal = initialJournal || 'achats';
  const [ecritures, setEcritures] = useState([]);
  const [solde, setSolde] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [notify, setNotify] = useState(null);
  const [form, setForm] = useState({ type: 'depense', categorie: '', montant: '', description: '', date_operation: new Date().toISOString().split('T')[0], compte: '', piece: '', montant_ht: '', montant_tva: '' });

  const isVentes = journal === 'ventes';
  const isBanque = journal === 'banque';
  const isAchats = journal === 'achats';
  const isOD = journal === 'od';
  const isSalaires = journal === 'salaires';
  const isTVA = journal === 'tva';

  useEffect(() => { load(); }, [journal]);

  async function load() {
    try {
      const [all, sd] = await Promise.all([api.getCompta(), api.getSolde()]);
      setEcritures(all || []);
      setSolde(sd);
    } catch {}
  }

  function showMsg(msg, type = 'info') { setNotify({ msg, type }); setTimeout(() => setNotify(null), 3000); }

  async function save() {
    try {
      await api.createEcriture({ ...form, categorie: form.categorie || journal, compte: isBanque || isAchats || isOD || isVentes || isSalaires || isTVA ? form.compte : undefined, rapproche: isBanque ? 0 : undefined });
      showMsg('Écriture ajoutée');
      setShowForm(false);
      setForm({ type: getDefaultType(journal), categorie: '', montant: '', description: '', date_operation: new Date().toISOString().split('T')[0], compte: '', piece: '', montant_ht: '', montant_tva: '' });
      load();
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function remove(id) {
    if (!(await systemConfirm('Supprimer cette écriture ?'))) return;
    await api.deleteEcriture(id);
    load();
  }

  const jour = JOURNAUX.find(j => j.id === journal);
  const filteredByJournal = ecritures.filter(e => {
    const cat = (e.categorie || '').toLowerCase();
    return jour.categories.some(c => cat.includes(c));
  });

  const colors = { recette: '#16a34a', depense: '#dc2626', transfert: '#d97706' };
  const labels = { recette: 'Crédit', depense: 'Débit', transfert: 'Transfert' };

  function getDefaultType(jId) {
    if (jId === 'ventes') return 'recette';
    if (jId === 'achats' || jId === 'salaires') return 'depense';
    return 'depense';
  }

  function suggestCategory(jId) {
    const j = JOURNAUX.find(x => x.id === jId);
    return j ? j.categories[0] : '';
  }

  return (
    <div className="domain-page domain-accounting" style={{ padding: 0 }}>
      {notify && <div style={{ position: 'fixed', top: 16, right: 16, background: notify.type === 'error' ? '#fef2f2' : '#f0fdf4', color: notify.type === 'error' ? '#dc2626' : '#16a34a', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, zIndex: 9999, border: `1px solid ${notify.type === 'error' ? '#fecaca' : '#bbf7d0'}` }}>{notify.msg}</div>}

      <div className="domain-title" style={{ fontWeight: 900, fontSize: 18, color: '#1e293b', marginBottom: 6 }}>💰 {t('Comptabilité')} — Journaux</div>

      {isBanque ? (
        <>
          {solde && (
            <div className="domain-metrics" style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>Recettes</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#16a34a' }}>{Number(solde.recettes).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>Dépenses</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#dc2626' }}>{Number(solde.depenses).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>Solde</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: solde.solde >= 0 ? '#16a34a' : '#dc2626' }}>{Number(solde.solde).toFixed(2)} €</div>
              </div>
            </div>
          )}

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 10 }}>✏️ Nouvelle opération</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Date</label>
                <input value={form.date_operation} onChange={e => setForm({ ...form, date_operation: e.target.value })} type="date" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Type</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }}>
                  <option value="recette">Recette (argent entre)</option><option value="depense">Dépense (argent sort)</option>
                </select>
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Montant</label>
                <input value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} type="number" step="0.01" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 110 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Description / Libellé</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 200 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Compte de contrepartie</label>
                <input value={form.compte} onChange={e => setForm({ ...form, compte: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 180 }} placeholder="ex: 411000 Client" />
              </div>
              <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Ajouter</button></div>
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead><tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Date</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Libellé</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Compte</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Débit</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Crédit</th>
                <th style={{ textAlign: 'center', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Rapprochement</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}></th>
              </tr></thead>
              <tbody>
                {filteredByJournal.map((e, i) => (
                  <tr key={e.id}>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12, color: '#64748b' }}>{e.date_operation}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ background: e.type === 'recette' ? '#dcfce7' : '#fef2f2', color: colors[e.type], padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{labels[e.type]}</span>
                      {' '}{e.description}
                    </td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 12 }}>{e.compte || '-'}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{e.type === 'depense' ? Number(e.montant).toFixed(2) : '-'}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{e.type === 'recette' ? Number(e.montant).toFixed(2) : '-'}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                      {e.rapproche == 1 ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>✅ Rappr.</span> : <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 12 }}>❌ Non rappr.</span>}
                    </td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(e.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>}</td>
                  </tr>
                ))}
                {filteredByJournal.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>Aucune écriture bancaire</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : isAchats ? (
        <>
          {solde && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>Recettes</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#16a34a' }}>{Number(solde.recettes).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>Dépenses</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#dc2626' }}>{Number(solde.depenses).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>Solde</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: solde.solde >= 0 ? '#16a34a' : '#dc2626' }}>{Number(solde.solde).toFixed(2)} €</div>
              </div>
            </div>
          )}

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 10 }}>✏️ Facture fournisseur</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Date facture</label>
                <input value={form.date_operation} onChange={e => setForm({ ...form, date_operation: e.target.value })} type="date" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>N° Facture</label>
                <input value={form.piece} onChange={e => setForm({ ...form, piece: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 130 }} placeholder="FAC-000001" />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Fournisseur</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 180 }} placeholder="Nom du fournisseur" />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Montant HT</label>
                <input value={form.montant_ht} onChange={e => setForm({ ...form, montant_ht: e.target.value })} type="number" step="0.01" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 100 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>TVA</label>
                <input value={form.montant_tva} onChange={e => setForm({ ...form, montant_tva: e.target.value })} type="number" step="0.01" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 100 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Montant TTC</label>
                <input value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} type="number" step="0.01" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 100 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Catégorie / Compte</label>
                <input value={form.compte} onChange={e => setForm({ ...form, compte: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 200 }} placeholder="ex: 606300 Fournitures" />
              </div>
              <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Ajouter</button></div>
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead><tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Date</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>N° Pièce</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Compte</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Libellé</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Débit</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Crédit</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}></th>
              </tr></thead>
              <tbody>
                {filteredByJournal.map((e, i) => (
                  <tr key={e.id}>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12, color: '#64748b' }}>{e.date_operation}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 12 }}>{e.compte || e.id.substring(0, 8)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 12 }}>{e.compte || '-'}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ background: e.type === 'recette' ? '#dcfce7' : '#fef2f2', color: colors[e.type], padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{labels[e.type]}</span>
                      {' '}{e.description}
                    </td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{e.type === 'depense' ? Number(e.montant).toFixed(2) : '-'}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{e.type === 'recette' ? Number(e.montant).toFixed(2) : '-'}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(e.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>}</td>
                  </tr>
                ))}
                {filteredByJournal.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>Aucune facture d'achat</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : isOD ? (
        <>
          {solde && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>Recettes</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#16a34a' }}>{Number(solde.recettes).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>Dépenses</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#dc2626' }}>{Number(solde.depenses).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>Solde</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: solde.solde >= 0 ? '#16a34a' : '#dc2626' }}>{Number(solde.solde).toFixed(2)} €</div>
              </div>
            </div>
          )}

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 10 }}>✏️ Opération Diverse</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Date</label>
                <input value={form.date_operation} onChange={e => setForm({ ...form, date_operation: e.target.value })} type="date" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Type</label>
                <input value="OD" onChange={e => setForm({ ...form, type: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 60 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>N° Pièce</label>
                <input value={form.piece} onChange={e => setForm({ ...form, piece: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 140 }} placeholder="OD-2026-06" />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Description / Libellé</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 260 }} placeholder="Écriture de paie - Juin 2026" />
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
            {(() => {
              const odEcritures = filteredByJournal;
              const totalDebit = odEcritures.filter(e => e.type === 'depense').reduce((s, e) => s + Number(e.montant), 0);
              const totalCredit = odEcritures.filter(e => e.type === 'recette').reduce((s, e) => s + Number(e.montant), 0);
              const equilibre = Math.abs(totalDebit - totalCredit) < 0.01;
              return (
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                  <thead><tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Compte</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Intitulé</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Débit</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Crédit</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}></th>
                  </tr></thead>
                  <tbody>
                    {odEcritures.map((e, i) => (
                      <tr key={e.id}>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 12 }}>{e.compte || '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}>{e.description}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{e.type === 'depense' ? Number(e.montant).toFixed(2) : '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{e.type === 'recette' ? Number(e.montant).toFixed(2) : '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(e.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>}</td>
                      </tr>
                    ))}
                    {odEcritures.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>Aucune écriture OD</td></tr>}
                  </tbody>
                  {odEcritures.length > 0 && (
                    <tfoot>
                      <tr style={{ fontWeight: 800, borderTop: '2px solid ' + (equilibre ? '#16a34a' : '#dc2626') }}>
                        <td colSpan={2} style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>Total</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>{totalDebit.toFixed(2)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>{totalCredit.toFixed(2)}</td>
                        <td></td>
                      </tr>
                      {!equilibre && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 6, color: '#dc2626', fontSize: 12, fontWeight: 700, background: '#fef2f2' }}>⚠️ Écriture déséquilibrée ! (Débit ≠ Crédit)</td></tr>}
                    </tfoot>
                  )}
                </table>
              );
            })()}
          </div>
        </>
      ) : isVentes ? (
        <>
          {solde && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>Recettes</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#16a34a' }}>{Number(solde.recettes).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>Dépenses</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#dc2626' }}>{Number(solde.depenses).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>Solde</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: solde.solde >= 0 ? '#16a34a' : '#dc2626' }}>{Number(solde.solde).toFixed(2)} €</div>
              </div>
            </div>
          )}

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 10 }}>✏️ Facture client</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Date</label>
                <input value={form.date_operation} onChange={e => setForm({ ...form, date_operation: e.target.value })} type="date" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Type</label>
                <input value="Vente" onChange={e => setForm({ ...form, type: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 80 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>N° Pièce</label>
                <input value={form.piece} onChange={e => setForm({ ...form, piece: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 140 }} placeholder="FAC-2026-005" />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Description / Libellé</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 260 }} placeholder="Vente - SARL Auto" />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Catégorie</label>
                <input value={form.categorie} onChange={e => setForm({ ...form, categorie: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 180 }} placeholder="Prestation de services" />
              </div>
              <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Ajouter</button></div>
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
            {(() => {
              const vEcritures = filteredByJournal;
              const totalDebit = vEcritures.filter(e => e.type === 'depense').reduce((s, e) => s + Number(e.montant), 0);
              const totalCredit = vEcritures.filter(e => e.type === 'recette').reduce((s, e) => s + Number(e.montant), 0);
              const equilibre = Math.abs(totalDebit - totalCredit) < 0.01;
              return (
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                  <thead><tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Compte</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Intitulé</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Débit</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Crédit</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}></th>
                  </tr></thead>
                  <tbody>
                    {vEcritures.map((e, i) => (
                      <tr key={e.id}>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 12 }}>{e.compte || '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}>{e.description}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{e.type === 'depense' ? Number(e.montant).toFixed(2) : '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{e.type === 'recette' ? Number(e.montant).toFixed(2) : '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(e.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>}</td>
                      </tr>
                    ))}
                    {vEcritures.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>Aucune écriture de vente</td></tr>}
                  </tbody>
                  {vEcritures.length > 0 && (
                    <tfoot>
                      <tr style={{ fontWeight: 800, borderTop: '2px solid ' + (equilibre ? '#16a34a' : '#dc2626') }}>
                        <td colSpan={2} style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>Total</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>{totalDebit.toFixed(2)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>{totalCredit.toFixed(2)}</td>
                        <td></td>
                      </tr>
                      {!equilibre && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 6, color: '#dc2626', fontSize: 12, fontWeight: 700, background: '#fef2f2' }}>⚠️ Écriture déséquilibrée ! (Débit ≠ Crédit)</td></tr>}
                    </tfoot>
                  )}
                </table>
              );
            })()}
          </div>
        </>
      ) : isSalaires ? (
        <>
          {solde && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>Recettes</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#16a34a' }}>{Number(solde.recettes).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>Dépenses</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#dc2626' }}>{Number(solde.depenses).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>Solde</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: solde.solde >= 0 ? '#16a34a' : '#dc2626' }}>{Number(solde.solde).toFixed(2)} €</div>
              </div>
            </div>
          )}

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 10 }}>✏️ Écriture de paie</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Date</label>
                <input value={form.date_operation} onChange={e => setForm({ ...form, date_operation: e.target.value })} type="date" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Type</label>
                <input value="Paie" onChange={e => setForm({ ...form, type: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 70 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>N° Pièce</label>
                <input value={form.piece} onChange={e => setForm({ ...form, piece: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 140 }} placeholder="PAIE-2026-06" />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Description / Libellé</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 260 }} placeholder="Écritures de paie - Juin 2026" />
              </div>
              <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Ajouter</button></div>
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
            {(() => {
              const sEcritures = filteredByJournal;
              const totalDebit = sEcritures.filter(e => e.type === 'depense').reduce((s, e) => s + Number(e.montant), 0);
              const totalCredit = sEcritures.filter(e => e.type === 'recette').reduce((s, e) => s + Number(e.montant), 0);
              const equilibre = Math.abs(totalDebit - totalCredit) < 0.01;
              return (
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                  <thead><tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Compte</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Intitulé</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Débit</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Crédit</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}></th>
                  </tr></thead>
                  <tbody>
                    {sEcritures.map((e, i) => (
                      <tr key={e.id}>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 12 }}>{e.compte || '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}>{e.description}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{e.type === 'depense' ? Number(e.montant).toFixed(2) : '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{e.type === 'recette' ? Number(e.montant).toFixed(2) : '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(e.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>}</td>
                      </tr>
                    ))}
                    {sEcritures.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>Aucune écriture de paie</td></tr>}
                  </tbody>
                  {sEcritures.length > 0 && (
                    <tfoot>
                      <tr style={{ fontWeight: 800, borderTop: '2px solid ' + (equilibre ? '#16a34a' : '#dc2626') }}>
                        <td colSpan={2} style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>Total</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>{totalDebit.toFixed(2)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>{totalCredit.toFixed(2)}</td>
                        <td></td>
                      </tr>
                      {!equilibre && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 6, color: '#dc2626', fontSize: 12, fontWeight: 700, background: '#fef2f2' }}>⚠️ Écriture déséquilibrée ! (Débit ≠ Crédit)</td></tr>}
                    </tfoot>
                  )}
                </table>
              );
            })()}
          </div>
        </>
      ) : isTVA ? (
        <>
          {solde && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>Recettes</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#16a34a' }}>{Number(solde.recettes).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>Dépenses</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#dc2626' }}>{Number(solde.depenses).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>Solde</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: solde.solde >= 0 ? '#16a34a' : '#dc2626' }}>{Number(solde.solde).toFixed(2)} €</div>
              </div>
            </div>
          )}

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 10 }}>✏️ Déclaration de TVA</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Date</label>
                <input value={form.date_operation} onChange={e => setForm({ ...form, date_operation: e.target.value })} type="date" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Type</label>
                <input value="TVA" onChange={e => setForm({ ...form, type: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 60 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>N° Pièce</label>
                <input value={form.piece} onChange={e => setForm({ ...form, piece: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 140 }} placeholder="TVA-2026-05" />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Description / Libellé</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 260 }} placeholder="Déclaration TVA - Mai 2026" />
              </div>
              <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Ajouter</button></div>
            </div>
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
            {(() => {
              const tEcritures = filteredByJournal;
              const totalDebit = tEcritures.filter(e => e.type === 'depense').reduce((s, e) => s + Number(e.montant), 0);
              const totalCredit = tEcritures.filter(e => e.type === 'recette').reduce((s, e) => s + Number(e.montant), 0);
              const equilibre = Math.abs(totalDebit - totalCredit) < 0.01;
              return (
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                  <thead><tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Compte</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Intitulé</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Débit</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Crédit</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}></th>
                  </tr></thead>
                  <tbody>
                    {tEcritures.map((e, i) => (
                      <tr key={e.id}>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 12 }}>{e.compte || '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}>{e.description}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{e.type === 'depense' ? Number(e.montant).toFixed(2) : '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{e.type === 'recette' ? Number(e.montant).toFixed(2) : '-'}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(e.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>}</td>
                      </tr>
                    ))}
                    {tEcritures.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>Aucune écriture de TVA</td></tr>}
                  </tbody>
                  {tEcritures.length > 0 && (
                    <tfoot>
                      <tr style={{ fontWeight: 800, borderTop: '2px solid ' + (equilibre ? '#16a34a' : '#dc2626') }}>
                        <td colSpan={2} style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>Total</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>{totalDebit.toFixed(2)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: equilibre ? '#16a34a' : '#dc2626' }}>{totalCredit.toFixed(2)}</td>
                        <td></td>
                      </tr>
                      {!equilibre && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 6, color: '#dc2626', fontSize: 12, fontWeight: 700, background: '#fef2f2' }}>⚠️ Écriture déséquilibrée ! (Débit ≠ Crédit)</td></tr>}
                    </tfoot>
                  )}
                </table>
              );
            })()}
          </div>
        </>
      ) : (
        <>
          {solde && (
            <div className="domain-metrics" style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div style={{ flex: 1, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>Recettes</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#16a34a' }}>{Number(solde.recettes).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600, textTransform: 'uppercase' }}>Dépenses</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#dc2626' }}>{Number(solde.depenses).toFixed(2)} €</div>
              </div>
              <div style={{ flex: 1, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 11, color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>Solde</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: solde.solde >= 0 ? '#16a34a' : '#dc2626' }}>{Number(solde.solde).toFixed(2)} €</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#0f766e' }}>{jour?.label || 'Journal'}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {canEdit && <button onClick={() => { setShowForm(!showForm); setForm({ ...form, type: getDefaultType(journal), categorie: suggestCategory(journal) }); }} className="no-print" style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>+ Écriture</button>}
            </div>
          </div>

          {showForm && (
            <div className="no-print" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Type</label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }}>
                  <option value="recette">Recette</option><option value="depense">Dépense</option><option value="transfert">Transfert</option>
                </select>
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Catégorie</label>
                <input value={form.categorie} onChange={e => setForm({ ...form, categorie: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 150 }} placeholder={suggestCategory(journal)} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Montant</label>
                <input value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} type="number" step="0.01" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 110 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Description</label>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 200 }} />
              </div>
              <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Date</label>
                <input value={form.date_operation} onChange={e => setForm({ ...form, date_operation: e.target.value })} type="date" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 130 }} />
              </div>
              <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Ajouter</button></div>
            </div>
          )}

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead><tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Date</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Pièce</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Libellé</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Débit</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Crédit</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}></th>
              </tr></thead>
              <tbody>
                {filteredByJournal.map((e, i) => (
                  <tr key={e.id}>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12, color: '#64748b' }}>{e.date_operation}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 12 }}>{e.id.substring(0, 8)}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ background: e.type === 'recette' ? '#dcfce7' : e.type === 'depense' ? '#fef2f2' : '#fef3c7', color: colors[e.type], padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{labels[e.type]}</span>
                      {' '}{e.description} <span style={{ fontSize: 11, color: '#94a3b8' }}>({e.categorie})</span>
                    </td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{e.type === 'depense' ? Number(e.montant).toFixed(2) : '-'}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{e.type === 'recette' ? Number(e.montant).toFixed(2) : '-'}</td>
                    <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(e.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>}</td>
                  </tr>
                ))}
                {filteredByJournal.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>Aucune écriture dans ce journal</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
