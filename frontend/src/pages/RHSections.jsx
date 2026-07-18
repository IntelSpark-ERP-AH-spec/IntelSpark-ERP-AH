import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useUserDoc } from '../useUserDoc';
import { useAudit } from '../AuditContext';
import { useAppI18n } from '../appI18n';
import DeveloppementCarriere from './DeveloppementCarriere';
import RecrutementsPage from './Recrutements';
import TempsAbsences from './TempsAbsences';
import NotesFrais from './NotesFrais';
import SuiviTemps from './SuiviTemps';

export default function RHSections({ initialTab, setActivePage }) {
  const tab = initialTab || 'admin_paie';
  const [notify, setNotify] = useState(null);

  function showMsg(msg, type = 'info') {
    setNotify({ msg, type });
    setTimeout(() => setNotify(null), 3500);
  }

  return (
    <div className="domain-page domain-hr" style={{ padding: 0 }}>
      {notify && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 9999,
          background: notify.type === 'error' ? '#fef2f2' : notify.type === 'success' ? '#f0fdf4' : '#f8fafc',
          color: notify.type === 'error' ? '#dc2626' : notify.type === 'success' ? '#16a34a' : '#475569',
          border: `1px solid ${notify.type === 'error' ? '#fecaca' : notify.type === 'success' ? '#bbf7d0' : '#e2e8f0'}`,
          padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          display: 'flex', alignItems: 'center', gap: 8, maxWidth: 420,
        }}>
          {notify.type === 'error' ? '❌' : notify.type === 'success' ? '✅' : 'ℹ️'} {notify.msg}
        </div>
      )}

      {tab === 'admin_paie'    && <AdminPaieTab showMsg={showMsg} setActivePage={setActivePage} />}
      {tab === 'recrutement'   && <RecrutementsPage showMsg={showMsg} />}
      {tab === 'developpement' && <DeveloppementCarriere showMsg={showMsg} />}
      {tab === 'relations'     && <RelationsTab showMsg={showMsg} />}
      {tab === 'temps_absences' && <TempsAbsences showMsg={showMsg} />}
      {tab === 'notes_frais'    && <NotesFrais showMsg={showMsg} />}
      {tab === 'suivi_temps'    && <SuiviTemps showMsg={showMsg} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// ADMIN & PAIE (inchangé)
// ════════════════════════════════════════════════════════════════

function AdminPaieTab({ showMsg, setActivePage }) {
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'rh');
  const canDelete = hasRole('admin');
  const [employes, setEmployes] = useState([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nom: '', prenom: '', email: '', telephone: '', poste: '', departement: '', salaire_base: '', date_arrivee: '' });
  const [paieForm, setPaieForm] = useState({ mois: '', salaire_brut: '', retenues: '0', primes: '0' });
  const [saisiePaie, setSaisiePaie] = useState({});

  useEffect(() => { load(); }, [search]); // eslint-disable-line

  async function load() {
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const data = await api.getEmployes(params);
      setEmployes(data);
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function delEmploye(id) {
    if (!canDelete) return;
    const emp = employes.find(e => e.id === id);
    const nom = emp ? `${emp.prenom} ${emp.nom}` : 'ce salarié';
    if (!(await systemConfirm(`Supprimer ${nom} ?\nCette action est irréversible.`))) return;
    try {
      await api.deleteEmploye(id);
      showMsg('Salarié supprimé');
      if (selected?.id === id) setSelected(null);
      load();
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function save() {
    try {
      if (selected) { await api.updateEmploye(selected.id, form); showMsg('Employé modifié'); }
      else { await api.createEmploye(form); showMsg('Employé créé'); }
      setShowForm(false); setSelected(null);
      setForm({ nom: '', prenom: '', email: '', telephone: '', poste: '', departement: '', salaire_base: '', date_arrivee: '' });
      load();
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function selectEmp(id) {
    try {
      const data = await api.getEmploye(id);
      setSelected(data);
      setForm({ nom: data.nom, prenom: data.prenom, email: data.email || '', telephone: data.telephone || '', poste: data.poste || '', departement: data.departement || '', salaire_base: data.salaire_base || '', date_arrivee: data.date_arrivee || '' });
      setPaieForm({ mois: new Date().toISOString().slice(0, 7), salaire_brut: data.salaire_base || '', retenues: '0', primes: '0' });
    } catch (e) { showMsg(e.message, 'error'); }
  }

  async function savePaie() {
    if (!selected) return;
    try {
      const net = Number(paieForm.salaire_brut) - Number(paieForm.retenues) + Number(paieForm.primes);
      await api.addPaie(selected.id, { ...paieForm, net_a_payer: net });
      showMsg('Paie ajoutée');
      selectEmp(selected.id);
    } catch (e) { showMsg(e.message, 'error'); }
  }

  function handleSaisieChange(empId, field, value) {
    setSaisiePaie(prev => ({ ...prev, [empId]: { ...(prev[empId] || {}), [field]: value } }));
  }

  const moisEnCours = new Date().toISOString().slice(0, 7);

  const masseSalarialeTotale = employes.reduce((s, e) => {
    const dernierePaie = e.paies?.length > 0 ? e.paies[e.paies.length - 1] : null;
    const paieMois = dernierePaie && dernierePaie.mois === moisEnCours ? dernierePaie : null;
    if (paieMois) return s + Number(paieMois.net_a_payer ?? (Number(paieMois.salaire_brut) - Number(paieMois.retenues || 0) + Number(paieMois.primes || 0)));
    const saisieNet = saisiePaie[e.id]?.net;
    if (saisieNet !== undefined && saisieNet !== '') return s + Number(saisieNet);
    return s + Number(e.salaire_base || 0);
  }, 0);

  async function genererBulletin(empId) {
    const emp = employes.find(e => e.id === empId);
    if (!emp) return;
    const saisie = saisiePaie[empId];
    const netSaisi = saisie?.net !== undefined && saisie?.net !== '' ? Number(saisie.net) : null;
    const brut = netSaisi !== null ? netSaisi : Number(emp.salaire_base || 0);
    try {
      await api.addPaie(empId, { mois: moisEnCours, salaire_brut: String(brut), retenues: '0', primes: '0', net_a_payer: String(brut) });
      showMsg(`✓ Bulletin ${moisEnCours} généré pour ${emp.prenom} ${emp.nom}`);
      setSaisiePaie(prev => { const n = { ...prev }; delete n[empId]; return n; });
      load();
      if (setActivePage) setTimeout(() => setActivePage('bulletins'), 1500);
    } catch (e) { showMsg(e.message, 'error'); }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#0f766e' }}>👥 Dossiers Salariés</div>
        {canEdit && (
          <button onClick={() => { setShowForm(!showForm); setSelected(null); setForm({ nom: '', prenom: '', email: '', telephone: '', poste: '', departement: '', salaire_base: '', date_arrivee: '' }); }}
            className="no-print" style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            + Employé
          </button>
        )}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher un salarié..." className="no-print"
        style={{ width: '100%', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, marginBottom: 8, outline: 'none', boxSizing: 'border-box' }} />

      {showForm && (
        <div className="no-print" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'end' }}>
          {[['Nom', 'nom', 110], ['Prénom', 'prenom', 110], ['Email', 'email', 150], ['Tél', 'telephone', 100], ['Poste', 'poste', 130], ['Département', 'departement', 120]].map(([label, key, w]) => (
            <div key={key}><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>{label}</label>
              <input value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: w }} /></div>
          ))}
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Salaire base</label>
            <input value={form.salaire_base} onChange={e => setForm({ ...form, salaire_base: e.target.value })} type="number" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 90 }} /></div>
          <div><label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 1 }}>Arrivée</label>
            <input value={form.date_arrivee} onChange={e => setForm({ ...form, date_arrivee: e.target.value })} type="date" style={{ padding: '5px 7px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, width: 110 }} /></div>
          <button onClick={save} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            {selected ? 'Modifier' : 'Ajouter'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 10 }}>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', overflow: 'auto', maxHeight: 320 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr style={{ position: 'sticky', top: 0, background: '#fff' }}>
              {['Nom','Prénom','Poste','Salaire','Net à payer ce mois','Statut',''].map((h, i) => (
                <th key={i} style={{ textAlign: i >= 3 ? 'right' : 'left', padding: '5px 7px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 700, fontSize: 11 }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {employes.map(e => {
                const dernierePaie = e.paies?.length > 0 ? e.paies[e.paies.length - 1] : null;
                const paieMoisEnCours = dernierePaie && dernierePaie.mois === moisEnCours ? dernierePaie : null;
                const netMois = paieMoisEnCours ? Number(paieMoisEnCours.net_a_payer ?? (Number(paieMoisEnCours.salaire_brut) - Number(paieMoisEnCours.retenues || 0) + Number(paieMoisEnCours.primes || 0))) : null;
                const aUnePaieCeMois = !!paieMoisEnCours;
                return (
                  <tr key={e.id} onClick={() => selectEmp(e.id)} style={{ cursor: 'pointer', background: selected?.id === e.id ? '#f0fdf4' : 'transparent' }}>
                    <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{e.nom}</td>
                    <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9' }}>{e.prenom}</td>
                    <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', fontSize: 11, color: '#64748b' }}>{e.poste}</td>
                    <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700 }}>{Number(e.salaire_base).toFixed(2)}</td>
                    <td onClick={ev => ev.stopPropagation()} style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>
                      {canEdit ? (
                        <input type="number" value={saisiePaie[e.id]?.net ?? (aUnePaieCeMois ? netMois : '')}
                          placeholder={aUnePaieCeMois ? netMois.toFixed(2) : Number(e.salaire_base).toFixed(2)}
                          onChange={ev => handleSaisieChange(e.id, 'net', ev.target.value)}
                          style={{ width: 80, padding: '2px 4px', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: 11, textAlign: 'right' }} />
                      ) : (
                        aUnePaieCeMois ? <span style={{ fontWeight: 700, color: '#16a34a' }}>{netMois.toFixed(2)}</span> : <span style={{ color: '#94a3b8' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9' }}>
                      <span style={{ background: e.status === 'actif' ? '#dcfce7' : '#fef3c7', color: e.status === 'actif' ? '#16a34a' : '#d97706', padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600 }}>{e.status}</span>
                    </td>
                    <td onClick={ev => ev.stopPropagation()} style={{ padding: '4px 7px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {canEdit && (
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          <button disabled={aUnePaieCeMois} onClick={ev => { ev.stopPropagation(); genererBulletin(e.id); }}
                            title={aUnePaieCeMois ? 'Bulletin déjà généré' : 'Générer le bulletin'}
                            style={{ background: aUnePaieCeMois ? '#e2e8f0' : '#0f766e', color: aUnePaieCeMois ? '#94a3b8' : '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', fontWeight: 700, cursor: aUnePaieCeMois ? 'not-allowed' : 'pointer', fontSize: 11 }}>
                            {aUnePaieCeMois ? '✓' : '📄'}
                          </button>
                          {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={ev => { ev.stopPropagation(); delEmploye(e.id); }}
                            style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>
                            ×
                          </button>}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {employes.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12 }}>Aucun salarié enregistré</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800, borderTop: '2px solid #0f766e', background: '#f0fdf4' }}>
                <td colSpan={4} style={{ padding: '6px 7px', textAlign: 'right', color: '#0f766e' }}>Masse salariale — {moisEnCours}</td>
                <td style={{ padding: '6px 7px', textAlign: 'right', color: '#0f766e' }}>{masseSalarialeTotale.toFixed(2)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {selected && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, background: '#fff', padding: 12, overflow: 'auto', maxHeight: 200 }}>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 2 }}>{selected.prenom} {selected.nom}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{selected.poste} — {selected.departement}</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
              <div style={{ fontSize: 12 }}>💰 <strong>{Number(selected.salaire_base).toFixed(2)} €</strong></div>
              <div style={{ fontSize: 12 }}>📅 Entrée : <strong>{selected.date_arrivee}</strong></div>
            </div>
            <div style={{ fontWeight: 700, fontSize: 12, color: '#475569', marginBottom: 4, marginTop: 8 }}>Paies</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <input value={paieForm.mois} onChange={e => setPaieForm({ ...paieForm, mois: e.target.value })} type="month" style={{ padding: '3px 5px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11, width: 80 }} />
              <input value={paieForm.salaire_brut} onChange={e => setPaieForm({ ...paieForm, salaire_brut: e.target.value })} type="number" placeholder="Brut" style={{ padding: '3px 5px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11, width: 60 }} />
              <input value={paieForm.retenues} onChange={e => setPaieForm({ ...paieForm, retenues: e.target.value })} type="number" placeholder="Ret." style={{ padding: '3px 5px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11, width: 50 }} />
              <input value={paieForm.primes} onChange={e => setPaieForm({ ...paieForm, primes: e.target.value })} type="number" placeholder="Primes" style={{ padding: '3px 5px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11, width: 60 }} />
              {canEdit && <button onClick={savePaie} style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>+</button>}
            </div>
            {selected.paies?.length > 0 ? (
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 10 }}>
                <thead><tr style={{ background: '#f8fafc' }}>
                  {['Mois','Brut','Ret.','Primes','Net'].map((h, i) => (
                    <th key={i} style={{ textAlign: i > 0 ? 'right' : 'left', padding: '2px 5px', borderBottom: '1px solid #e2e8f0', color: '#64748b', fontWeight: 700 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {selected.paies.map(p => (
                    <tr key={p.id}>
                      <td style={{ padding: '2px 5px', borderBottom: '1px solid #f1f5f9', fontWeight: 600 }}>{p.mois}</td>
                      <td style={{ padding: '2px 5px', borderBottom: '1px solid #f1f5f9', textAlign: 'right' }}>{Number(p.salaire_brut).toFixed(2)}</td>
                      <td style={{ padding: '2px 5px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: '#dc2626' }}>{Number(p.retenues).toFixed(2)}</td>
                      <td style={{ padding: '2px 5px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', color: '#16a34a' }}>{Number(p.primes).toFixed(2)}</td>
                      <td style={{ padding: '2px 5px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700 }}>{Number(p.net_a_payer).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', padding: 8 }}>Aucune paie</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// RELATIONS SOCIALES — Saisie IA + Calendrier Instances + Accords
// ════════════════════════════════════════════════════════════════

const INSTANCE_LABELS = {
  CSE: 'CSE',
  'Délégués du personnel': 'Délégués du personnel',
  'DP': 'Délégués du personnel',
  'Réunion de crise': 'Réunion de crise',
  'Négociation syndicale': 'Négociation syndicale',
  Autre: 'Autre',
};

const INSTANCE_COLORS = {
  CSE: '#0f766e',
  'Délégués du personnel': '#3b82f6',
  'Réunion de crise': '#dc2626',
  'Négociation syndicale': '#8b5cf6',
  Autre: '#64748b',
};

const ACCORD_STATUTS = ['En négociation', 'Signé', 'Déposé à la DREETS'];
const ACCORD_COLORS  = {
  'En négociation':    '#f59e0b',
  'Signé':             '#3b82f6',
  'Déposé à la DREETS':'#16a34a',
};

function parseDateFR(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (!m) return s;
  let [_, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function todayFR() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

const LS_INSTANCES_KEY = 'rh_relations_instances';
const LS_ACCORDS_KEY   = 'rh_relations_accords';

function RelationsTab({ showMsg }) {
  const [tab, setTab] = useState('instances');
  const t = useAppI18n();

  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 15, color: '#0f766e', marginBottom: 10 }}>
        🤝 {t.rh.relations} & Dialogue Social
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { id: 'instances', label: '📅 Calendrier des Instances' },
          { id: 'accords',   label: '📜 Accords & Engagements' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '7px 14px', border: 'none', borderRadius: 8,
            cursor: 'pointer', fontWeight: 700, fontSize: 12,
            background: tab === t.id ? '#0f766e' : '#f1f5f9',
            color: tab === t.id ? '#fff' : '#475569',
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'instances' ? <InstancesPanel showMsg={showMsg} /> : <AccordsPanel showMsg={showMsg} />}
    </div>
  );
}

function InstancesPanel({ showMsg }) {
  const t = useAppI18n();
  const { hasRole } = useAuth();
  const canDelete = hasRole('admin');
  const { log: logAudit } = useAudit();
  const { data: list, setData: setList, saving, error } = useUserDoc(LS_INSTANCES_KEY, []);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({
    instance: 'CSE', date: '', sujets: '', lien_pv: '', statut: 'Planifiée',
  });

  function notify(msg, type = 'success') { showMsg && showMsg(msg, type); }

  function startNew() {
    setEditing(null);
    setDraft({ instance: 'CSE', date: todayFR(), sujets: '', lien_pv: '', statut: 'Planifiée' });
    setShowForm(true);
  }

  function startEdit(item) {
    setEditing(item);
    setDraft({
      instance: item.instance || 'CSE',
      date: item.date || '',
      sujets: item.sujets || '',
      lien_pv: item.lien_pv || '',
      statut: item.statut || 'Planifiée',
    });
    setShowForm(true);
  }

  function save() {
    if (!draft.date) return notify('Date obligatoire', 'error');
    if (!draft.sujets.trim()) return notify('Sujets obligatoires', 'error');
    const item = {
      ...draft,
      id: editing ? editing.id : Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      urgent: editing ? !!editing.urgent : false,
    };
    let next;
    if (editing) next = list.map(x => x.id === editing.id ? { ...x, ...item } : x);
    else next = [item, ...list];
    setList(next);
    logAudit({
      type: 'Instance CSE',
      client: item.instance,
      number: 'INST-' + String(item.id).slice(-6).toUpperCase(),
      date: (item.date || '').split('/').reverse().join('-') || new Date().toISOString().slice(0, 10),
      details: item.sujets,
      status: item.statut === 'Clôturée' ? 'valide' : 'brouillon',
      extra: { source_action: editing ? 'edit' : 'create', urgent: item.urgent },
    });
    notify(editing ? 'Instance mise à jour' : 'Instance ajoutée');
    setShowForm(false); setEditing(null);
  }

  async function remove(item) {
    if (!canDelete) return;
    if (!(await systemConfirm('Supprimer cette instance ?'))) return;
    const next = list.filter(x => x.id !== item.id);
    setList(next);
    logAudit({
      type: 'Instance CSE',
      client: item.instance,
      number: 'INST-' + String(item.id).slice(-6).toUpperCase(),
      details: `Instance supprimée : ${item.sujets}`,
      status: 'annule',
      extra: { source_action: 'delete' },
    });
    notify('Instance supprimée');
  }

  function toggleUrgent(item) {
    const next = list.map(x => x.id === item.id ? { ...x, urgent: !x.urgent } : x);
    setList(next);
  }

  const filtered = list.filter(i => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [i.instance, i.date, i.sujets, i.statut].join(' ').toLowerCase().includes(q);
  });

  const urgentCount = list.filter(x => x.urgent).length;

  return (
    <div>
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, marginBottom: 10,
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#0f766e' }}>📅 Calendrier des Instances</div>
        {urgentCount > 0 && (
          <span style={{
            background: '#fef2f2', color: '#dc2626', padding: '2px 8px', borderRadius: 999,
            fontSize: 11, fontWeight: 800, border: '1px solid #fecaca',
          }}>
            🚨 {urgentCount} alerte{urgentCount > 1 ? 's' : ''}
          </span>
        )}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher…"
          className="no-print"
          style={{ flex: 1, minWidth: 180, padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none' }} />
        <button onClick={startNew} className="no-print" style={{
          background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5,
          padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
        }}>+ Réunion</button>
      </div>

      {showForm && (
        <div className="no-print" style={{
          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, marginBottom: 10,
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'end',
        }}>
          <div>
            <label style={lbl}>Instance</label>
            <select value={draft.instance} onChange={e => setDraft({ ...draft, instance: e.target.value })}
              style={{ ...inp, width: 180 }}>
              {Object.keys(INSTANCE_LABELS).map(k => <option key={k} value={k}>{INSTANCE_LABELS[k]}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Date</label>
            <input value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })}
              placeholder="JJ/MM/AAAA" style={{ ...inp, width: 120 }} />
          </div>
          <div>
            <label style={lbl}>Statut</label>
            <select value={draft.statut} onChange={e => setDraft({ ...draft, statut: e.target.value })}
              style={{ ...inp, width: 130 }}>
              <option>Planifiée</option>
              <option>Clôturée</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Lien PV</label>
            <input value={draft.lien_pv} onChange={e => setDraft({ ...draft, lien_pv: e.target.value })}
              placeholder="URL ou chemin" style={{ ...inp, width: 200 }} />
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <label style={lbl}>Sujets principaux</label>
            <input value={draft.sujets} onChange={e => setDraft({ ...draft, sujets: e.target.value })}
              placeholder="Ex: Charte télétravail, accord intéressement…" style={{ ...inp, width: '100%' }} />
          </div>
          <button onClick={save} style={{
            background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5,
            padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
          }}>{editing ? '💾 Modifier' : '➕ Ajouter'}</button>
          <button onClick={() => { setShowForm(false); setEditing(null); }} style={{
            background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: 5,
            padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
          }}>Annuler</button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
              {['Instance', 'Date', 'Sujets principaux', 'Lien PV', 'Statut', ''].map((h, i) => (
                <th key={i} className={h === '' ? 'no-print' : ''} style={{
                  textAlign: 'left', padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                  color: '#475569', fontWeight: 800, fontSize: 11,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
                Aucune réunion enregistrée. Cliquez sur "+ Réunion" pour ajouter une instance.
              </td></tr>
            )}
            {filtered.map(item => {
              const color = INSTANCE_COLORS[item.instance] || '#64748b';
              return (
                <tr key={item.id} style={{
                  borderBottom: '1px solid #f1f5f9',
                  background: item.urgent ? '#fef2f2' : 'transparent',
                }}>
                  <td style={{ padding: '7px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        background: `${color}20`, color, padding: '3px 9px',
                        borderRadius: 999, fontSize: 11, fontWeight: 800,
                      }}>{item.instance}</span>
                      {item.urgent && (
                        <span style={{
                          background: '#dc2626', color: '#fff', padding: '2px 7px',
                          borderRadius: 999, fontSize: 10, fontWeight: 800,
                        }}>🚨 ALERTE</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {item.date || '—'}
                  </td>
                  <td style={{ padding: '7px 10px' }}>{item.sujets || '—'}</td>
                  <td style={{ padding: '7px 10px', fontSize: 11 }}>
                    {item.lien_pv
                      ? <a href={item.lien_pv} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#2563eb', textDecoration: 'underline' }}>📄 Ouvrir le PV</a>
                      : <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{
                      background: item.statut === 'Clôturée' ? '#dcfce7' : '#dbeafe',
                      color:      item.statut === 'Clôturée' ? '#16a34a' : '#2563eb',
                      padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                    }}>{t.statut[item.statut === 'Clôturée' ? 'cloturee' : 'planifiee'] || item.statut}</span>
                  </td>
                  <td className="no-print" style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <button onClick={() => toggleUrgent(item)} title={item.urgent ? 'Retirer l\'alerte' : 'Marquer urgent'}
                        style={{
                          background: item.urgent ? '#fef2f2' : '#f8fafc',
                          color: item.urgent ? '#dc2626' : '#475569',
                          border: `1px solid ${item.urgent ? '#fecaca' : '#e2e8f0'}`,
                          borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                        }}>🚨</button>
                      <button onClick={() => startEdit(item)} style={{
                        background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0',
                        borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                      }}>✏️</button>
                      {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(item)} style={{
                        background: '#fff', color: '#dc2626', border: '1px solid #fecaca',
                        borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                      }}>×</button>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccordsPanel({ showMsg }) {
  const t = useAppI18n();
  const { hasRole } = useAuth();
  const canDelete = hasRole('admin');
  const { data: list, setData: setList } = useUserDoc(LS_ACCORDS_KEY, []);
  const { log: logAudit } = useAudit();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({
    titre: '', date_signature: '', date_application: '', statut: 'En négociation',
  });


  function notify(msg, type = 'success') { showMsg && showMsg(msg, type); }

  function startNew() {
    setEditing(null);
    setDraft({ titre: '', date_signature: '', date_application: '', statut: 'En négociation' });
    setShowForm(true);
  }

  function startEdit(item) {
    setEditing(item);
    setDraft({
      titre: item.titre || '',
      date_signature: item.date_signature || '',
      date_application: item.date_application || '',
      statut: item.statut || 'En négociation',
    });
    setShowForm(true);
  }

  function save() {
    if (!draft.titre.trim()) return notify('Titre obligatoire', 'error');
    const item = {
      ...draft,
      id: editing ? editing.id : Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      urgent: editing ? !!editing.urgent : false,
    };
    let next;
    if (editing) next = list.map(x => x.id === editing.id ? { ...x, ...item } : x);
    else next = [item, ...list];
    setList(next);
    logAudit({
      type: 'Accord',
      client: item.titre,
      number: 'ACC-' + String(item.id).slice(-6).toUpperCase(),
      date: parseDateFR(item.date_signature) || new Date().toISOString().slice(0, 10),
      details: `Statut : ${item.statut}`,
      status: item.statut === 'Signé' || item.statut === 'Déposé à la DREETS' ? 'valide' : 'brouillon',
      extra: { source_action: editing ? 'edit' : 'create', urgent: item.urgent, statut_legal: item.statut },
    });
    notify(editing ? 'Accord mis à jour' : 'Accord ajouté');
    setShowForm(false); setEditing(null);
  }

  async function remove(item) {
    if (!canDelete) return;
    if (!(await systemConfirm('Supprimer cet accord ?'))) return;
    const next = list.filter(x => x.id !== item.id);
    setList(next);
    logAudit({
      type: 'Accord',
      client: item.titre,
      number: 'ACC-' + String(item.id).slice(-6).toUpperCase(),
      details: `Accord supprimé`,
      status: 'annule',
      extra: { source_action: 'delete' },
    });
    notify('Accord supprimé');
  }

  function toggleUrgent(item) {
    const next = list.map(x => x.id === item.id ? { ...x, urgent: !item.urgent } : x);
    setList(next);
  }

  const filtered = list.filter(i => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [i.titre, i.statut, i.date_signature, i.date_application].join(' ').toLowerCase().includes(q);
  });

  return (
    <div>
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, marginBottom: 10,
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#0f766e' }}>📜 Accords & Engagements</div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher…"
          className="no-print"
          style={{ flex: 1, minWidth: 180, padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none' }} />
        <button onClick={startNew} className="no-print" style={{
          background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5,
          padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
        }}>+ Accord</button>
      </div>

      {showForm && (
        <div className="no-print" style={{
          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10, marginBottom: 10,
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'end',
        }}>
          <div style={{ flex: '2 1 240px' }}>
            <label style={lbl}>Titre de l'accord</label>
            <input value={draft.titre} onChange={e => setDraft({ ...draft, titre: e.target.value })}
              placeholder="Ex: Charte Télétravail" style={{ ...inp, width: '100%' }} />
          </div>
          <div>
            <label style={lbl}>Date signature</label>
            <input value={draft.date_signature} onChange={e => setDraft({ ...draft, date_signature: e.target.value })}
              placeholder="JJ/MM/AAAA" style={{ ...inp, width: 120 }} />
          </div>
          <div>
            <label style={lbl}>Date application</label>
            <input value={draft.date_application} onChange={e => setDraft({ ...draft, date_application: e.target.value })}
              placeholder="JJ/MM/AAAA" style={{ ...inp, width: 120 }} />
          </div>
          <div>
            <label style={lbl}>Statut légal</label>
            <select value={draft.statut} onChange={e => setDraft({ ...draft, statut: e.target.value })}
              style={{ ...inp, width: 180 }}>
              {ACCORD_STATUTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={save} style={{
            background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5,
            padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
          }}>{editing ? '💾 Modifier' : '➕ Ajouter'}</button>
          <button onClick={() => { setShowForm(false); setEditing(null); }} style={{
            background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: 5,
            padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
          }}>Annuler</button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
              {['Titre de l\'accord', 'Date de signature', 'Date d\'application', 'Statut légal', ''].map((h, i) => (
                <th key={i} className={h === '' ? 'no-print' : ''} style={{
                  textAlign: 'left', padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                  color: '#475569', fontWeight: 800, fontSize: 11,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
                Aucun accord enregistré. Cliquez sur "+ Accord" pour ajouter un engagement.
              </td></tr>
            )}
            {filtered.map(item => {
              const color = ACCORD_COLORS[item.statut] || '#64748b';
              return (
                <tr key={item.id} style={{
                  borderBottom: '1px solid #f1f5f9',
                  background: item.urgent ? '#fef2f2' : 'transparent',
                }}>
                  <td style={{ padding: '7px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 800, color: '#1e293b' }}>{item.titre}</span>
                      {item.urgent && (
                        <span style={{
                          background: '#dc2626', color: '#fff', padding: '2px 7px',
                          borderRadius: 999, fontSize: 10, fontWeight: 800,
                        }}>🚨 ALERTE</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {item.date_signature || <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                    {item.date_application || <span style={{ color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{
                      background: `${color}20`, color, padding: '3px 10px',
                      borderRadius: 999, fontSize: 11, fontWeight: 800,
                    }}>
                      {item.statut === 'En négociation' ? t.statut.enNegociation
                       : item.statut === 'Signé' ? t.statut.signe
                       : item.statut === 'Déposé à la DREETS' ? t.statut.depose
                       : item.statut}
                    </span>
                  </td>
                  <td className="no-print" style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <button onClick={() => toggleUrgent(item)} title={item.urgent ? 'Retirer l\'alerte' : 'Marquer urgent'}
                        style={{
                          background: item.urgent ? '#fef2f2' : '#f8fafc',
                          color: item.urgent ? '#dc2626' : '#475569',
                          border: `1px solid ${item.urgent ? '#fecaca' : '#e2e8f0'}`,
                          borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                        }}>🚨</button>
                      <button onClick={() => startEdit(item)} style={{
                        background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0',
                        borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                      }}>✏️</button>
                      {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(item)} style={{
                        background: '#fff', color: '#dc2626', border: '1px solid #fecaca',
                        borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                      }}>×</button>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const lbl = {
  fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2, fontWeight: 700,
};

const inp = {
  padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none',
  boxSizing: 'border-box', background: '#fff',
};
