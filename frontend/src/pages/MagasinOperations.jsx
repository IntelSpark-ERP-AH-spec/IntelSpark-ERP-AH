import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';
import { useCurrency } from '../CurrencyContext';

const TABS = [
  { id: 'reception', label: '📥 Réception' },
  { id: 'stockage', label: '📍 Stockage' },
  { id: 'preparation', label: '📋 Préparation' },
  { id: 'expedition', label: '🚚 Expédition' },
  { id: 'gestion', label: '📦 Gestion de stock' },
];

export default function MagasinOperations({ initialTab }) {
  const t = useT();
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'magasinier');
  const canDelete = hasRole('admin');
  const [tab, setTab] = useState(initialTab || 'gestion');
  const [notify, setNotify] = useState(null);

  function showMsg(msg, type = 'info') { setNotify({ msg, type }); setTimeout(() => setNotify(null), 3000); }

  return (
    <div style={{ padding: 0 }}>
      {notify && <div style={{ position: 'fixed', top: 16, right: 16, background: notify.type === 'error' ? '#fef2f2' : '#f0fdf4', color: notify.type === 'error' ? '#dc2626' : '#16a34a', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, zIndex: 9999, border: `1px solid ${notify.type === 'error' ? '#fecaca' : '#bbf7d0'}` }}>{notify.msg}</div>}

      <div style={{ fontWeight: 900, fontSize: 18, color: '#1e293b', marginBottom: 12 }}>🏭 {t('Gestion Magasin')}</div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '7px 14px', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, fontSize: 13, background: tab === t.id ? '#0f766e' : '#f1f5f9', color: tab === t.id ? '#fff' : '#475569' }}>{t.label}</button>
        ))}
      </div>

      {tab === 'reception' && <ReceptionTab canEdit={canEdit} canDelete={canDelete} showMsg={showMsg} />}
      {tab === 'stockage' && <StockageTab />}
      {tab === 'preparation' && <PreparationTab canEdit={canEdit} canDelete={canDelete} showMsg={showMsg} />}
      {tab === 'expedition' && <ExpeditionTab canEdit={canEdit} canDelete={canDelete} showMsg={showMsg} />}
      {tab === 'gestion' && <GestionStockTab canEdit={canEdit} canDelete={canDelete} showMsg={showMsg} />}
    </div>
  );
}

