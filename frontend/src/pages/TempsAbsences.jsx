import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useUserDoc } from '../useUserDoc';
import { useAudit } from '../AuditContext';
import { useAppI18n } from '../appI18n';

const TYPES_ABSENCE = [
  { value: 'conges_payes', label: '🌴 Congés payés', color: '#10b981' },
  { value: 'maladie',      label: '🏥 Arrêt maladie', color: '#dc2626' },
  { value: 'rtt',          label: '⏰ RTT',            color: '#8b5cf6' },
  { value: 'sans_solde',   label: '💸 Sans solde',     color: '#64748b' },
];

const STATUTS = ['En attente', 'Validé', 'Refusé'];
const STATUT_COLORS = {
  'En attente': '#f59e0b',
  'Validé':     '#16a34a',
  'Refusé':     '#dc2626',
};

const LS_KEY_DEMANDES = 'rh_temps_demandes';
const LS_KEY_COMPTEURS_OVERRIDE = 'rh_temps_compteurs_override';
const LS_KEY_ACQUIS = 'rh_temps_acquis';
const LS_KEY_BULLETIN_RETENUES = 'rh_temps_retenues_bulletins';

const ACQUIS_DEFAUT = 25;
const RETENUES_PAR_JOUR_SANS_SOLDE_PCT = 1 / 22;

