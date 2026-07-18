import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';

export default function ComptaPage() {
  const t = useT();
  const { hasRole } = useAuth();
  const [ecritures, setEcritures] = useState([]);
  const [solde, setSolde] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [notify, setNotify] = useState(null);
  const canEdit = hasRole('admin', 'comptable', 'financier');
  const canDelete = hasRole('admin');
  const [form, setForm] = useState({ type: 'recette', categorie: '', montant: '', description: '', date_operation: new Date().toISOString().split('T')[0] });

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [ec, sd] = await Promise.all([api.getCompta(), api.getSolde()]);
      setEcritures(ec);
      setSolde(sd);
    } catch {}
  }

  function showMsg(msg, type = 'info') { setNotify({ msg, type }); setTimeout(() => setNotify(null), 3000); }

  async function save() {
    try {
      await api.createEcriture(form);
      showMsg('Écriture ajoutée');
      setShowForm(false);
      setForm({ type: 'recette', categorie: '', montant: '', description: '', date_operation: new Date().toISOString().split('T')[0] });
      load();
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function remove(id) {
    if (!(await systemConfirm('Supprimer cette écriture ?'))) return;
    await api.deleteEcriture(id);
    load();
  }

  const colors = { recette: '#16a34a', depense: '#dc2626', transfert: '#d97706' };
  const labels = { recette: 'Recette', depense: 'Dépense', transfert: 'Transfert' };

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
      {notify && <div style={{ position: 'fixed', top: 16, right: 16, background: notify.type === 'error' ? '#fef2f2' : '#f0fdf4', color: notify.type === 'error' ? '#dc2626' : '#16a34a', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, zIndex: 9999, border: `1px solid ${notify.type === 'error' ? '#fecaca' : '#bbf7d0'}` }}>{notify.msg}</div>}

      <div style={{ fontWeight: 900, fontSize: 18, color: '#1e293b', marginBottom: 12 }}>💰 {t('Comptabilité')}</div>

      {solde && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
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

      {canEdit && <button onClick={() => setShowForm(!showForm)} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 13, marginBottom: 10 }}>+ Nouvelle écriture</button>}

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Type</label>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13 }}>
              <option value="recette">Recette</option><option value="depense">Dépense</option><option value="transfert">Transfert</option>
            </select>
          </div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Catégorie</label><input value={form.categorie} onChange={e => setForm({ ...form, categorie: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 140 }} /></div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Montant</label><input value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value })} type="number" step="0.01" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 110 }} /></div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Description</label><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 200 }} /></div>
          <div><label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 2 }}>Date</label><input value={form.date_operation} onChange={e => setForm({ ...form, date_operation: e.target.value })} type="date" style={{ padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 13, width: 130 }} /></div>
          <div><button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Ajouter</button></div>
        </div>
      )}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead><tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Date</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Type</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Catégorie</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Description</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}>Montant</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 12 }}></th>
          </tr></thead>
          <tbody>
            {ecritures.map(e => (
              <tr key={e.id}>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12, color: '#64748b' }}>{e.date_operation}</td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}><span style={{ background: e.type === 'recette' ? '#dcfce7' : e.type === 'depense' ? '#fef2f2' : '#fef3c7', color: colors[e.type], padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{labels[e.type]}</span></td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 12, color: '#64748b' }}>{e.categorie}</td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9' }}>{e.description}</td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700, color: colors[e.type] }}>{Number(e.montant).toFixed(2)} €</td>
                <td style={{ padding: '5px 8px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(e.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>×</button>}</td>
              </tr>
            ))}
            {ecritures.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 13 }}>Aucune écriture</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
