import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';

const TYPE_ICONS = { camion: '🚛', remorque: '🚚', 'semi-remorque': '🚚', utilitaire: '🚐', autre: '🚗' };
const TYPE_LABELS = { camion: 'Camion', remorque: 'Remorque', 'semi-remorque': 'Semi-remorque', utilitaire: 'Utilitaire', autre: 'Autre' };

export default function VehiculesPage() {
  const t = useT();
  const { hasRole } = useAuth();
  const canDelete = hasRole('admin');
  const [vehicules, setVehicules] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ immatriculation: '', marque: '', modele: '', annee: '', type: 'camion', poids_plafond: '', capacite_charge: '', nb_essieux: '', date_achat: '', kilometrage: '', notes: '' });

  useEffect(() => { load(); loadStats(); }, []);

  async function load() {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filter) params.set('status', filter);
    setVehicules(await api.getVehicules('?' + params.toString()));
  }

  async function loadStats() { setStats(await api.vehiculeStats()); }

  useEffect(() => { load(); }, [search, filter]);

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (editing) {
        await api.updateVehicule(editing.id, form);
      } else {
        await api.createVehicule(form);
      }
      setShowForm(false); setEditing(null); setForm({ immatriculation: '', marque: '', modele: '', annee: '', type: 'camion', poids_plafond: '', capacite_charge: '', nb_essieux: '', date_achat: '', kilometrage: '', notes: '' });
      load(); loadStats();
    } catch (err) { alert(err.message); }
  }

  async function handleDelete(id) {
    if (!canDelete) return;
    if (!(await systemConfirm('Supprimer ce véhicule ?'))) return;
    await api.deleteVehicule(id);
    setVehicules(current => current.filter(item => item.id !== id));
    loadStats();
  }

  function edit(v) {
    setEditing(v);
    setForm({ immatriculation: v.immatriculation, marque: v.marque, modele: v.modele, annee: v.annee || '', type: v.type, poids_plafond: v.poids_plafond || '', capacite_charge: v.capacite_charge || '', nb_essieux: v.nb_essieux || '', date_achat: v.date_achat || '', kilometrage: v.kilometrage || '', notes: v.notes || '' });
    setShowForm(true);
  }

  const btn = (color) => ({ background: color || '#0d9488', border: 'none', borderRadius: 6, padding: '6px 14px', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' });

  return (
    <div className="ops-page ops-vehicles" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
      <div className="ops-title" style={{ fontWeight: 900, fontSize: 18, color: '#1e293b' }}>🚛 {t('Gestion des Véhicules Lourds')}</div>

      {stats && <div className="ops-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px,1fr))', gap: 8 }}>
        {[ {label:'Total', val:stats.total, color:'#3b82f6'}, {label:'Actifs', val:stats.actifs, color:'#10b981'}, {label:'En maintenance', val:stats.enMaintenance, color:'#f59e0b'}, {label:'Camions', val:stats.camions, color:'#8b5cf6'}, {label:'Remorques', val:stats.remorques, color:'#ec4899'}, {label:'CT ≤ 30j', val:stats.prochainCT, color:'#dc2626'} ].map((s,i) => (
          <div key={i} style={{background:'#fff', borderRadius:8, padding:12, borderLeft:`4px solid ${s.color}`, boxShadow:'0 1px 4px rgba(0,0,0,0.06)'}}>
            <div style={{fontSize:11, color:'#64748b', fontWeight:600}}>{s.label}</div>
            <div style={{fontSize:20, fontWeight:900, color:s.color}}>{s.val}</div>
          </div>
        ))}
      </div>}

      <div className="ops-toolbar" style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
        <input placeholder="Recherche (immat, marque, modèle)..." value={search} onChange={e => setSearch(e.target.value)}
          style={{flex:1, minWidth:200, padding:'8px 12px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit'}} />
        <select value={filter} onChange={e => setFilter(e.target.value)}
          style={{padding:'8px 12px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit'}}>
          <option value="">Tous</option>
          <option value="actif">Actif</option>
          <option value="en_maintenance">En maintenance</option>
          <option value="hors_service">Hors service</option>
        </select>
        <button onClick={() => { setEditing(null); setForm({ immatriculation:'', marque:'', modele:'', annee:'', type:'camion', poids_plafond:'', capacite_charge:'', nb_essieux:'', date_achat:'', kilometrage:'', notes:'' }); setShowForm(true); }} style={btn()}>+ Véhicule</button>
      </div>

      {showForm && <form className="ops-form" onSubmit={handleSave} style={{background:'#fff', borderRadius:10, padding:16, border:'1px solid #e2e8f0', display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:10}}>
        <input required placeholder="Immatriculation *" value={form.immatriculation} onChange={e => setForm({...form, immatriculation: e.target.value})}
          style={{padding:'8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit'}} />
        <input required placeholder="Marque *" value={form.marque} onChange={e => setForm({...form, marque: e.target.value})} style={inp()} />
        <input required placeholder="Modèle *" value={form.modele} onChange={e => setForm({...form, modele: e.target.value})} style={inp()} />
        <input placeholder="Année" type="number" value={form.annee} onChange={e => setForm({...form, annee: e.target.value})} style={inp()} />
        <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} style={{padding:'8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit'}}>
          <option value="camion">Camion</option><option value="remorque">Remorque</option>
          <option value="semi-remorque">Semi-remorque</option><option value="utilitaire">Utilitaire</option><option value="autre">Autre</option>
        </select>
        <input placeholder="Poids plafond (kg)" type="number" value={form.poids_plafond} onChange={e => setForm({...form, poids_plafond: e.target.value})} style={inp()} />
        <input placeholder="Capacité charge" type="number" value={form.capacite_charge} onChange={e => setForm({...form, capacite_charge: e.target.value})} style={inp()} />
        <input placeholder="Nb essieux" type="number" value={form.nb_essieux} onChange={e => setForm({...form, nb_essieux: e.target.value})} style={inp()} />
        <input placeholder="Date achat" type="date" value={form.date_achat} onChange={e => setForm({...form, date_achat: e.target.value})} style={inp()} />
        <input placeholder="Kilométrage" type="number" value={form.kilometrage} onChange={e => setForm({...form, kilometrage: e.target.value})} style={inp()} />
        <input placeholder="Notes" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} style={{padding:'8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit', gridColumn:'1/-1'}} />
        <div style={{gridColumn:'1/-1', display:'flex', gap:8}}>
          <button type="submit" style={btn()}>{editing ? 'Mettre à jour' : 'Ajouter'}</button>
          <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} style={{...btn(), background:'#94a3b8'}}>Annuler</button>
        </div>
      </form>}

      <div className="ops-card-grid" style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px,1fr))', gap:10}}>
        {vehicules.map(v => (
          <div className="ops-card" key={v.id} style={{background:'#fff', borderRadius:10, padding:14, border:'1px solid #e2e8f0', boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
            <div className="ops-card-header" style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
              <div><span style={{fontSize:20}}>{TYPE_ICONS[v.type] || '🚗'}</span>
                <strong style={{fontSize:15, marginLeft:6}}>{v.immatriculation}</strong></div>
              <span style={{fontSize:11, padding:'2px 8px', borderRadius:4, fontWeight:600,
                background: v.status === 'actif' ? '#ecfdf5' : v.status === 'en_maintenance' ? '#fffbeb' : '#fef2f2',
                color: v.status === 'actif' ? '#10b981' : v.status === 'en_maintenance' ? '#f59e0b' : '#dc2626'}}>
                {v.status === 'actif' ? 'Actif' : v.status === 'en_maintenance' ? 'En maintenance' : 'Hors service'}
              </span>
            </div>
            <div style={{fontSize:13, color:'#475569'}}>{v.marque} {v.modele} {v.annee ? `(${v.annee})` : ''}</div>
            <div style={{display:'flex', gap:12, marginTop:6, fontSize:12, color:'#64748b'}}>
              <span>📍 {v.type && TYPE_LABELS[v.type]}</span>
              <span>🔢 {v.kilometrage ? `${v.kilometrage.toLocaleString()} km` : 'N/A'}</span>
            </div>
            {v.conducteur_nom && <div style={{fontSize:12, color:'#64748b', marginTop:4}}>👤 {v.conducteur_nom}</div>}
            <div className="ops-actions" style={{display:'flex', gap:6, marginTop:10}}>
              <button onClick={() => edit(v)} style={{...btn(), background:'#3b82f6', fontSize:11}}>✏️ Modifier</button>
              {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => handleDelete(v.id)} style={{...btn(), background:'#dc2626', fontSize:11}}>×</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function inp() { return { padding:'8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:13, fontFamily:'inherit' }; }