function todayISO() { return new Date().toISOString().slice(0, 10); }
function todayFR() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function formatFR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function workingDaysBetween(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO);
  const end   = new Date(endISO);
  if (isNaN(start) || isNaN(end) || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export default function TempsAbsences({ showMsg }) {
  const { hasRole } = useAuth();
  const { log: logAudit } = useAudit();
  const tt = useAppI18n();
  const canEdit = hasRole('admin', 'rh');
  const canDelete = hasRole('admin');

  const [tab, setTab] = useState('compteurs');

  const [employes, setEmployes]           = useState([]);
  const demandesDoc    = useUserDoc(LS_KEY_DEMANDES, []);
  const acquisDoc      = useUserDoc(LS_KEY_ACQUIS, {});
  const compteursDoc   = useUserDoc(LS_KEY_COMPTEURS_OVERRIDE, {});
  const retenuesDoc    = useUserDoc(LS_KEY_BULLETIN_RETENUES, []);

  const demandes = demandesDoc.data;
  const acquis = acquisDoc.data;
  const compteursOverride = compteursDoc.data;
  const retenuesBulletins = retenuesDoc.data;
  const setDemandes = demandesDoc.setData;
  const setAcquis = acquisDoc.setData;
  const setCompteurs = compteursDoc.setData;
  const setRetenuesBulletins = retenuesDoc.setData;

  const [loading, setLoading]           = useState(false);
  const [search, setSearch]             = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [draft, setDraft]       = useState({
    employe_id: '', type: 'conges_payes',
    date_debut: todayISO(), date_fin: todayISO(), statut: 'En attente',
  });

  useEffect(() => {
    setLoading(true);
    api.getEmployes('').catch(() => [])
      .then(emps => setEmployes(Array.isArray(emps) ? emps : []))
      .finally(() => setLoading(false));
  }, []);

  function notify(msg, type = 'success') { showMsg && showMsg(msg, type); }

  function saveDemandes(next) {
    setDemandes(next);

    const retenuesNext = [];
    for (const d of next) {
      if (d.statut !== 'Validé') continue;
      if (d.type === 'sans_solde') {
        retenuesNext.push({
          employe_id: d.employe_id,
          motif: `Congé sans solde du ${formatFR(d.date_debut)} au ${formatFR(d.date_fin)}`,
          jours: d.duree,
          type: 'sans_solde',
        });
      } else if (d.type === 'maladie' && Number(d.duree) > 3) {
        retenuesNext.push({
          employe_id: d.employe_id,
          motif: `Arrêt maladie > 3j du ${formatFR(d.date_debut)} au ${formatFR(d.date_fin)}`,
          jours: d.duree,
          type: 'maladie',
        });
      }
    }
    setRetenuesBulletins(retenuesNext);
  }

  function startNew() {
    setEditing(null);
    setDraft({
      employe_id: employes[0]?.id || '',
      type: 'conges_payes',
      date_debut: todayISO(),
      date_fin: todayISO(),
      statut: 'En attente',
    });
    setShowForm(true);
  }

  function startEdit(d) {
    setEditing(d);
    setDraft({
      employe_id: d.employe_id || '',
      type: d.type || 'conges_payes',
      date_debut: d.date_debut || todayISO(),
      date_fin: d.date_fin || todayISO(),
      statut: d.statut || 'En attente',
    });
    setShowForm(true);
  }

  function save() {
    if (!draft.employe_id) return notify('Sélectionnez un salarié', 'error');
    if (!draft.date_debut || !draft.date_fin) return notify('Dates obligatoires', 'error');
    if (draft.date_fin < draft.date_debut) return notify('Date de fin avant la date de début', 'error');

    const duree = workingDaysBetween(draft.date_debut, draft.date_fin);
    const item = {
      ...draft,
      duree,
      id: editing ? editing.id : Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    };
    let next;
    if (editing) next = demandes.map(x => x.id === editing.id ? { ...x, ...item } : x);
    else next = [item, ...demandes];
    saveDemandes(next);
    const emp = employes.find(e => String(e.id) === String(item.employe_id));
    const empName = emp ? `${emp.prenom} ${emp.nom}` : '';
    logAudit({
      type: 'Absence',
      client: empName,
      number: 'ABS-' + String(item.id).slice(-6).toUpperCase(),
      date: item.date_debut,
      details: `${item.type} (${item.duree}j) — ${item.statut}`,
      status: item.statut === 'Validé' ? 'valide' : (item.statut === 'Refusé' ? 'annule' : 'brouillon'),
      extra: { source_action: editing ? 'edit' : 'create', type_absence: item.type, duree: item.duree },
    });
    notify(editing ? 'Demande mise à jour' : 'Demande enregistrée');
    setShowForm(false); setEditing(null);
  }

  async function remove(d) {
    if (!canDelete) return;
    if (!(await systemConfirm('Supprimer cette demande ?'))) return;
    saveDemandes(demandes.filter(x => x.id !== d.id));
    const emp = employes.find(e => String(e.id) === String(d.employe_id));
    logAudit({
      type: 'Absence',
      client: emp ? `${emp.prenom} ${emp.nom}` : '',
      number: 'ABS-' + String(d.id).slice(-6).toUpperCase(),
      details: 'Demande supprimée',
      status: 'annule',
      extra: { source_action: 'delete' },
    });
    notify('Demande supprimée');
  }

  // ── Compteurs calculés ──────────────────────────────────────────────────────
  const compteurs = useMemo(() => {
    return employes.map(emp => {
      const id = String(emp.id);
      const acquisValue = (acquis[id] ?? ACQUIS_DEFAUT);
      const empDemandes = demandes.filter(d => String(d.employe_id) === id && d.statut === 'Validé');
      const prisConges  = empDemandes.filter(d => d.type === 'conges_payes').reduce((s, d) => s + Number(d.duree || 0), 0);
      const prisRTT     = empDemandes.filter(d => d.type === 'rtt').reduce((s, d) => s + Number(d.duree || 0), 0);
      const pris        = prisConges + prisRTT;
      const maladie     = empDemandes.filter(d => d.type === 'maladie').reduce((s, d) => s + Number(d.duree || 0), 0);
      const override    = compteursOverride[id];
      const solde       = override?.solde ?? Math.max(0, acquisValue - pris);
      return {
        id, nom: emp.nom, prenom: emp.prenom, poste: emp.poste,
        acquis: acquisValue, pris, solde, maladie,
        sans_solde_jours: empDemandes.filter(d => d.type === 'sans_solde').reduce((s, d) => s + Number(d.duree || 0), 0),
      };
    });
  }, [employes, demandes, acquis, compteursOverride]);

  function setSoldeManuel(id, value) {
    const next = { ...compteursOverride, [id]: { solde: Number(value) || 0 } };
    setCompteurs(next);
  }

  function setAcquisManuel(id, value) {
    const next = { ...acquis, [id]: Number(value) || 0 };
    setAcquis(next);
  }

  const filteredCompteurs = compteurs.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [c.nom, c.prenom, c.poste].join(' ').toLowerCase().includes(q);
  });

  const filteredDemandes = demandes
    .slice()
    .sort((a, b) => (b.date_debut || '').localeCompare(a.date_debut || ''))
    .filter(d => {
      if (!search.trim()) return true;
      const emp = employes.find(e => String(e.id) === String(d.employe_id));
      const q = search.toLowerCase();
      return [
        emp ? `${emp.prenom} ${emp.nom}` : '',
        d.type, d.statut, d.date_debut, d.date_fin,
      ].join(' ').toLowerCase().includes(q);
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 4 }}>Saisie manuelle</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>Utilisez le bouton « + Demande » dans l'onglet Demandes pour saisir manuellement une absence.</div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {[
          { id: 'compteurs', label: '📊 ' + tt.temps.counters },
          { id: 'demandes',  label: '📅 ' + tt.temps.demands },
          { id: 'bulletins', label: '💵 ' + tt.temps.bulletinLink },
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

      {tab === 'compteurs' && (
        <CompteursPanel
          compteurs={filteredCompteurs}
          canEdit={canEdit}
          canDelete={canDelete}
          onSetSolde={setSoldeManuel}
          onSetAcquis={setAcquisManuel}
        />
      )}

      {tab === 'demandes' && (
        <DemandesPanel
          demandes={filteredDemandes}
          employes={employes}
          canEdit={canEdit}
          canDelete={canDelete}
          onNew={startNew}
          onEdit={startEdit}
          onRemove={remove}
          search={search}
          setSearch={setSearch}
        />
      )}

      {tab === 'bulletins' && (
        <RetenuesBulletins retenues={retenuesBulletins} employes={employes} />
      )}

      {showForm && (
        <div className="no-print" style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 18, width: 460, maxWidth: '90vw',
            boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
          }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12, color: '#0f766e' }}>
              {editing ? '✏️ Modifier la demande' : '➕ Nouvelle demande'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <label style={lbl}>Salarié</label>
                <select value={draft.employe_id} onChange={e => setDraft({ ...draft, employe_id: e.target.value })}
                  style={{ ...inp, width: '100%' }}>
                  <option value="">— Sélectionner —</option>
                  {employes.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.prenom} {emp.nom}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={lbl}>Type d'absence</label>
                <select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}
                  style={{ ...inp, width: '100%' }}>
                  {TYPES_ABSENCE.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Date début</label>
                  <input type="date" value={draft.date_debut}
                    onChange={e => setDraft({ ...draft, date_debut: e.target.value })}
                    style={{ ...inp, width: '100%' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Date fin</label>
                  <input type="date" value={draft.date_fin}
                    onChange={e => setDraft({ ...draft, date_fin: e.target.value })}
                    style={{ ...inp, width: '100%' }} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#0f766e', fontWeight: 700 }}>
                ⏱ Durée calculée : {workingDaysBetween(draft.date_debut, draft.date_fin)} jour(s) ouvré(s)
              </div>
              <div>
                <label style={lbl}>Statut</label>
                <select value={draft.statut} onChange={e => setDraft({ ...draft, statut: e.target.value })}
                  style={{ ...inp, width: '100%' }}>
                  {STATUTS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowForm(false); setEditing(null); }} style={btnGhost}>Annuler</button>
              <button onClick={save} style={btnPrimary}>{editing ? '💾 Modifier' : '➕ Ajouter'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CompteursPanel({ compteurs, canEdit, onSetSolde, onSetAcquis }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
            {['Salarié', 'Congés acquis', 'Congés pris', 'Solde restant', 'Arrêts maladie (cumul)'].map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                color: '#475569', fontWeight: 800, fontSize: 11,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {compteurs.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
              Aucun salarié enregistré
            </td></tr>
          )}
          {compteurs.map(c => (
            <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '7px 10px', fontWeight: 700, color: '#1e293b' }}>
                {c.prenom} {c.nom}
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>{c.poste || ''}</div>
              </td>
              <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                {canEdit
                  ? <input type="number" defaultValue={c.acquis} onBlur={e => onSetAcquis(c.id, e.target.value)}
                      style={{ ...numInp, width: 70 }} />
                  : <strong>{c.acquis}</strong>}
              </td>
              <td style={{ padding: '7px 10px', textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>
                {c.pris} j
              </td>
              <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                {canEdit
                  ? <input type="number" defaultValue={c.solde} onBlur={e => onSetSolde(c.id, e.target.value)}
                      style={{ ...numInp, width: 70, color: c.solde <= 3 ? '#dc2626' : '#16a34a', fontWeight: 800 }} />
                  : <span style={{
                      background: c.solde <= 3 ? '#fef2f2' : '#dcfce7',
                      color:      c.solde <= 3 ? '#dc2626' : '#16a34a',
                      padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                    }}>{c.solde} j</span>}
              </td>
              <td style={{ padding: '7px 10px', textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>
                {c.maladie} j
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DemandesPanel({ demandes, employes, canEdit, canDelete, onNew, onEdit, onRemove, search, setSearch }) {
  const tt = useAppI18n();
  return (
    <div>
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, marginBottom: 10,
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#0f766e' }}>📅 Demandes & Plannings</div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher…"
          className="no-print"
          style={{ flex: 1, minWidth: 180, padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none' }} />
        {canEdit && (
          <button onClick={onNew} className="no-print" style={btnAdd}>+ Demande</button>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
              {['Salarié', 'Type d\'absence', 'Début', 'Fin', 'Durée', 'Statut', ''].map((h, i) => (
                <th key={i} className={h === '' ? 'no-print' : ''} style={{
                  textAlign: 'left', padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                  color: '#475569', fontWeight: 800, fontSize: 11,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {demandes.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
                Aucune demande. Collez une demande ci-dessus pour démarrer.
              </td></tr>
            )}
            {demandes.map(d => {
              const emp = employes.find(e => String(e.id) === String(d.employe_id));
              const typeInfo = TYPES_ABSENCE.find(t => t.value === d.type);
              const color = typeInfo?.color || '#64748b';
              const statutColor = STATUT_COLORS[d.statut] || '#64748b';
              const retenue = (d.statut === 'Validé') && ((d.type === 'sans_solde') || (d.type === 'maladie' && Number(d.duree) > 3));
              return (
                <tr key={d.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '7px 10px', fontWeight: 700, color: '#1e293b' }}>
                    {emp ? `${emp.prenom} ${emp.nom}` : `Employé #${d.employe_id}`}
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        background: `${color}20`, color, padding: '3px 9px',
                        borderRadius: 999, fontSize: 11, fontWeight: 800,
                      }}>{typeInfo?.label || d.type}</span>
                      {retenue && (
                        <span title="Retenue prévue sur le bulletin de paie"
                          style={{
                            background: '#fef3c7', color: '#b45309', padding: '2px 7px',
                            borderRadius: 999, fontSize: 10, fontWeight: 800, border: '1px solid #fde68a',
                          }}>💸 Retenue</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{formatFR(d.date_debut)}</td>
                  <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{formatFR(d.date_fin)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 700 }}>
                    {d.duree} j
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{
                      background: `${statutColor}20`, color: statutColor,
                      padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                    }}>
                      {d.statut === 'En attente' ? tt.statut.enAttente
                       : d.statut === 'Validé' ? tt.statut.valide
                       : d.statut === 'Refusé' ? tt.statut.refuse
                       : d.statut}
                    </span>
                  </td>
                  <td className="no-print" style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {(canEdit || canDelete) && (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        {canEdit && <button onClick={() => onEdit(d)} style={{
                          background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0',
                          borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                        }}>✏️</button>}
                        {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => onRemove(d)} style={{
                          background: '#fff', color: '#dc2626', border: '1px solid #fecaca',
                          borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                        }}>×</button>}
                      </span>
                    )}
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

function RetenuesBulletins({ retenues, employes }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
      <div style={{ padding: '12px 14px', background: '#fef3c7', borderBottom: '1px solid #fde68a', fontWeight: 800, color: '#b45309' }}>
        💵 Retenues automatiques détectées — page Bulletins de Paie
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            {['Salarié', 'Motif', 'Jours', 'Type'].map(h => (
              <th key={h} style={{
                textAlign: 'left', padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                color: '#475569', fontWeight: 800, fontSize: 11,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {retenues.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
              Aucune retenue automatique en attente.
              <br />
              <span style={{ fontSize: 11 }}>
                Les congés <strong>sans solde</strong> et <strong>arrêts maladie &gt; 3 jours</strong> validés apparaîtront ici.
              </span>
            </td></tr>
          )}
          {retenues.map((r, i) => {
            const emp = employes.find(e => String(e.id) === String(r.employe_id));
            return (
              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '7px 10px', fontWeight: 700 }}>{emp ? `${emp.prenom} ${emp.nom}` : `#${r.employe_id}`}</td>
                <td style={{ padding: '7px 10px' }}>{r.motif}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 700, color: '#dc2626' }}>{r.jours} j</td>
                <td style={{ padding: '7px 10px' }}>
                  <span style={{
                    background: r.type === 'sans_solde' ? '#f1f5f9' : '#fef2f2',
                    color:      r.type === 'sans_solde' ? '#475569' : '#dc2626',
                    padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                  }}>{r.type === 'sans_solde' ? 'Sans solde' : 'Maladie > 3j'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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

const numInp = {
  padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12,
  textAlign: 'center', outline: 'none',
};

const btnPrimary = {
  background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6,
  padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
};

const btnGhost = {
  background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: 6,
  padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
};

const btnAdd = {
  background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5,
  padding: '6px 12px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
};
