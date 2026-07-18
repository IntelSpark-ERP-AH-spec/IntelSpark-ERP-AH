import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';

export default function CommandesPage() {
  const t = useT();
  const { hasRole } = useAuth();
  const canDelete = hasRole('admin');
  const [commandes, setCommandes] = useState([]);
  const [stats, setStats] = useState(null);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [produits, setProduits] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ fournisseur_id: '', date_livraison_prevue: '', notes: '', items: [{ designation: '', quantite_commandee: 1, prix_unitaire_ht: 0, produit_id: '' }] });

  useEffect(() => { load(); loadStats(); api.getFournisseurs('').then(setFournisseurs); api.getProduits('').then(setProduits); }, []);

  async function load() { setCommandes(await api.getCommandes(filter ? `?status=${filter}` : '')); }
  async function loadStats() { setStats(await api.commandesStats()); }
  useEffect(() => { load(); }, [filter]);

  async function handleSave(e) {
    e.preventDefault();
    try {
      const cmd = await api.createCommande(form);
      setShowForm(false);
      setForm({ fournisseur_id: '', date_livraison_prevue: '', notes: '', items: [{ designation: '', quantite_commandee: 1, prix_unitaire_ht: 0, produit_id: '' }] });
      load(); loadStats();
    } catch (err) { alert(err.message); }
  }

  async function selectCmd(id) {
    const c = await api.getCommande(id);
    setSelected(c);
  }

  async function removeCmd(id, numero) {
    if (!canDelete) return;
    if (!(await systemConfirm(`Supprimer la commande ${numero} ?`))) return;
    try {
      await api.deleteCommande(id);
      setCommandes(current => current.filter(item => item.id !== id));
      setSelected(current => (current?.id === id ? null : current));
      loadStats();
    } catch (err) {
      alert(err.message);
    }
  }

  function addItem() {
    setForm({ ...form, items: [...form.items, { designation: '', quantite_commandee: 1, prix_unitaire_ht: 0, produit_id: '' }] });
  }

  function updateItem(index, field, value) {
    const items = [...form.items];
    items[index][field] = value;
    if (field === 'produit_id' && value) {
      const p = produits.find(pr => pr.id === value);
      if (p) { items[index].designation = p.designation; items[index].prix_unitaire_ht = p.prix_ht; }
    }
    setForm({ ...form, items });
  }

  function removeItem(index) {
    const items = form.items.filter((_, i) => i !== index);
    setForm({ ...form, items });
  }

  const btn = (c, fs) => ({ background: c || '#0d9488', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#fff', fontWeight: 700, fontSize: fs || 12, cursor: 'pointer', fontFamily: 'inherit' });

  return (
    <div className="ops-page ops-orders" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
      <div className="ops-title" style={{ fontWeight: 900, fontSize: 18, color: '#1e293b' }}>📋 {t("Commandes d'Achat")}</div>

      {stats && <div className="ops-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px,1fr))', gap: 8 }}>
        {[{l:'Total', v:stats.total, c:'#3b82f6'},{l:'En attente', v:stats.enAttente, c:'#f59e0b'},{l:'En cours', v:stats.enCours, c:'#8b5cf6'},{l:'Total HT', v:`${(stats.totalHt||0).toLocaleString()} DH`, c:'#10b981'}].map((s,i)=>(
          <div key={i} style={{background:'#fff', borderRadius:8, padding:12, borderLeft:`4px solid ${s.c}`, boxShadow:'0 1px 4px rgba(0,0,0,0.06)'}}>
            <div style={{fontSize:11, color:'#64748b', fontWeight:600}}>{s.l}</div>
            <div style={{fontSize:18, fontWeight:900, color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>}

      <div className="ops-toolbar" style={{display:'flex', gap:8}}>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{padding:'8px 12px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit'}}>
          <option value="">Toutes</option>
          <option value="en_attente">En attente</option><option value="validee">Validée</option>
          <option value="livree_partielle">Livrée partielle</option><option value="livree">Livrée</option>
        </select>
        <button onClick={() => setShowForm(true)} style={btn()}>+ Nouvelle commande</button>
      </div>

      {showForm && <form className="ops-form ops-order-form" onSubmit={handleSave} style={{background:'#fff', borderRadius:10, padding:16, border:'1px solid #e2e8f0'}}>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px,1fr))', gap:10, marginBottom:10}}>
          <select required value={form.fournisseur_id} onChange={e => setForm({...form, fournisseur_id: e.target.value})} style={{padding:'8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit'}}>
            <option value="">Fournisseur *</option>
            {fournisseurs.map(f => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
          <input type="date" placeholder="Livraison prévue" value={form.date_livraison_prevue} onChange={e => setForm({...form, date_livraison_prevue: e.target.value})} style={{padding:'8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit'}} />
        </div>

        <div style={{fontWeight:700, fontSize:13, marginBottom:6}}>Articles</div>
        {form.items.map((item, i) => (
          <div key={i} style={{display:'flex', gap:6, marginBottom:6, alignItems:'center'}}>
            <select value={item.produit_id} onChange={e => updateItem(i, 'produit_id', e.target.value)} style={{flex:2, padding:'6px', borderRadius:4, border:'1px solid #e2e8f0', fontSize:12, fontFamily:'inherit'}}>
              <option value="">Article manuel</option>
              {produits.map(p => <option key={p.id} value={p.id}>{p.reference} - {p.designation}</option>)}
            </select>
            <input placeholder="Désignation" value={item.designation} onChange={e => updateItem(i, 'designation', e.target.value)} style={{flex:2, padding:'6px', borderRadius:4, border:'1px solid #e2e8f0', fontSize:12, fontFamily:'inherit'}} />
            <input type="number" placeholder="Qté" value={item.quantite_commandee} onChange={e => updateItem(i, 'quantite_commandee', Number(e.target.value))} style={{width:60, padding:'6px', borderRadius:4, border:'1px solid #e2e8f0', fontSize:12, fontFamily:'inherit'}} />
            <input type="number" placeholder="Prix HT" value={item.prix_unitaire_ht} onChange={e => updateItem(i, 'prix_unitaire_ht', Number(e.target.value))} style={{width:80, padding:'6px', borderRadius:4, border:'1px solid #e2e8f0', fontSize:12, fontFamily:'inherit'}} />
            {canDelete && <button type="button" className="admin-delete-action" title="Supprimer" onClick={() => removeItem(i)} style={{...btn('#dc2626', 11)}}>×</button>}
          </div>
        ))}
        <button type="button" onClick={addItem} style={{...btn('#3b82f6', 11), marginBottom:10}}>+ Article</button>
        <div style={{display:'flex', gap:8}}>
          <button type="submit" style={btn()}>Créer commande</button>
          <button type="button" onClick={() => setShowForm(false)} style={{...btn(), background:'#94a3b8'}}>Annuler</button>
        </div>
      </form>}

      <div className="ops-card-grid" style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px,1fr))', gap:10}}>
        {commandes.map(c => (
          <div className="ops-card" key={c.id} onClick={() => selectCmd(c.id)} style={{background: selected?.id === c.id ? '#f0fdf9' : '#fff', borderRadius:10, padding:14, border:`2px solid ${selected?.id === c.id ? '#0d9488' : '#e2e8f0'}`, cursor:'pointer', boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
            <div className="ops-card-header" style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
              <strong style={{color:'#0d9488'}}>{c.numero}</strong>
              <div style={{display:'flex', alignItems:'center', gap:6}}>
                <span style={{fontSize:11, padding:'2px 8px', borderRadius:4, fontWeight:600,
                  background: c.status === 'livree' ? '#ecfdf5' : c.status === 'validee' ? '#eff6ff' : '#fffbeb',
                  color: c.status === 'livree' ? '#10b981' : c.status === 'validee' ? '#3b82f6' : '#f59e0b'}}>
                  {c.status}
                </span>
                {canDelete && <button type="button" className="admin-delete-action" onClick={(e) => { e.stopPropagation(); removeCmd(c.id, c.numero); }} title="Supprimer" style={{ background:'#fff', color:'#dc2626', border:'1px solid #fecaca', borderRadius:6, width:24, height:24, lineHeight:'20px', padding:0, fontWeight:900, cursor:'pointer' }}>×</button>}
              </div>
            </div>
            <div style={{fontSize:13, color:'#475569'}}>🏭 {c.fournisseur_nom}</div>
            <div style={{fontSize:12, color:'#64748b'}}>💰 {c.total_ht?.toLocaleString()} DH HT</div>
            {c.date_livraison_prevue && <div style={{fontSize:12, color:'#64748b'}}>📅 {c.date_livraison_prevue}</div>}
          </div>
        ))}
      </div>

      {selected && <div className="ops-detail" style={{background:'#fff', borderRadius:10, padding:14, border:'1px solid #e2e8f0'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:10}}>
          <div style={{fontWeight:900, fontSize:14, color:'#0d9488'}}>{selected.numero} - {selected.fournisseur_nom}</div>
          {canDelete && <button type="button" className="admin-delete-action" onClick={() => removeCmd(selected.id, selected.numero)} style={{ background:'#fff', color:'#dc2626', border:'1px solid #fecaca', borderRadius:6, padding:'6px 10px', fontWeight:800, cursor:'pointer' }}>Supprimer</button>}
        </div>
        <div style={{fontSize:12, color:'#64748b', marginBottom:8}}>Total: {selected.total_ht?.toLocaleString()} DH HT | {selected.total_ttc?.toLocaleString()} DH TTC</div>
        <div style={{width:'100%', fontSize:13}}>
          <div style={{display:'flex', padding:'8px 0', borderBottom:'2px solid #e2e8f0', fontWeight:700, background:'#f8fafc'}}>
            <div style={{flex:3}}>Produit</div>
            <div style={{flex:1, textAlign:'right'}}>Qte</div>
            <div style={{flex:1, textAlign:'right'}}>Recue</div>
            <div style={{flex:1, textAlign:'right'}}>Prix HT</div>
            <div style={{flex:1, textAlign:'right'}}>Total</div>
          </div>
          {selected.items?.map(item => (
            <div key={item.id} style={{display:'flex', padding:'6px 0', borderBottom:'1px solid #e2e8f0'}}>
              <div style={{flex:3}}>{item.reference ? item.reference + ' - ' : ''}{item.designation}</div>
              <div style={{flex:1, textAlign:'right'}}>{item.quantite_commandee}</div>
              <div style={{flex:1, textAlign:'right', color: item.quantite_recue >= item.quantite_commandee ? '#10b981' : '#f59e0b'}}>{item.quantite_recue || 0}</div>
              <div style={{flex:1, textAlign:'right'}}>{Number(item.prix_unitaire_ht).toFixed(2)}</div>
              <div style={{flex:1, textAlign:'right'}}>{(item.quantite_commandee * item.prix_unitaire_ht).toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>}
    </div>
  );
}
