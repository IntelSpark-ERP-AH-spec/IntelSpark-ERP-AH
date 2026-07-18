import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';
import { useCurrency } from '../CurrencyContext';

export default function StockPage() {
  const t = useT();
  const { formatMoney } = useCurrency();
  const { hasRole } = useAuth();
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
  const [notify, setNotify] = useState(null);
  const canEdit = hasRole('admin', 'magasinier');
  const canDelete = hasRole('admin');

  useEffect(() => { load(); loadStats(); loadCategories(); }, [search, categorie]);

  async function load() {
    let params = '';
    if (search) params += `?search=${encodeURIComponent(search)}`;
    if (categorie) params += `${params ? '&' : '?'}categorie=${encodeURIComponent(categorie)}`;
    const data = await api.getProduits(params);
    setProduits(data);
  }

  async function loadStats() {
    try { const s = await api.getDashboard(); setStats(s); } catch {}
  }

  async function loadCategories() {
    try { const c = await api.getProduits('/categories'); setCategories(c); } catch {}
  }

  function showMsg(msg, type = 'info') { setNotify({ msg, type }); setTimeout(() => setNotify(null), 3000); }

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
    await api.deleteProduit(id);
    showMsg('Produit supprimé');
    load(); loadStats();
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
    <div>
      {notify && <div style={{ position: 'fixed', top: 16, right: 16, background: notify.type === 'error' ? '#fef2f2' : '#f0fdf4', color: notify.type === 'error' ? '#dc2626' : '#16a34a', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, zIndex: 9999, border: `1px solid ${notify.type === 'error' ? '#fecaca' : '#bbf7d0'}` }}>{notify.msg}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 900, fontSize: 16, color: '#1e293b' }}>📦 {t('Gestion des Stocks')}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {canEdit && <button onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ reference: '', designation: '', categorie: '', prix_ht: '', prix_vente: '', tva_rate: 20, unite: 'pièce', stock_min: 0, stock_max: '', emplacement: '', fournisseur: '', code_barre: '' }); }} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, padding: '5px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>+ Nouveau produit</button>}
        </div>
      </div>

      {/* Stats */}
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

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Référence, désignation, fournisseur..."
          style={{ flex: 1, padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none' }} />
        <select value={categorie} onChange={e => setCategorie(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12 }}>
          <option value="">Toutes catégories</option>
          {categories.map(c => <option key={c.categorie} value={c.categorie}>{c.categorie}</option>)}
        </select>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'end' }}>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Réf*</label><input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 90 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Désignation*</label><input value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 160 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Catégorie</label><input value={form.categorie} onChange={e => setForm({ ...form, categorie: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 100 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Fournisseur</label><input value={form.fournisseur} onChange={e => setForm({ ...form, fournisseur: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 120 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Emplacement</label><input value={form.emplacement} onChange={e => setForm({ ...form, emplacement: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 80 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Prix HT</label><input value={form.prix_ht} onChange={e => setForm({ ...form, prix_ht: e.target.value })} type="number" step="0.01" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 80 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Prix vente</label><input value={form.prix_vente} onChange={e => setForm({ ...form, prix_vente: e.target.value })} type="number" step="0.01" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 80 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>TVA%</label><input value={form.tva_rate} onChange={e => setForm({ ...form, tva_rate: e.target.value })} type="number" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 50 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Stock min</label><input value={form.stock_min} onChange={e => setForm({ ...form, stock_min: e.target.value })} type="number" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 50 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Stock max</label><input value={form.stock_max} onChange={e => setForm({ ...form, stock_max: e.target.value })} type="number" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 50 }} /></div>
          <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>{editId ? 'Modifier' : 'Ajouter'}</button></div>
        </div>
      )}

      {/* Table */}
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

      {/* Mouvements */}
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
