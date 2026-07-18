import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';

const TYPE_LABELS = {
  vidange: 'Vidange', freins: 'Freins', pneus: 'Pneus', embrayage: 'Embrayage',
  boite: 'Boîte de vitesses', direction: 'Direction', suspension: 'Suspension',
  electricite: 'Électricité', climatisation: 'Climatisation', carrosserie: 'Carrosserie', autre: 'Autre'
};
const PRIORITY_COLORS = { basse: '#94a3b8', normale: '#3b82f6', haute: '#f59e0b', urgente: '#dc2626' };

export default function MaintenancePage() {
  const t = useT();
  const { hasRole } = useAuth();
  const canDelete = hasRole('admin');
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ vehicule_id: '', type: 'vidange', description: '', priorite: 'normale', date_planification: '', cout_pieces: '', cout_main_oeuvre: '', fournisseur: '', notes: '' });
  const [vehicules, setVehicules] = useState([]);

  useEffect(() => { load(); loadStats(); api.getVehicules('?status=actif').then(setVehicules); }, []);

  async function load() { setTasks(await api.getMaintenance('')); }
  async function loadStats() { setStats(await api.maintenanceStats()); }

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (editing) await api.updateMaintenance(editing.id, form);
      else await api.createMaintenance(form);
      setShowForm(false); setEditing(null);
      setForm({ vehicule_id: '', type: 'vidange', description: '', priorite: 'normale', date_planification: '', cout_pieces: '', cout_main_oeuvre: '', fournisseur: '', notes: '' });
      load(); loadStats();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id) {
    if (!canDelete) return;
    if (!(await systemConfirm('Supprimer cette tâche ?'))) return;
    await api.deleteMaintenance(id);
    setTasks(current => current.filter(item => item.id !== id));
    loadStats();
  }

  async function updateStatus(task, status) {
    await api.updateMaintenance(task.id, { ...task, status });
    load(); loadStats();
  }

  const btn = (c) => ({ background: c || '#0d9488', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' });

  return (
    <div className="ops-page ops-maintenance" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
      <div className="ops-title" style={{ fontWeight: 900, fontSize: 18, color: '#1e293b' }}>🔧 {t('Maintenance des Véhicules')}</div>

      {stats && <div className="ops-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px,1fr))', gap: 8 }}>
        {[{l:'Total', v:stats.total, c:'#3b82f6'},{l:'En cours', v:stats.enCours, c:'#f59e0b'},{l:'Planifiées', v:stats.planifiees, c:'#8b5cf6'},{l:'Urgentes', v:stats.urgentes, c:'#dc2626'},{l:'Coût total', v:`${(stats.coutTotal||0).toLocaleString()} DH`, c:'#10b981'},{l:'Ce mois', v:stats.ceMois, c:'#ec4899'}].map((s,i)=>(
          <div key={i} style={{background:'#fff', borderRadius:8, padding:12, borderLeft:`4px solid ${s.c}`, boxShadow:'0 1px 4px rgba(0,0,0,0.06)'}}>
            <div style={{fontSize:11, color:'#64748b', fontWeight:600}}>{s.l}</div>
            <div style={{fontSize:18, fontWeight:900, color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>}

      <div className="ops-toolbar"><span>Planification et suivi atelier</span><button onClick={() => { setEditing(null); setForm({ vehicule_id: '', type: 'vidange', description: '', priorite: 'normale', date_planification: '', cout_pieces: '', cout_main_oeuvre: '', fournisseur: '', notes: '' }); setShowForm(true); }} style={btn()}>+ Nouvelle tâche</button></div>

      {showForm && <form className="ops-form" onSubmit={handleSave} style={{background:'#fff', borderRadius:10, padding:16, border:'1px solid #e2e8f0', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:10}}>
        <select required value={form.vehicule_id} onChange={e => setForm({...form, vehicule_id: e.target.value})} style={inp()}>
          <option value="">Sélectionner véhicule *</option>
          {vehicules.map(v => <option key={v.id} value={v.id}>{v.immatriculation} - {v.marque} {v.modele}</option>)}
        </select>
        <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} style={inp()}>
          {Object.entries(TYPE_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input required placeholder="Description *" value={form.description} onChange={e => setForm({...form, description: e.target.value})} style={inp()} />
        <select value={form.priorite} onChange={e => setForm({...form, priorite: e.target.value})} style={inp()}>
          <option value="basse">Basse</option><option value="normale">Normale</option><option value="haute">Haute</option><option value="urgente">Urgente</option>
        </select>
        <input placeholder="Date planification" type="date" value={form.date_planification} onChange={e => setForm({...form, date_planification: e.target.value})} style={inp()} />
        <input placeholder="Coût pièces (DH)" type="number" value={form.cout_pieces} onChange={e => setForm({...form, cout_pieces: e.target.value})} style={inp()} />
        <input placeholder="Main d'oeuvre (DH)" type="number" value={form.cout_main_oeuvre} onChange={e => setForm({...form, cout_main_oeuvre: e.target.value})} style={inp()} />
        <input placeholder="Fournisseur" value={form.fournisseur} onChange={e => setForm({...form, fournisseur: e.target.value})} style={inp()} />
        <div style={{gridColumn:'1/-1', display:'flex', gap:8}}>
          <button type="submit" style={btn()}>{editing ? 'Mettre à jour' : 'Créer'}</button>
          <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} style={{...btn(), background:'#94a3b8'}}>Annuler</button>
        </div>
      </form>}

      <div className="ops-card-grid" style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px,1fr))', gap:10}}>
        {tasks.map(t => (
          <div className="ops-card" key={t.id} style={{background:'#fff', borderRadius:10, padding:14, border:`2px solid ${PRIORITY_COLORS[t.priorite] || '#e2e8f0'}`, boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
            <div className="ops-card-header" style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6}}>
              <span style={{fontWeight:700, fontSize:14}}>{t.immatriculation} — {TYPE_LABELS[t.type]}</span>
              <span style={{fontSize:11, padding:'2px 8px', borderRadius:4, fontWeight:600,
                background: t.status === 'terminee' ? '#ecfdf5' : t.status === 'en_cours' ? '#eff6ff' : '#fffbeb',
                color: t.status === 'terminee' ? '#10b981' : t.status === 'en_cours' ? '#3b82f6' : '#f59e0b'}}>
                {t.status}
              </span>
            </div>
            <div style={{fontSize:13, color:'#475569'}}>{t.description}</div>
            <div style={{fontSize:12, color:'#64748b', marginTop:4}}>
              {t.priorite === 'urgente' && <span style={{color:'#dc2626', fontWeight:700}}>🔴 URGENT </span>}
              {t.date_planification && <span>📅 {t.date_planification} </span>}
              {t.cout_total > 0 && <span>💰 {t.cout_total.toLocaleString()} DH</span>}
            </div>
            <div className="ops-actions" style={{display:'flex', gap:6, marginTop:8, flexWrap:'wrap'}}>
              {t.status === 'planifiee' && <button onClick={() => updateStatus(t, 'en_cours')} style={btn('#3b82f6', 11)}>▶️ Démarrer</button>}
              {t.status === 'en_cours' && <button onClick={() => updateStatus(t, 'terminee')} style={btn('#10b981', 11)}>✅ Terminer</button>}
              <button onClick={() => { setEditing(t); setForm({ vehicule_id: t.vehicule_id, type: t.type, description: t.description, priorite: t.priorite, date_planification: t.date_planification || '', cout_pieces: t.cout_pieces || '', cout_main_oeuvre: t.cout_main_oeuvre || '', fournisseur: t.fournisseur || '', notes: t.notes || '' }); setShowForm(true); }} style={btn('#3b82f6', 11)}>✏️</button>
              {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => handleDelete(t.id)} style={btn('#dc2626', 11)}>×</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function inp() { return { padding:'8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit' }; }
