import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';

import { useT } from '../appI18n';

export default function AtelierPage() {
  const t = useT();
  const { hasRole } = useAuth();
  const canDelete = hasRole('admin');
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selected, setSelected] = useState(null);
  const [vehicules, setVehicules] = useState([]);
  const [techniciens, setTechniciens] = useState([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({ vehicule_id: '', type: 'maintenance', description: '', priorite: 'normale', date_fin_prevue: '', technicien_id: '', client_nom: '', diagnostic: '', notes: '' });
  const [opForm, setOpForm] = useState({ description: '', duree_estimee: '', main_oeuvre: '' });

  useEffect(() => { load(); loadStats(); api.getVehicules('').then(setVehicules); api.getEmployes('?status=actif').then(setTechniciens); }, []);

  async function load() { setOrders(await api.getAtelierOrders(filter ? `?status=${filter}` : '')); }
  async function loadStats() { setStats(await api.atelierStats()); }
  useEffect(() => { load(); }, [filter]);

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (editing) await api.updateAtelierOrder(editing.id, form);
      else await api.createAtelierOrder(form);
      setShowForm(false); setEditing(null);
      setForm({ vehicule_id: '', type: 'maintenance', description: '', priorite: 'normale', date_fin_prevue: '', technicien_id: '', client_nom: '', diagnostic: '', notes: '' });
      load(); loadStats();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id) {
    if (!canDelete) return;
    if (!(await systemConfirm('Supprimer cet ordre ?'))) return;
    await api.deleteAtelierOrder(id);
    setOrders(current => current.filter(item => item.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  async function handleDeleteOperation(orderId, operationId) {
    if (!canDelete || !(await systemConfirm('Supprimer cette opération ?'))) return;
    await api.deleteAtelierOperation(orderId, operationId);
    setSelected(current => current?.id === orderId
      ? { ...current, operations: (current.operations || []).filter(item => item.id !== operationId) }
      : current);
  }

  async function addOperation(e) {
    e.preventDefault();
    if (!selected) return;
    await api.addAtelierOperation(selected.id, opForm);
    setOpForm({ description: '', duree_estimee: '', main_oeuvre: '' });
    const updated = await api.getAtelierOrder(selected.id);
    setSelected(updated);
  }

  async function selectOrder(id) {
    const o = await api.getAtelierOrder(id);
    setSelected(o);
  }

  const btn = (c, fs) => ({ background: c || '#0d9488', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#fff', fontWeight: 700, fontSize: fs || 12, cursor: 'pointer', fontFamily: 'inherit' });

  return (
    <div className="ops-page ops-workshop" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
      <div className="ops-title" style={{ fontWeight: 900, fontSize: 18, color: '#1e293b' }}>🔧 {t('Atelier — Ordres de Travail')}</div>

      {stats && <div className="ops-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px,1fr))', gap: 8 }}>
        {[{l:'Total', v:stats.total, c:'#3b82f6'},{l:'En attente', v:stats.enAttente, c:'#f59e0b'},{l:'En cours', v:stats.enCours, c:'#8b5cf6'},{l:'Terminés', v:stats.termines, c:'#10b981'}].map((s,i)=>(
          <div key={i} style={{background:'#fff', borderRadius:8, padding:12, borderLeft:`4px solid ${s.c}`, boxShadow:'0 1px 4px rgba(0,0,0,0.06)'}}>
            <div style={{fontSize:11, color:'#64748b', fontWeight:600}}>{s.l}</div>
            <div style={{fontSize:18, fontWeight:900, color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>}

      <div className="ops-toolbar" style={{display:'flex', gap:8}}>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={inp()}>
          <option value="">Tous</option><option value="en_attente">En attente</option><option value="en_cours">En cours</option><option value="termine">Terminé</option>
        </select>
        <button onClick={() => { setEditing(null); setShowForm(true); }} style={btn()}>+ Ordre de travail</button>
      </div>

      {showForm && <form className="ops-form" onSubmit={handleSave} style={{background:'#fff', borderRadius:10, padding:16, border:'1px solid #e2e8f0', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:10}}>
        <select required value={form.vehicule_id} onChange={e => setForm({...form, vehicule_id:e.target.value})} style={inp()}>
          <option value="">Véhicule *</option>
          {vehicules.map(v => <option key={v.id} value={v.id}>{v.immatriculation}</option>)}
        </select>
        <select value={form.type} onChange={e => setForm({...form, type:e.target.value})} style={inp()}>
          <option value="maintenance">Maintenance</option><option value="reparation">Réparation</option><option value="controle">Contrôle</option><option value="montage">Montage</option><option value="autre">Autre</option>
        </select>
        <input required placeholder="Description *" value={form.description} onChange={e => setForm({...form, description:e.target.value})} style={inp()} />
        <select value={form.priorite} onChange={e => setForm({...form, priorite:e.target.value})} style={inp()}>
          <option value="basse">Basse</option><option value="normale">Normale</option><option value="haute">Haute</option>
        </select>
        <input placeholder="Date fin prévue" type="date" value={form.date_fin_prevue} onChange={e => setForm({...form, date_fin_prevue:e.target.value})} style={inp()} />
        <select value={form.technicien_id} onChange={e => setForm({...form, technicien_id:e.target.value})} style={inp()}>
          <option value="">Technicien</option>
          {techniciens.map(t => <option key={t.id} value={t.id}>{t.prenom} {t.nom}</option>)}
        </select>
        <input placeholder="Client" value={form.client_nom} onChange={e => setForm({...form, client_nom:e.target.value})} style={inp()} />
        <textarea placeholder="Diagnostic" value={form.diagnostic} onChange={e => setForm({...form, diagnostic:e.target.value})} style={{gridColumn:'1/-1', padding:8, borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit'}} rows={2} />
        <div style={{gridColumn:'1/-1', display:'flex', gap:8}}>
          <button type="submit" style={btn()}>{editing ? 'Mettre à jour' : 'Créer'}</button>
          <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} style={{...btn(), background:'#94a3b8'}}>Annuler</button>
        </div>
      </form>}

      <div style={{display:'flex', gap:14}}>
        <div className="ops-card-grid" style={{flex:1, display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px,1fr))', gap:10}}>
          {orders.map(o => (
            <div className="ops-card" key={o.id} onClick={() => selectOrder(o.id)} style={{background: selected?.id === o.id ? '#f0fdf9' : '#fff', borderRadius:10, padding:12, border:`2px solid ${selected?.id === o.id ? '#0d9488' : '#e2e8f0'}`, cursor:'pointer', boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:8}}><span style={{fontWeight:700, fontSize:13, color:'#0d9488'}}>{o.numero}</span>{canDelete && <button type="button" className="admin-delete-action" title="Supprimer" onClick={(event) => { event.stopPropagation(); handleDelete(o.id); }} style={{background:'#fff',color:'#dc2626',border:'1px solid #fecaca',borderRadius:5,width:23,height:23,padding:0,fontWeight:900,cursor:'pointer'}}>×</button>}</div>
              <div style={{fontSize:13}}>{o.immatriculation} — {o.description?.slice(0,60)}</div>
              <div style={{fontSize:12, color:'#64748b', display:'flex', gap:6, marginTop:4}}>
                <span style={{padding:'1px 6px', borderRadius:3, fontWeight:600,
                  background: o.status === 'termine' ? '#ecfdf5' : o.status === 'en_cours' ? '#eff6ff' : '#fffbeb',
                  color: o.status === 'termine' ? '#10b981' : o.status === 'en_cours' ? '#3b82f6' : '#f59e0b'}}>{o.status}</span>
                {o.technicien_nom && <span>👤 {o.technicien_nom}</span>}
              </div>
            </div>
          ))}
        </div>

        {selected && <div className="ops-detail" style={{width:350, background:'#fff', borderRadius:10, padding:14, border:'1px solid #e2e8f0', maxHeight:500, overflow:'auto'}}>
          <div style={{fontWeight:900, fontSize:14, color:'#0d9488', marginBottom:8}}>{selected.numero}</div>
          <div style={{fontSize:13, marginBottom:4}}>🚛 {selected.immatriculation}</div>
          <div style={{fontSize:12, color:'#475569', marginBottom:8}}>{selected.description}</div>
          {selected.diagnostic && <div style={{fontSize:12, background:'#fffbeb', padding:8, borderRadius:6, marginBottom:8}}>🔍 {selected.diagnostic}</div>}

          <div style={{fontWeight:700, fontSize:13, marginBottom:6}}>Opérations</div>
          {selected.operations?.map(op => (
            <div key={op.id} style={{background:'#f8fafc', padding:'6px 10px', borderRadius:6, marginBottom:4, fontSize:12, border:'1px solid #e2e8f0'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:8}}><span>{op.description}</span>{canDelete && <button type="button" className="admin-delete-action" title="Supprimer" onClick={() => handleDeleteOperation(selected.id, op.id)} style={{background:'transparent',border:0,color:'#dc2626',fontWeight:900,cursor:'pointer'}}>×</button>}</div>
              {op.duree_estimee && <div style={{color:'#64748b'}}>⏱️ {op.duree_estimee}h {op.main_oeuvre ? `| 💰 ${op.main_oeuvre} DH` : ''}</div>}
            </div>
          ))}

          <form onSubmit={addOperation} style={{display:'flex', flexDirection:'column', gap:6, marginTop:8}}>
            <input required placeholder="Nouvelle opération..." value={opForm.description} onChange={e => setOpForm({...opForm, description:e.target.value})} style={inpSmall()} />
            <div style={{display:'flex', gap:6}}>
              <input placeholder="Durée (h)" type="number" value={opForm.duree_estimee} onChange={e => setOpForm({...opForm, duree_estimee:e.target.value})} style={{...inpSmall(), width:80}} />
              <input placeholder="MO (DH)" type="number" value={opForm.main_oeuvre} onChange={e => setOpForm({...opForm, main_oeuvre:e.target.value})} style={{...inpSmall(), width:100}} />
              <button type="submit" style={btn('#0d9488', 11)}>+</button>
            </div>
          </form>
        </div>}
      </div>
    </div>
  );
}

function inp() { return { padding:'8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit' }; }
function inpSmall() { return { padding:'6px 8px', borderRadius:4, border:'1px solid #e2e8f0', fontSize:12, fontFamily:'inherit' }; }
