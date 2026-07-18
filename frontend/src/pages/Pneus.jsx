import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';

export default function PneusPage() {
  const t = useT();
  const { hasRole } = useAuth();
  const canDelete = hasRole('admin');
  const [pneus, setPneus] = useState([]);
  const [vehicules, setVehicules] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filterVeh, setFilterVeh] = useState('');
  const [form, setForm] = useState({ vehicule_id: '', position: 'AVG', marque: '', dimension: '', indice_vitesse: '', date_montage: '', kilometrage_montage: '', pression_recommandee: '' });

  useEffect(() => { load(); api.getVehicules('').then(setVehicules); }, []);
  useEffect(() => { load(); }, [filterVeh]);

  async function load() {
    const params = new URLSearchParams();
    if (filterVeh) params.set('vehicule_id', filterVeh);
    setPneus(await api.getPneus('?' + params.toString()));
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (editing) await api.updatePneu(editing.id, form);
      else await api.createPneu(form);
      setShowForm(false); setEditing(null);
      setForm({ vehicule_id: '', position: 'AVG', marque: '', dimension: '', indice_vitesse: '', date_montage: '', kilometrage_montage: '', pression_recommandee: '' });
      load();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id) {
    if (!canDelete) return;
    if (!(await systemConfirm('Supprimer ce pneu ?'))) return;
    await api.deletePneu(id);
    setPneus(current => current.filter(item => item.id !== id));
  }

  const btn = (c) => ({ background: c || '#0d9488', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' });

  return (
    <div className="ops-page ops-tires" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
      <div className="ops-title" style={{ fontWeight: 900, fontSize: 18, color: '#1e293b' }}>⭕ {t('Gestion des Pneumatiques')}</div>
      <div className="ops-toolbar" style={{display:'flex', gap:8}}>
        <select value={filterVeh} onChange={e => setFilterVeh(e.target.value)} style={{padding:'8px 12px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit'}}>
          <option value="">Tous véhicules</option>
          {vehicules.map(v => <option key={v.id} value={v.id}>{v.immatriculation}</option>)}
        </select>
        <button onClick={() => { setEditing(null); setShowForm(true); }} style={btn()}>+ Pneu</button>
      </div>

      {showForm && <form className="ops-form" onSubmit={handleSave} style={{background:'#fff', borderRadius:10, padding:16, border:'1px solid #e2e8f0', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px,1fr))', gap:10}}>
        <select required value={form.vehicule_id} onChange={e => setForm({...form, vehicule_id: e.target.value})} style={inp()}>
          <option value="">Véhicule *</option>
          {vehicules.map(v => <option key={v.id} value={v.id}>{v.immatriculation}</option>)}
        </select>
        <select value={form.position} onChange={e => setForm({...form, position: e.target.value})} style={inp()}>
          <option value="AVG">AVG</option><option value="AVD">AVD</option><option value="ARG">ARG</option><option value="ARD">ARD</option>
          <option value="AVG-int">AVG Int</option><option value="AVD-int">AVD Int</option>
          <option value="remorque-G">Remorque G</option><option value="remorque-D">Remorque D</option>
          <option value="roue_secours">Roue de secours</option>
        </select>
        <input placeholder="Marque" value={form.marque} onChange={e => setForm({...form, marque: e.target.value})} style={inp()} />
        <input placeholder="Dimension" value={form.dimension} onChange={e => setForm({...form, dimension: e.target.value})} style={inp()} />
        <input placeholder="Indice vitesse" value={form.indice_vitesse} onChange={e => setForm({...form, indice_vitesse: e.target.value})} style={inp()} />
        <input type="date" placeholder="Date montage" value={form.date_montage} onChange={e => setForm({...form, date_montage: e.target.value})} style={inp()} />
        <input type="number" placeholder="Km montage" value={form.kilometrage_montage} onChange={e => setForm({...form, kilometrage_montage: e.target.value})} style={inp()} />
        <input type="number" placeholder="Pression (bar)" value={form.pression_recommandee} onChange={e => setForm({...form, pression_recommandee: e.target.value})} style={inp()} />
        <div style={{gridColumn:'1/-1', display:'flex', gap:8}}>
          <button type="submit" style={btn()}>{editing ? 'Mettre à jour' : 'Ajouter'}</button>
          <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} style={{...btn(), background:'#94a3b8'}}>Annuler</button>
        </div>
      </form>}

      <div className="ops-card-grid" style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px,1fr))', gap:10}}>
        {pneus.map(p => (
          <div className="ops-card" key={p.id} style={{background:'#fff', borderRadius:10, padding:12, border:'1px solid #e2e8f0', boxShadow:'0 1px 4px rgba(0,0,0,0.04)',
            borderLeft: `4px solid ${p.status === 'actif' ? '#10b981' : p.status === 'a_remplacer' ? '#f59e0b' : '#94a3b8'}`}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4}}>
              <strong>{p.immatriculation} — <span style={{color:'#0d9488'}}>{p.position}</span></strong>
              <span style={{fontSize:11, padding:'2px 6px', borderRadius:3,
                background: p.status === 'actif' ? '#ecfdf5' : '#fffbeb',
                color: p.status === 'actif' ? '#10b981' : '#f59e0b'}}>{p.status}</span>
            </div>
            <div style={{fontSize:12, color:'#475569'}}>{p.marque} {p.dimension} {p.indice_vitesse}</div>
            {p.usure_percent > 0 && <div style={{fontSize:12, marginTop:2}}>
              Usure: <span style={{color: p.usure_percent > 70 ? '#dc2626' : p.usure_percent > 40 ? '#f59e0b' : '#10b981', fontWeight:600}}>{p.usure_percent}%</span>
            </div>}
            {p.pression_recommandee && <div style={{fontSize:12, color:'#64748b'}}>Pression: {p.pression_recommandee} bar</div>}
            <div className="ops-actions" style={{display:'flex', gap:6, marginTop:6}}>
              <button onClick={() => { setEditing(p); setForm({ vehicule_id: p.vehicule_id, position: p.position, marque: p.marque||'', dimension: p.dimension||'', indice_vitesse: p.indice_vitesse||'', date_montage: p.date_montage||'', kilometrage_montage: p.kilometrage_montage||'', pression_recommandee: p.pression_recommandee||'' }); setShowForm(true); }} style={{...btn(), background:'#3b82f6', fontSize:11}}>✏️</button>
              {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => handleDelete(p.id)} style={{...btn(), background:'#dc2626', fontSize:11}}>×</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function inp() { return { padding:'8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit' }; }