export function ReceptionTab({ canEdit, canDelete = false, showMsg }) {
  const [receptions, setReceptions] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [commandes, setCommandes] = useState([]);
  const [produits, setProduits] = useState([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({ fournisseur_id: '', fournisseur_nom: '', num_bl: '', date_reception: new Date().toISOString().slice(0,10), commande_id: '' });
  const [items, setItems] = useState([]);
  const [validated, setValidated] = useState(false);
  const [newItemRef, setNewItemRef] = useState('');
  const [newItemDes, setNewItemDes] = useState('');
  const [newItemQty, setNewItemQty] = useState(1);
  const [showAddRow, setShowAddRow] = useState(false);

  useEffect(() => {
    loadReceptions(); loadFournisseurs(); loadCommandes(); loadProduits();
    let cancelled = false;
    api.request('/data/doc/is_import_reception_draft').then(async draft => {
      if (cancelled) return;
      if (draft?.items?.length) {
        setForm({ fournisseur_id: '', fournisseur_nom: draft.fournisseur_nom || '', num_bl: draft.num_bl || '', date_reception: draft.date_reception || new Date().toISOString().slice(0, 10), commande_id: '' });
        setItems(draft.items.map((item) => ({ ...item, quantite_commandee: 0, quantite_recue: item.quantite_recue || item.quantite || 0, ecart: item.quantite_recue || item.quantite || 0, etat: 'conforme' })));
        await api.request('/data/doc/is_import_reception_draft', { method: 'DELETE' });
        showMsg('Arrivage importé chargé : pointez les pièces avant validation.', 'info');
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function loadReceptions() {
    try { const res = await fetch('/api/warehouse/receptions', { credentials: 'same-origin' }); if (res.ok) setReceptions(await res.json()); } catch {}
  }
  async function loadFournisseurs() {
    try { const f = await api.getFournisseurs(); setFournisseurs(f); } catch {}
  }
  async function loadCommandes() {
    try { const c = await api.getCommandes(); setCommandes(c); } catch {}
  }
  async function loadProduits() {
    try { const p = await api.getProduits(); setProduits(p); } catch {}
  }

  async function loadCommandeItems(commandeId, detectedItems) {
    try {
      const cmd = await api.getCommande(commandeId);
      const cmdItems = cmd.items || [];
      const merged = cmdItems.map(ci => {
        const match = detectedItems.find(d =>
          d.reference?.toLowerCase() === (ci.produit_ref || '').toLowerCase() ||
          (ci.produit_id && d.produit_id === ci.produit_id) ||
          (d.reference && ci.designation?.toLowerCase().includes(d.reference.toLowerCase()))
        );
        const qtyRecue = match?.quantite_recue || 0;
        return {
          item_id: ci.id,
          reference: ci.produit_ref || '',
          designation: ci.designation || '',
          quantite_commandee: ci.quantite_commandee,
          quantite_recue: qtyRecue,
          ecart: qtyRecue - ci.quantite_commandee,
          etat: qtyRecue > ci.quantite_commandee ? 'excedent' : 'conforme',
          produit_id: ci.produit_id
        };
      });
      const extra = detectedItems.filter(d => !cmdItems.some(ci =>
        d.reference?.toLowerCase() === (ci.produit_ref || '').toLowerCase()
      ));
      const extraItems = extra.map(d => ({
        reference: d.reference,
        designation: d.designation,
        quantite_commandee: 0,
        quantite_recue: d.quantite_recue,
        ecart: d.quantite_recue,
        etat: 'non_commande',
        produit_id: d.produit_id
      }));
      setItems([...merged, ...extraItems]);
    } catch {
      setItems(detectedItems.map(it => ({ ...it, quantite_commandee: 0, ecart: it.quantite_recue, etat: 'conforme' })));
    }
  }

  function toggleItemEtat(index) {
    setItems(prev => prev.map((it, i) => i === index ? { ...it, etat: it.etat === 'endommage' ? 'conforme' : 'endommage' } : it));
  }

  function updateRecue(index, val) {
    const qty = parseFloat(val) || 0;
    setItems(prev => prev.map((it, i) => i === index ? { ...it, quantite_recue: qty, ecart: qty - it.quantite_commandee } : it));
  }

  function addManualRow() {
    if (!newItemRef.trim() && !newItemDes.trim()) { showMsg('Référence ou désignation requise', 'warning'); return; }
    const prod = produits.find(p => p.reference?.toLowerCase() === newItemRef.trim().toLowerCase());
    setItems(prev => [...prev, { reference: newItemRef.trim(), designation: newItemDes.trim(), quantite_commandee: 0, quantite_recue: newItemQty, ecart: newItemQty, etat: 'conforme', produit_id: prod?.id || '' }]);
    setNewItemRef(''); setNewItemDes(''); setNewItemQty(1);
    setShowAddRow(false);
  }

  function removeItem(index) {
    setItems(prev => prev.filter((_, i) => i !== index));
  }

  async function validateStock() {
    if (!form.num_bl) { showMsg('Numéro de Bon de Livraison requis', 'warning'); return; }
    setLoading(true);
    try {
      // Save reception
      const receptionData = {
        fournisseur_id: form.fournisseur_id,
        fournisseur_nom: form.fournisseur_nom,
        num_bl: form.num_bl,
        date_reception: form.date_reception,
        commande_id: form.commande_id || null,
        items: items.map(it => ({
          reference: it.reference, designation: it.designation,
          quantite_recue: it.quantite_recue, etat: it.etat,
          produit_id: it.produit_id, item_id: it.item_id
        }))
      };
      const receptionResponse = await fetch('/api/warehouse/receptions', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(receptionData)
      });

      if (!receptionResponse.ok) {
        const body = await receptionResponse.json().catch(() => ({}));
        throw new Error(body.error || 'La réception n’a pas pu mettre le stock à jour');
      }

      // La réception liée est mise à jour atomiquement par le serveur.
      // Seules les réceptions libres nécessitent une entrée de stock directe.
      if (!form.commande_id || !items.some(it => it.item_id)) {
        for (const it of items) {
          if (it.produit_id && it.quantite_recue > 0) {
            await api.entreeStock(it.produit_id, it.quantite_recue, `Réception BL ${form.num_bl}`);
          }
        }
      }

      // NOTIFICATION for comptable
      try {
        await api.createNotification({
          broadcast_to_role: 'comptable',
          type: 'reception',
          title: `📦 Réception BL n°${form.num_bl}`,
          message: `Bon de Livraison réceptionné : ${form.fournisseur_nom} — ${items.filter(i => i.etat === 'endommage' || i.ecart < 0).length} anomalie(s). En attente de facture.`
        });
      } catch {}

      showMsg(`✅ Réception BL ${form.num_bl} validée — stock mis à jour`, 'success');
      setValidated(true);
      setForm({ fournisseur_id: '', fournisseur_nom: '', num_bl: '', date_reception: new Date().toISOString().slice(0,10), commande_id: '' });
      setItems([]);
      loadReceptions();
    } catch (e) { showMsg(e.message, 'error'); }
    setLoading(false);
  }

  const hasAnomalies = items.some(it => it.ecart < 0 || it.etat === 'endommage' || it.etat === 'excedent');

  return (
    <div className="magasinier-reception warehouse-page warehouse-reception">

      {/* ===== BLOC 1 : CHAMPS LOGISTIQUE ===== */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 14, color: '#1e293b', marginBottom: 10 }}>📋 Contrôle Logistique</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 2 }}>Fournisseur</label>
            <div style={{ display: 'flex', gap: 4 }}>
              <input value={form.fournisseur_nom} onChange={e => setForm({...form, fournisseur_nom: e.target.value})}
                list="fournisseurs-list" style={{ flex: 1, padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none' }} />
              <datalist id="fournisseurs-list">{fournisseurs.map(f => <option key={f.id} value={f.nom} />)}</datalist>
            </div>
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 2 }}>N° Bon de Livraison</label>
            <input value={form.num_bl} onChange={e => setForm({...form, num_bl: e.target.value})}
              style={{ width: '100%', padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none', fontWeight: 700, color: '#0f766e' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 2 }}>Date réception</label>
            <input type="date" value={form.date_reception} onChange={e => setForm({...form, date_reception: e.target.value})}
              style={{ width: '100%', padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', marginBottom: 2 }}>N° Commande origine</label>
            <select value={form.commande_id} onChange={e => { const cid = e.target.value; setForm({...form, commande_id: cid}); if (cid) loadCommandeItems(cid, items); }}
              style={{ width: '100%', padding: '7px 9px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none', background: '#fff' }}>
              <option value="">— Sans commande —</option>
              {commandes.filter(c => !form.fournisseur_id || c.fournisseur_id === form.fournisseur_id).map(c => (
                <option key={c.id} value={c.id}>[{c.numero}] {c.fournisseur_nom || c.fournisseur_id?.slice(0,8)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ===== BLOC 3 : TABLEAU DE POINTAGE ===== */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div><span style={{ fontWeight: 900, fontSize: 14, color: '#1e293b' }}>🔧 Tableau de pointage des pièces</span>
            <span style={{ fontSize: 12, color: '#64748b', marginLeft: 8 }}>{items.length} ligne(s) {hasAnomalies && <span style={{ color: '#dc2626', fontWeight: 700 }}>· ⚠ Anomalie(s)</span>}</span>
          </div>
          {canEdit && <button onClick={() => setShowAddRow(!showAddRow)} style={{ background: showAddRow ? '#f1f5f9' : '#0f766e', color: showAddRow ? '#475569' : '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>+ Ajouter une ligne</button>}
        </div>
        {showAddRow && (
          <div style={{ padding: '8px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={newItemRef} onChange={e => setNewItemRef(e.target.value)} placeholder="Réf / SKU" list="ref-list"
              style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 100, outline: 'none' }} />
            <datalist id="ref-list">{produits.map(p => <option key={p.id} value={p.reference} />)}</datalist>
            <input value={newItemDes} onChange={e => setNewItemDes(e.target.value)} placeholder="Désignation"
              style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 180, outline: 'none' }} />
            <input type="number" min="1" value={newItemQty} onChange={e => setNewItemQty(parseFloat(e.target.value) || 1)} style={{ padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 60, outline: 'none', textAlign: 'center' }} />
            <button onClick={addManualRow} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Ajouter</button>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr style={{ background: '#f8fafc' }}>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Réf / SKU</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Désignation</th>
              <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Qté Commandée</th>
              <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Qté Reçue</th>
              <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>Écart</th>
              <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>État</th>
              <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: '#475569', width: 30 }}></th>
            </tr></thead>
            <tbody>
                {items.map((it, i) => {
                const alerte = it.ecart < 0 || it.etat === 'endommage' || it.etat === 'excedent' || it.etat === 'non_commande';
                return (
                  <tr key={i} style={{ background: alerte ? '#fef2f2' : i % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 11, fontWeight: 600 }}>{it.reference || '-'}</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9' }}>{it.designation}</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'center', fontWeight: 700, color: '#64748b' }}>{it.quantite_commandee}</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                      <input type="number" min="0" value={it.quantite_recue} onChange={e => updateRecue(i, e.target.value)}
                        style={{ width: 60, padding: '3px 6px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, textAlign: 'center', fontWeight: 700 }} />
                    </td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'center', fontWeight: 700, color: it.ecart < 0 ? '#dc2626' : it.ecart > 0 ? '#d97706' : '#16a34a' }}>
                      {it.ecart > 0 ? `+${it.ecart}` : it.ecart}
                    </td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                      <button onClick={() => toggleItemEtat(i)}
                        style={{ padding: '3px 10px', borderRadius: 12, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                          background: it.etat === 'endommage' ? '#fef2f2' : '#f0fdf4',
                          color: it.etat === 'endommage' ? '#dc2626' : '#16a34a' }}>
                        {it.etat === 'endommage' ? '⚠ Endommagée' : it.etat === 'excedent' ? '➕ Excédent' : it.etat === 'non_commande' ? '❓ Non commandé' : '✅ Conforme'}
                      </button>
                    </td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                      {canDelete && <button className="admin-delete-action" onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 900, fontSize: 14, padding: 2 }} title="Supprimer">×</button>}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
                  Cliquez sur "+ Ajouter une ligne" pour commencer
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {hasAnomalies && (
          <div style={{ padding: '8px 16px', background: '#fef2f2', borderTop: '1px solid #fecaca', fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
            🚨 Alerte Litige Fournisseur — Des écarts ou pièces endommagées ont été détectés. Un signalement sera transmis à la comptabilité.
          </div>
        )}
      </div>

      {/* ===== BOUTON VALIDATION ===== */}
      {items.length > 0 && !validated && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginBottom: 14 }}>
          <button onClick={validateStock} disabled={loading}
            style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 24px', fontWeight: 800, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', opacity: loading ? 0.6 : 1 }}>
            {loading ? '⏳ Validation...' : '✅ Valider l\'entrée en stock'}
          </button>
        </div>
      )}

      {validated && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13, color: '#16a34a', fontWeight: 700, textAlign: 'center' }}>
          ✅ Réception BL {form.num_bl} validée — Stock mis à jour. Notification envoyée à la comptabilité (en attente de facture).
        </div>
      )}

      {/* Dernières réceptions */}
      {receptions.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 200 }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', fontWeight: 700, fontSize: 12, color: '#475569' }}>📜 Historique des réceptions</div>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead><tr>
              <th style={{ textAlign: 'left', padding: '4px 7px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>Date</th>
              <th style={{ textAlign: 'left', padding: '4px 7px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>BL</th>
              <th style={{ textAlign: 'left', padding: '4px 7px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>Fournisseur</th>
              <th style={{ textAlign: 'right', padding: '4px 7px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>Articles</th>
              {canDelete && <th style={{ textAlign: 'center', padding: '4px 7px', borderBottom: '1px solid #e2e8f0', color: '#64748b', width: 40 }}></th>}
            </tr></thead>
            <tbody>
              {receptions.slice(-10).reverse().map(r => (
                <tr key={r.id}>
                  <td style={{ padding: '3px 7px', borderBottom: '1px solid #f1f5f9', color: '#94a3b8' }}>{r.created_at}</td>
                  <td style={{ padding: '3px 7px', borderBottom: '1px solid #f1f5f9', fontWeight: 600, fontFamily: 'monospace' }}>{r.num_bl}</td>
                  <td style={{ padding: '3px 7px', borderBottom: '1px solid #f1f5f9' }}>{r.fournisseur_nom}</td>
                  <td style={{ padding: '3px 7px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{r.nb_articles || '-'}</td>
                  {canDelete && <td style={{ padding: '3px 7px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                    <button className="admin-delete-action" onClick={async () => { if (!(await systemConfirm('Supprimer cette réception ?'))) return; try { await api.request(`/warehouse/receptions/${r.id}`, { method: 'DELETE' }); setReceptions(current => current.filter(item => item.id !== r.id)); showMsg('Réception supprimée'); } catch (e) { showMsg(e.message, 'error'); } }}
                      style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontWeight: 900, fontSize: 14, padding: '2px 6px' }} title="Supprimer">×</button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function StockageTab({ canEdit, showMsg = () => {} }) {
  const [produits, setProduits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingQty, setEditingQty] = useState(null);
  const [qtyVal, setQtyVal] = useState('');
  const [editingEmp, setEditingEmp] = useState(null);
  const [empVal, setEmpVal] = useState('');
  const [notifiedAlerts, setNotifiedAlerts] = useState(new Set());

  function load() {
    api.getProduits().then(setProduits).catch(() => {});
  }
  useEffect(() => {
    load();
    const interval = window.setInterval(load, 5000);
    window.addEventListener('focus', load);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', load);
    };
  }, []);

  const stockItems = produits.filter(p => Number(p.actif) !== 0);

  // ——— calculs indicateurs ———
  const totalRefs = stockItems.length;
  const totalVolume = stockItems.reduce((s, p) => s + (p.stock_actuel || 0), 0);
  const alertItems = stockItems.filter(p => (p.stock_actuel || 0) <= (p.stock_min || 0));
  const alertCount = alertItems.length;

  // ——— notifications alertes rupture (1 fois par session) ———
  useEffect(() => {
    alertItems.forEach(p => {
      if (notifiedAlerts.has(p.id)) return;
      notifiedAlerts.add(p.id);
      api.createNotification({
        type: 'stock_alert',
        title: `⚠ Alerte Rupture — ${p.reference}`,
        message: `Stock critique pour la référence ${p.reference} (Reste ${p.stock_actuel || 0} unités). Préparer un bon de commande fournisseur.`,
        broadcast_to_role: 'admin,comptable'
      }).catch(() => {});
    });
  }, [alertItems.length]);

  // ——— édition rapide quantité ———
  async function saveQty(prod) {
    const val = parseFloat(qtyVal);
    if (isNaN(val) || val < 0) return;
    try {
      await api.updateProduit(prod.id, { stock_actuel: val });
      load();
    } catch (e) { showMsg(e.message, 'error'); }
    setEditingQty(null);
  }
  async function saveEmp(prod) {
    try {
      await api.updateProduit(prod.id, { emplacement: empVal.toUpperCase() });
      load();
    } catch (e) { showMsg(e.message, 'error'); }
    setEditingEmp(null);
  }

  // ——— proposition d'emplacement automatique ———
  function suggestEmplacement(prod) {
    if (!prod) return '-';
    const cat = (prod.categorie || prod.designation || '').toLowerCase();
    if (cat.includes('moteur') || cat.includes('essieu') || cat.includes('pont') || cat.includes('boîte') || cat.includes('boite') || cat.includes('bloc'))
      return 'ALLEE-LOURDE-A';
    if (cat.includes('amorti') || cat.includes('ressort') || cat.includes('suspension') || cat.includes('barre'))
      return 'ALLEE-LOURDE-B';
    if (cat.includes('frein') || cat.includes('disque') || cat.includes('plaquette') || cat.includes('tambour'))
      return 'RAYON-FREINAGE';
    if (cat.includes('filtre') || cat.includes('joint') || cat.includes('courroie') || cat.includes('durite'))
      return 'ETAGERE-LEGERE-B';
    if (cat.includes('électr') || cat.includes('electr') || cat.includes('batterie') || cat.includes('capteur') || cat.includes('relais'))
      return 'RAYON-ELECTRICITE';
    if (cat.includes('pneu') || cat.includes('roue') || cat.includes('jante'))
      return 'ZONE-PNEUS';
    return 'DIVERS-ALLÉE-C';
  }
  function applySuggestion(prod) {
    const emp = suggestEmplacement(prod);
    api.updateProduit(prod.id, { emplacement: emp }).then(load).catch(() => {});
    showMsg(`Emplacement proposé : ${emp}`, 'info');
  }

  // ——— reset ———
  const S = {
    input: { padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box', outline: 'none' },
    th: { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' },
    td: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12, verticalAlign: 'middle' }
  };

  return (
    <div className="magasinier-stockage warehouse-page warehouse-storage" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ══════ BLOC 1 : INDICATEURS ══════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#0f766e' }}>{totalRefs}</div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 2 }}>Total Références</div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#2563eb' }}>{totalVolume}</div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 2 }}>Volume de pièces</div>
        </div>
        <div style={{ background: alertCount > 0 ? '#fef2f2' : '#fff', border: `1px solid ${alertCount > 0 ? '#fecaca' : '#e2e8f0'}`, borderRadius: 8, padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 900, color: alertCount > 0 ? '#dc2626' : '#16a34a' }}>{alertCount}</div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 2 }}>
            {alertCount > 0 ? '⚠ Alertes Rupture' : 'Alerte Rupture'}
          </div>
        </div>
      </div>

      {/* ══════ BLOC 3 : TABLEAU STOCK ══════ */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={S.th}>Réf / SKU</th>
              <th style={S.th}>Désignation</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Qté Stock</th>
              <th style={S.th}>Emplacement</th>
              <th style={{ ...S.th, textAlign: 'right' }}>Seuil Alerte</th>
              <th style={{ ...S.th, textAlign: 'center', width: 130 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {stockItems.map(p => {
              const stock = p.stock_actuel || 0;
              const seuil = p.stock_min || 0;
              const alerte = stock <= seuil && seuil > 0;
              return (
                <tr key={p.id} style={{ background: alerte ? '#fef2f2' : 'transparent' }}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#334155' }}>{p.reference}</td>
                  <td style={{ ...S.td, fontWeight: 600 }}>{p.designation}</td>
                  <td style={{ ...S.td, textAlign: 'right', fontWeight: 700 }}>
                    {editingQty === p.id ? (
                      <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                        <input type="number" min="0" value={qtyVal} onChange={e => setQtyVal(e.target.value)}
                          style={{ width: 60, padding: '2px 4px', border: '1px solid #2563eb', borderRadius: 3, fontSize: 12, fontFamily: 'inherit', textAlign: 'right' }} />
                        <button onClick={() => saveQty(p)} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 7px', fontSize: 10, cursor: 'pointer' }}>OK</button>
                        <button onClick={() => setEditingQty(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>×</button>
                      </span>
                    ) : (
                      <span style={{ color: alerte ? '#dc2626' : '#0f766e' }}>{stock}</span>
                    )}
                    {alerte && editingQty !== p.id && <span style={{ marginLeft: 4, color: '#dc2626', fontSize: 10, fontWeight: 800 }}>🔴</span>}
                  </td>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>
                    {editingEmp === p.id ? (
                      <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                        <input value={empVal} onChange={e => setEmpVal(e.target.value)}
                          style={{ width: 100, padding: '2px 4px', border: '1px solid #2563eb', borderRadius: 3, fontSize: 11, fontFamily: 'monospace' }} />
                        <button onClick={() => saveEmp(p)} style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 7px', fontSize: 10, cursor: 'pointer' }}>OK</button>
                        <button onClick={() => setEditingEmp(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>×</button>
                      </span>
                    ) : (
                      <span style={{ color: p.emplacement ? '#334155' : '#94a3b8' }}>{p.emplacement || '-'}</span>
                    )}
                  </td>
                  <td style={{ ...S.td, textAlign: 'right', color: '#64748b', fontWeight: 600 }}>{seuil > 0 ? seuil : '-'}</td>
                  <td style={{ ...S.td, textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 3, justifyContent: 'center' }}>
                      <button onClick={() => { setEditingQty(p.id); setQtyVal(String(stock)); }}
                        style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 3, padding: '2px 7px', fontSize: 10, cursor: 'pointer', color: '#475569' }} title="Ajuster quantité">
                        📦 Qté
                      </button>
                      {canEdit && (
                        <button onClick={() => applySuggestion(p)}
                          style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 3, padding: '2px 7px', fontSize: 10, cursor: 'pointer', color: '#16a34a' }} title="Suggérer emplacement">
                          📍 Auto
                        </button>
                      )}
                      <button onClick={() => { setEditingEmp(p.id); setEmpVal(p.emplacement || ''); }}
                        style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 3, padding: '2px 7px', fontSize: 10, cursor: 'pointer', color: '#475569' }} title="Changer emplacement">
                        ✏️ Emp.
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {stockItems.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
                Aucun produit en stock
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

export function PreparationTab({ canEdit, canDelete = false, showMsg }) {
  const [preparations, setPreparations] = useState([]);
  const [produits, setProduits] = useState([]);
  const [form, setForm] = useState({ produit_id: '', quantite: '', destination: '', reference: '' });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { load(); api.getProduits().then(setProduits).catch(() => {}); }, []);

  async function load() {
    try {
      const res = await fetch('/api/warehouse/preparations', { credentials: 'same-origin' });
      if (res.ok) setPreparations(await res.json());
    } catch {}
  }

  async function save() {
    try {
      await fetch('/api/warehouse/preparations', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      showMsg('Préparation créée');
      setShowForm(false);
      setForm({ produit_id: '', quantite: '', destination: '', reference: '' });
      load();
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function updateStatus(id, status) {
    await fetch(`/api/warehouse/preparations/${id}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    load();
  }

  const statusColors = { en_attente: '#f59e0b', preparation: '#3b82f6', prete: '#8b5cf6', expediee: '#16a34a', annulee: '#dc2626' };

  return (
    <div className="warehouse-page warehouse-preparation">
      {canEdit && <button onClick={() => setShowForm(!showForm)} className="no-print" style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12, marginBottom: 10 }}>+ Nouvelle préparation</button>}

      {showForm && (
        <div className="no-print" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'end' }}>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Produit*</label>
            <select value={form.produit_id} onChange={e => setForm({ ...form, produit_id: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 160 }}>
              <option value="">Sélectionner...</option>
              {produits.map(p => <option key={p.id} value={p.id}>[{p.reference}] {p.designation}</option>)}
            </select>
          </div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Qté*</label><input value={form.quantite} onChange={e => setForm({ ...form, quantite: e.target.value })} type="number" min="1" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 70 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Destination</label><input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 130 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Réf commande</label><input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 100 }} /></div>
          <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Créer</button></div>
        </div>
      )}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead><tr>
            <th style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Réf</th>
            <th style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Produit</th>
            <th style={{ textAlign: 'right', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Qté</th>
            <th style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Destination</th>
            <th style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Statut</th>
            <th style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Date</th>
            <th style={{ padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}></th>
          </tr></thead>
          <tbody>
            {preparations.map(p => (
              <tr key={p.id}>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 11 }}>{p.reference || '-'}</td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{p.designation || p.produit_id}</td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700 }}>{p.quantite}</td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', color: '#64748b' }}>{p.destination}</td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ background: `${statusColors[p.status]}20`, color: statusColors[p.status], padding: '1px 7px', borderRadius: 8, fontSize: 11, fontWeight: 600 }}>{p.status}</span>
                </td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', color: '#94a3b8', fontSize: 11 }}>{p.created_at}</td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9' }}>
                  {canEdit && p.status === 'en_attente' && (
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button onClick={() => updateStatus(p.id, 'preparation')} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}>Préparer</button>
                      <button onClick={() => updateStatus(p.id, 'annulee')} style={{ background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}>×</button>
                    </div>
                  )}
                  {canEdit && p.status === 'preparation' && (
                    <button onClick={() => updateStatus(p.id, 'prete')} style={{ background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}>Prête</button>
                  )}
                  {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={async () => { if (!(await systemConfirm('Supprimer cette préparation ?'))) return; try { await api.request(`/warehouse/preparations/${p.id}`, { method: 'DELETE' }); setPreparations(current => current.filter(item => item.id !== p.id)); showMsg('Préparation supprimée'); } catch (error) { showMsg(error.message, 'error'); } }} style={{ marginLeft: 3, background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 3, padding: '2px 6px', fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>×</button>}
                </td>
              </tr>
            ))}
            {preparations.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12 }}>Aucune préparation</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ExpeditionTab({ canEdit, canDelete = false, showMsg }) {
  const [expeditions, setExpeditions] = useState([]);
  const [produits, setProduits] = useState([]);
  const [form, setForm] = useState({ produit_id: '', quantite: '', client_nom: '', adresse_livraison: '', transporteur: '' });
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { load(); api.getProduits().then(setProduits).catch(() => {}); }, []);

  async function load() {
    try {
      const res = await fetch('/api/warehouse/expeditions', { credentials: 'same-origin' });
      if (res.ok) setExpeditions(await res.json());
    } catch {}
  }

  async function save() {
    try {
      await fetch('/api/warehouse/expeditions', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      showMsg('Expédition créée');
      setShowForm(false);
      setForm({ produit_id: '', quantite: '', client_nom: '', adresse_livraison: '', transporteur: '' });
      load();
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function updateStatus(id, status) {
    await fetch(`/api/warehouse/expeditions/${id}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    load();
  }

  const statusColors = { preparation: '#f59e0b', expedition: '#3b82f6', livree: '#16a34a', retour: '#dc2626' };

  return (
    <div className="warehouse-page warehouse-expedition">
      {canEdit && <button onClick={() => setShowForm(!showForm)} className="no-print" style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12, marginBottom: 10 }}>+ Nouvelle expédition</button>}

      {showForm && (
        <div className="no-print" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'end' }}>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Produit*</label>
            <select value={form.produit_id} onChange={e => setForm({ ...form, produit_id: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 160 }}>
              <option value="">Sélectionner...</option>
              {produits.map(p => <option key={p.id} value={p.id}>[{p.reference}] {p.designation}</option>)}
            </select>
          </div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Qté*</label><input value={form.quantite} onChange={e => setForm({ ...form, quantite: e.target.value })} type="number" min="1" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 70 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Client</label><input value={form.client_nom} onChange={e => setForm({ ...form, client_nom: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 140 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Adresse</label><input value={form.adresse_livraison} onChange={e => setForm({ ...form, adresse_livraison: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 170 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Transporteur</label><input value={form.transporteur} onChange={e => setForm({ ...form, transporteur: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 120 }} /></div>
          <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>Créer</button></div>
        </div>
      )}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead><tr>
            <th style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Date</th>
            <th style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Produit</th>
            <th style={{ textAlign: 'right', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Qté</th>
            <th style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Client</th>
            <th style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Transporteur</th>
            <th style={{ textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>Statut</th>
            <th style={{ padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}></th>
          </tr></thead>
          <tbody>
            {expeditions.map(e => (
              <tr key={e.id}>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', color: '#94a3b8', fontSize: 11 }}>{e.created_at}</td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{e.designation || e.produit_id}</td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700 }}>{e.quantite}</td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', color: '#64748b' }}>{e.client_nom}</td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', color: '#64748b' }}>{e.transporteur}</td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ background: `${statusColors[e.status]}20`, color: statusColors[e.status], padding: '1px 7px', borderRadius: 8, fontSize: 11, fontWeight: 600 }}>{e.status}</span>
                </td>
                <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9' }}>
                  {canEdit && e.status === 'preparation' && (
                    <button onClick={() => updateStatus(e.id, 'expedition')} style={{ background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}>Expédier</button>
                  )}
                  {canEdit && e.status === 'expedition' && (
                    <button onClick={() => updateStatus(e.id, 'livree')} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}>Livrée</button>
                  )}
                  {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={async () => { if (!(await systemConfirm('Supprimer cette expédition ?'))) return; try { await api.request(`/warehouse/expeditions/${e.id}`, { method: 'DELETE' }); setExpeditions(current => current.filter(item => item.id !== e.id)); showMsg('Expédition supprimée'); } catch (error) { showMsg(error.message, 'error'); } }} style={{ marginLeft: 3, background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 3, padding: '2px 6px', fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>×</button>}
                </td>
              </tr>
            ))}
            {expeditions.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12 }}>Aucune expédition</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function GestionStockTab({ canEdit, canDelete = false, showMsg }) {
  const { formatMoney } = useCurrency();
  const [produits, setProduits] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [categorie, setCategorie] = useState('');
  const [categories, setCategories] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showMvt, setShowMvt] = useState(null);
  const [mvtList, setMvtList] = useState([]);
  const [form, setForm] = useState({ reference: '', designation: '', categorie: '', prix_ht: '', prix_vente: '', tva_rate: 20, unite: 'pièce', stock_min: 0, stock_max: '', emplacement: '', fournisseur: '', code_barre: '' });
  const [editId, setEditId] = useState(null);
  const [mvt, setMvt] = useState(null);
  const [mvtQty, setMvtQty] = useState(1);
  const [mvtMotif, setMvtMotif] = useState('');

  useEffect(() => { load(); loadStats(); loadCategories(); }, [search, categorie]);

  async function load() {
    let params = '';
    if (search) params += `?search=${encodeURIComponent(search)}`;
    if (categorie) params += `${params ? '&' : '?'}categorie=${encodeURIComponent(categorie)}`;
    const data = await api.getProduits(params);
    setProduits(data);
  }

  async function loadStats() {
    try { const s = await api.stockStats(); setStats(s); } catch {}
  }

  async function loadCategories() {
    try { const c = await api.getProduits('/categories'); setCategories(c); } catch {}
  }

  async function save() {
    try {
      if (editId) { await api.updateProduit(editId, form); showMsg('Produit modifié'); }
      else { await api.createProduit(form); showMsg('Produit créé'); }
      setShowForm(false); setEditId(null);
      setForm({ reference: '', designation: '', categorie: '', prix_ht: '', prix_vente: '', tva_rate: 20, unite: 'pièce', stock_min: 0, stock_max: '', emplacement: '', fournisseur: '', code_barre: '' });
      load(); loadStats();
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function remove(id) {
    if (!(await systemConfirm('Supprimer ce produit ?'))) return;
    try {
      await api.deleteProduit(id);
      showMsg('Produit supprimé');
      await Promise.all([load(), loadStats(), loadCategories()]);
    } catch (error) {
      showMsg(error.message || 'Suppression impossible', 'error');
    }
  }

  function edit(p) {
    setForm({
      reference: p.reference, designation: p.designation, categorie: p.categorie || '',
      prix_ht: p.prix_ht, prix_vente: p.prix_vente || '', tva_rate: p.tva_rate,
      unite: p.unite, stock_min: p.stock_min, stock_max: p.stock_max || '',
      emplacement: p.emplacement || '', fournisseur: p.fournisseur || '', code_barre: p.code_barre || ''
    });
    setEditId(p.id);
    setShowForm(true);
  }

  async function mouvement(id, type) {
    try {
      if (type === 'inventaire') { await api.inventaireStock(id, mvtQty, mvtMotif); }
      else { await api[type === 'entree' ? 'entreeStock' : 'sortieStock'](id, mvtQty, mvtMotif); }
      showMsg(`Stock ${type === 'entree' ? 'entré' : type === 'sortie' ? 'sorti' : 'inventorié'}`);
      setMvt(null); setMvtQty(1); setMvtMotif('');
      load(); loadStats();
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function viewMvt(id) {
    const data = await api.getMouvements(id);
    setMvtList(data);
    setShowMvt(showMvt === id ? null : id);
  }

  const th = { textAlign: 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' };
  const td = { padding: '4px 7px', borderBottom: '1px solid #f1f5f9' };

  return (
    <div className="warehouse-page warehouse-inventory">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 16, color: '#1e293b' }}>📦 Gestion des Stocks</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {canEdit && <button onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ reference: '', designation: '', categorie: '', prix_ht: '', prix_vente: '', tva_rate: 20, unite: 'pièce', stock_min: 0, stock_max: '', emplacement: '', fournisseur: '', code_barre: '' }); }} className="no-print" style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>+ Nouveau produit</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
        {[
          ['Produits', stats?.produits_count || 0, '#0f766e'],
          ['Stock faible', stats?.stock_faible || 0, '#dc2626'],
          ['Valeur stock', formatMoney(stats?.valeur_stock || 0, { decimals: 0 }), '#7c3aed'],
          ['Fournisseurs', stats?.nb_fournisseurs || 0, '#0891b2'],
        ].map(([l, v, c]) => (
          <div key={l} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>{l}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Référence, désignation, fournisseur..."
          style={{ flex: 1, padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none' }} />
        <select value={categorie} onChange={e => setCategorie(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12 }}>
          <option value="">Toutes catégories</option>
          {categories.map(c => <option key={c.categorie} value={c.categorie}>{c.categorie}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="no-print" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'end' }}>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Réf*</label><input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 90 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Désignation*</label><input value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 160 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Catégorie</label><input value={form.categorie} onChange={e => setForm({ ...form, categorie: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 100 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Fournisseur</label><input value={form.fournisseur} onChange={e => setForm({ ...form, fournisseur: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 120 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Emplacement</label><input value={form.emplacement} onChange={e => setForm({ ...form, emplacement: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 80 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Prix HT</label><input value={form.prix_ht} onChange={e => setForm({ ...form, prix_ht: e.target.value })} type="number" step="0.01" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 80 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Prix vente</label><input value={form.prix_vente} onChange={e => setForm({ ...form, prix_vente: e.target.value })} type="number" step="0.01" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 80 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Stock min</label><input value={form.stock_min} onChange={e => setForm({ ...form, stock_min: e.target.value })} type="number" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 50 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Stock max</label><input value={form.stock_max} onChange={e => setForm({ ...form, stock_max: e.target.value })} type="number" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 50 }} /></div>
          <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>{editId ? 'Modifier' : 'Ajouter'}</button></div>
        </div>
      )}

      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead><tr>
            <th style={th}>Réf</th><th style={th}>Désignation</th><th style={th}>Catégorie</th><th style={th}>Fournisseur</th>
            <th style={th}>Stock</th><th style={th}>Min</th><th style={th}>Emplacement</th><th style={{...th, textAlign:'right'}}>Prix HT</th>
            <th style={{...th, textAlign:'right'}}>Valeur</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {produits.map(p => {
              const stock = p.stock_actuel || 0;
              const faible = stock <= p.stock_min;
              const valeur = stock * Number(p.prix_ht);
              return (
                <tr key={p.id} style={{ background: faible ? '#fff7ed' : 'transparent' }}>
                  <td style={td}><span style={{ fontFamily: 'monospace', fontSize: 11, background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>{p.reference}</span></td>
                  <td style={{ ...td, fontWeight: 600 }}>{p.designation}</td>
                  <td style={td}><span style={{ fontSize: 11, color: '#64748b', background: '#f1f5f9', padding: '1px 5px', borderRadius: 3 }}>{p.categorie}</span></td>
                  <td style={{ ...td, fontSize: 11, color: '#64748b' }}>{p.fournisseur}</td>
                  <td style={{ ...td, fontWeight: 700, color: faible ? '#dc2626' : '#16a34a' }}>{stock} {p.unite}</td>
                  <td style={td}>{p.stock_min}</td>
                  <td style={{ ...td, fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>{p.emplacement}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{Number(p.prix_ht).toFixed(2)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#7c3aed' }}>{valeur.toFixed(2)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {mvt === p.id ? (
                      <div style={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <input type="number" value={mvtQty} onChange={e => setMvtQty(Number(e.target.value))} min="1" style={{ width: 45, padding: '2px 4px', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: 11 }} />
                        <input value={mvtMotif} onChange={e => setMvtMotif(e.target.value)} placeholder="motif" style={{ width: 65, padding: '2px 4px', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: 11 }} />
                        <button onClick={() => mouvement(p.id, 'entree')} title="Entrée" style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 11, cursor: 'pointer' }}>+</button>
                        <button onClick={() => mouvement(p.id, 'sortie')} title="Sortie" style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 11, cursor: 'pointer' }}>-</button>
                        <button onClick={() => setMvt(null)} style={{ background: '#f1f5f9', border: 'none', borderRadius: 3, padding: '2px 5px', fontSize: 11, cursor: 'pointer' }}>×</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                        <button onClick={() => viewMvt(p.id)} style={{ background: showMvt === p.id ? '#e2e8f0' : 'transparent', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 11, cursor: 'pointer' }} title="Mouvements">📋</button>
                        {canEdit && <button onClick={() => setMvt(p.id)} style={{ background: '#e2e8f0', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 11, cursor: 'pointer' }} title="Entrée/Sortie">📦</button>}
                        {canEdit && <button onClick={() => edit(p)} style={{ background: '#e2e8f0', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 11, cursor: 'pointer' }} title="Modifier">✎</button>}
                        {canDelete && <button className="admin-delete-action" onClick={() => remove(p.id)} style={{ background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: 3, padding: '2px 6px', fontSize: 11, cursor: 'pointer' }} title="Supprimer">×</button>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {produits.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12 }}>Aucun produit trouvé</td></tr>}
          </tbody>
        </table>
      </div>

      {showMvt && (
        <div style={{ marginTop: 8, border: '1px solid #e2e8f0', borderRadius: 8, background: '#f8fafc', padding: 10, maxHeight: 200, overflow: 'auto' }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#475569' }}>📋 Historique des mouvements</div>
          {mvtList.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', padding: 10 }}>Aucun mouvement</div> : (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
              <thead><tr>
                <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>Type</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>Qté</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>Avant</th>
                <th style={{ textAlign: 'right', padding: '3px 6px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>Après</th>
                <th style={{ textAlign: 'left', padding: '3px 6px', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>Motif</th>
              </tr></thead>
              <tbody>
                {mvtList.map(m => (
                  <tr key={m.id}>
                    <td style={{ padding: '3px 6px', borderBottom: '1px solid #f1f5f9', color: '#94a3b8' }}>{m.created_at}</td>
                    <td style={{ padding: '3px 6px', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ background: m.type === 'entree' ? '#dcfce7' : m.type === 'sortie' ? '#fef2f2' : '#fef3c7', color: m.type === 'entree' ? '#16a34a' : m.type === 'sortie' ? '#dc2626' : '#d97706', padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600 }}>{m.type}</span>
                    </td>
                    <td style={{ padding: '3px 6px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700 }}>{m.quantite}</td>
                    <td style={{ padding: '3px 6px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{m.stock_avant}</td>
                    <td style={{ padding: '3px 6px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700 }}>{m.stock_apres}</td>
                    <td style={{ padding: '3px 6px', borderBottom: '1px solid #f1f5f9', color: '#64748b' }}>{m.motif}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
