import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';

export default function FournisseursPage() {
  const t = useT();
  const { hasRole } = useAuth();
  const canDelete = hasRole('admin');
  const [fournisseurs, setFournisseurs] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ nom: '', contact: '', email: '', telephone: '', adresse: '', siret: '', ice: '', categorie: '', notes: '' });

  useEffect(() => { load(); }, [search]);

  async function load() {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    setFournisseurs(await api.getFournisseurs('?' + params.toString()));
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (editing) await api.updateFournisseur(editing.id, form);
      else await api.createFournisseur(form);
      setShowForm(false); setEditing(null);
      setForm({ nom: '', contact: '', email: '', telephone: '', adresse: '', siret: '', ice: '', categorie: '', notes: '' });
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id) {
    if (!canDelete) return;
    if (!(await systemConfirm('Supprimer ce fournisseur ?'))) return;
    await api.deleteFournisseur(id);
    setFournisseurs(current => current.filter(item => item.id !== id));
  }

  function edit(f) {
    setEditing(f);
    setForm({ nom: f.nom, contact: f.contact || '', email: f.email || '', telephone: f.telephone || '', adresse: f.adresse || '', siret: f.siret || '', ice: f.ice || '', categorie: f.categorie || '', notes: f.notes || '' });
    setShowForm(true);
  }

  const btn = (c) => ({ background: c || '#0d9488', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' });
  const inp = () => ({ padding: '8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit' });

  return (
    <div className="ops-page ops-suppliers" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
      <div className="ops-title" style={{ fontWeight: 900, fontSize: 18, color: '#1e293b' }}>🏭 {t('Fournisseurs')}</div>
      <div className="ops-toolbar" style={{display:'flex', gap:8}}>
        <input placeholder="Recherche fournisseur..." value={search} onChange={e => setSearch(e.target.value)}
          style={{flex:1, minWidth:200, ...inp()}} />
        <button onClick={() => { setEditing(null); setForm({ nom:'', contact:'', email:'', telephone:'', adresse:'', siret:'', ice:'', categorie:'', notes:'' }); setShowForm(true); }} style={btn()}>+ Fournisseur</button>
      </div>

      {showForm && <form className="ops-form" onSubmit={handleSave} style={{background:'#fff', borderRadius:10, padding:16, border:'1px solid #e2e8f0', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:10}}>
        <input required placeholder="Nom *" value={form.nom} onChange={e => setForm({...form, nom: e.target.value})} style={inp()} />
        <input placeholder="Contact" value={form.contact} onChange={e => setForm({...form, contact: e.target.value})} style={inp()} />
        <input placeholder="Email" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} style={inp()} />
        <input placeholder="Téléphone" value={form.telephone} onChange={e => setForm({...form, telephone: e.target.value})} style={inp()} />
        <input placeholder="SIRET" value={form.siret} onChange={e => setForm({...form, siret: e.target.value})} style={inp()} />
        <input placeholder="ICE" value={form.ice} onChange={e => setForm({...form, ice: e.target.value})} style={inp()} />
        <input placeholder="Catégorie" value={form.categorie} onChange={e => setForm({...form, categorie: e.target.value})} style={inp()} />
        <input placeholder="Adresse" value={form.adresse} onChange={e => setForm({...form, adresse: e.target.value})} style={{gridColumn:'1/-1', ...inp()}} />
        <div style={{gridColumn:'1/-1', display:'flex', gap:8}}>
          <button type="submit" style={btn()}>{editing ? 'Mettre à jour' : 'Ajouter'}</button>
          <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} style={{...btn(), background:'#94a3b8'}}>Annuler</button>
        </div>
      </form>}

      <div className="ops-card-grid" style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px,1fr))', gap:10}}>
        {fournisseurs.map(f => (
          <div className="ops-card" key={f.id} style={{background:'#fff', borderRadius:10, padding:14, border:'1px solid #e2e8f0', boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
            <div className="ops-card-header" style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
              <strong style={{fontSize:14}}>{f.nom}</strong>
              {f.categorie && <span style={{fontSize:11, padding:'2px 8px', borderRadius:4, background:'#f0fdf9', color:'#0d9488', fontWeight:600}}>{f.categorie}</span>}
            </div>
            {f.contact && <div style={{fontSize:12, color:'#475569'}}>👤 {f.contact}</div>}
            {f.email && <div style={{fontSize:12, color:'#3b82f6'}}>✉️ {f.email}</div>}
            {f.telephone && <div style={{fontSize:12, color:'#64748b'}}>📞 {f.telephone}</div>}
            {f.siret && <div style={{fontSize:11, color:'#94a3b8'}}>SIRET: {f.siret}</div>}
            {f.ice && <div style={{fontSize:11, color:'#94a3b8'}}>ICE: {f.ice}</div>}
            {f.notes && <div style={{fontSize:12, color:'#64748b', marginTop:4, fontStyle:'italic'}}>{f.notes}</div>}
            <div className="ops-actions" style={{display:'flex', gap:6, marginTop:8}}>
              <button onClick={() => edit(f)} style={{...btn(), background:'#3b82f6'}}>✏️</button>
              {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => handleDelete(f.id)} style={{...btn(), background:'#dc2626'}}>×</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
