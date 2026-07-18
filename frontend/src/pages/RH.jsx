import { useState, useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';
import { systemConfirm } from '../SystemConfirm';

export default function RHPage() {
  const t = useT();
  const { hasRole } = useAuth();
  const [employes, setEmployes] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [notify, setNotify] = useState(null);
  const [form, setForm] = useState({ nom: '', prenom: '', email: '', telephone: '', poste: '', departement: '', salaire_base: '', date_arrivee: '' });
  const canEdit = hasRole('admin', 'rh');
  const canDelete = hasRole('admin');

  useEffect(() => { load(); }, [search]);

  async function load() {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    const data = await api.getEmployes(params);
    setEmployes(data);
  }

  function showMsg(msg, type = 'info') { setNotify({ msg, type }); setTimeout(() => setNotify(null), 3000); }

  async function save() {
    try {
      if (selected) {
        await api.updateEmploye(selected.id, form);
        showMsg('Employé modifié');
      } else {
        await api.createEmploye(form);
        showMsg('Employé créé');
      }
      setShowForm(false); setSelected(null);
      setForm({ nom: '', prenom: '', email: '', telephone: '', poste: '', departement: '', salaire_base: '', date_arrivee: '' });
      load();
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function selectEmp(id) {
    const data = await api.getEmploye(id);
    setSelected(data);
    setForm({ nom: data.nom, prenom: data.prenom, email: data.email || '', telephone: data.telephone || '', poste: data.poste || '', departement: data.departement || '', salaire_base: data.salaire_base || '', date_arrivee: data.date_arrivee || '' });
  }

  async function removeEmployee() {
    if (!canDelete || !selected) return;
    if (!(await systemConfirm(`Supprimer ${selected.prenom} ${selected.nom} ?`))) return;
    try {
      await api.deleteEmploye(selected.id);
      setEmployes(current => current.filter(item => item.id !== selected.id));
      setSelected(null);
      showMsg('Employé supprimé');
    } catch (error) { showMsg(error.message, 'error'); }
  }

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      {notify && <div style={{ position: 'fixed', top: 16, right: 16, background: notify.type === 'error' ? '#fef2f2' : '#f0fdf4', color: notify.type === 'error' ? '#dc2626' : '#16a34a', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, zIndex: 9999, border: `1px solid ${notify.type === 'error' ? '#fecaca' : '#bbf7d0'}` }}>{notify.msg}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontWeight: 900, fontSize: 18, color: '#1e293b' }}>👥 {t('Ressources Humaines')}</div>
        {canEdit && <button onClick={() => { setShowForm(!showForm); setSelected(null); setForm({ nom: '', prenom: '', email: '', telephone: '', poste: '', departement: '', salaire_base: '', date_arrivee: '' }); }} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>+ Employé</button>}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher..."
        style={{ width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, marginBottom: 10, outline: 'none', boxSizing: 'border-box' }} />

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Nom</label><input value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 130 }} /></div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Prénom</label><input value={form.prenom} onChange={e => setForm({ ...form, prenom: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 130 }} /></div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Email</label><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 170 }} /></div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Tél</label><input value={form.telephone} onChange={e => setForm({ ...form, telephone: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 120 }} /></div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Poste</label><input value={form.poste} onChange={e => setForm({ ...form, poste: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 150 }} /></div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Département</label><input value={form.departement} onChange={e => setForm({ ...form, departement: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 130 }} /></div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Salaire base</label><input value={form.salaire_base} onChange={e => setForm({ ...form, salaire_base: e.target.value })} type="number" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 100 }} /></div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Arrivée</label><input value={form.date_arrivee} onChange={e => setForm({ ...form, date_arrivee: e.target.value })} type="date" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 130 }} /></div>
          <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>{selected ? 'Modifier' : 'Ajouter'}</button></div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 12 }}>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead><tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Nom</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Prénom</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Poste</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Dépt</th>
              <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Status</th>
            </tr></thead>
            <tbody>
              {employes.map(e => (
                <tr key={e.id} onClick={() => selectEmp(e.id)} style={{ cursor: 'pointer', background: selected?.id === e.id ? '#f0fdf4' : 'transparent' }}>
                  <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{e.nom}</td>
                  <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}>{e.prenom}</td>
                  <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12, color: '#64748b' }}>{e.poste}</td>
                  <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}>{e.departement}</td>
                  <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}><span style={{ background: e.status === 'actif' ? '#dcfce7' : '#fef3c7', color: e.status === 'actif' ? '#16a34a' : '#d97706', padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{e.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: 14, overflow: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>{selected.prenom} {selected.nom}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>{selected.poste} — {selected.departement}</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>{canEdit && <>
              <button onClick={() => setShowForm(true)} style={{ background: '#e2e8f0', border: 'none', borderRadius: 4, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}>✎ Modifier</button>
            </>}{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={removeEmployee} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '5px 10px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>×</button>}</div>
            {selected.contrats?.length > 0 && (
              <div style={{ marginBottom: 10 }}><div style={{ fontWeight: 700, fontSize: 12, color: '#475569', marginBottom: 4 }}>Contrats</div>
                {selected.contrats.map(c => <div key={c.id} style={{ fontSize: 12, padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>{c.type} — {c.poste} ({c.date_debut})</div>)}
              </div>
            )}
            {selected.absences?.length > 0 && (
              <div style={{ marginBottom: 10 }}><div style={{ fontWeight: 700, fontSize: 12, color: '#475569', marginBottom: 4 }}>Absences</div>
                {selected.absences.map(a => <div key={a.id} style={{ fontSize: 12, padding: '3px 0', borderBottom: '1px solid #f1f5f9' }}>{a.type} du {a.date_debut} au {a.date_fin}{a.motif ? ` (${a.motif})` : ''}</div>)}
              </div>
            )}
            {selected.paies?.length > 0 && (
              <div><div style={{ fontWeight: 700, fontSize: 12, color: '#475569', marginBottom: 4 }}>Paies</div>
                {selected.paies.map(p => <div key={p.id} style={{ fontSize: 12, padding: '3px 0', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}><span>{p.mois}</span><span style={{ fontWeight: 600 }}>{Number(p.net_a_payer).toFixed(2)} €</span></div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
