import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useAudit } from '../AuditContext';

const STATUS_BASE = {
  planifiee: '📅 Planifiée',
  en_cours:  '▶️ En cours',
  terminee:  '✅ Terminée',
  evaluee:   '🎓 Évaluée',
  annulee:   '🚫 Annulée',
};
let STATUS_LABELS = STATUS_BASE;

const STATUS_COLORS = {
  planifiee: '#3b82f6',
  en_cours:  '#8b5cf6',
  terminee:  '#16a34a',
  annulee:   '#94a3b8',
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function empName(employes, id) {
  const emp = employes.find(x => String(x.id) === String(id));
  return emp ? `${emp.prenom || ''} ${emp.nom || ''}`.trim() : '—';
}

export default function DeveloppementCarriere({ showMsg }) {
  const { hasRole } = useAuth();
  const { log: logAudit } = useAudit();
  const canEdit = hasRole('admin', 'rh');
  const canDelete = hasRole('admin');

  const [formations, setFormations] = useState([]);
  const [employes, setEmployes]     = useState([]);
  const [participants, setParticipants] = useState({});
  const [loading, setLoading]       = useState(false);
  const [search, setSearch]         = useState('');
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState(null);
  const [draft, setDraft]           = useState({
    titre: '',
    description: '',
    formateur: '',
    date_debut: '',
    date_fin: '',
    cout: '',
    status: 'planifiee',
  });
  const [selectedEmp, setSelectedEmp] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [f, e] = await Promise.all([
        api.getFormations().catch(() => []),
        api.getEmployes('').catch(() => []),
      ]);
      const formationsList = Array.isArray(f) ? f : [];
      setFormations(formationsList);
      setEmployes(Array.isArray(e) ? e : []);

      const map = {};
      await Promise.all(formationsList.map(async (fo) => {
        try {
          const list = await api.getFormationParticipants?.(fo.id).catch(() => null);
          if (Array.isArray(list)) map[fo.id] = list;
        } catch {}
      }));
      setParticipants(map);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function notify(message, type = 'success') {
    if (showMsg) showMsg(message, type);
  }

  function startNew() {
    setEditing(null);
    setDraft({
      titre: '', description: '', formateur: '',
      date_debut: todayISO(), date_fin: '', cout: '', status: 'planifiee',
    });
    setSelectedEmp('');
    setShowForm(true);
  }

  function startEdit(f) {
    setEditing(f);
    setDraft({
      titre:       f.titre || '',
      description: f.description || '',
      formateur:   f.formateur || '',
      date_debut:  f.date_debut || '',
      date_fin:    f.date_fin || '',
      cout:        f.cout ?? '',
      status:      f.status || 'planifiee',
    });
    setShowForm(true);
  }

  async function save() {
    if (!draft.titre.trim()) return notify('Titre obligatoire', 'error');
    try {
      const payload = {
        titre:       draft.titre.trim(),
        description: draft.description || '',
        formateur:   draft.formateur || '',
        date_debut:  draft.date_debut || null,
        date_fin:    draft.date_fin || null,
        cout:        Number(draft.cout) || 0,
        status:      draft.status || 'planifiee',
      };

      let formationId;
      if (editing) {
        await api.updateFormation(editing.id, payload);
        formationId = editing.id;
        notify('Formation mise à jour');
      } else {
        const res = await api.createFormation(payload);
        formationId = res?.id;
        notify('Formation créée');
      }

      if (formationId && selectedEmp && !editing) {
        try {
          await api.addFormationParticipant?.(formationId, { employe_id: selectedEmp });
        } catch (e) {
          console.warn('Participant non enregistré:', e.message);
        }
      }

      logAudit({
        type: 'Formation',
        client: payload.titre,
        number: 'FOR-' + String(formationId).slice(-6).toUpperCase(),
        date: payload.date_debut || new Date().toISOString().slice(0, 10),
        details: `${payload.formateur || 'Formateur'} — ${payload.titre}`,
        status: payload.status === 'terminee' || payload.status === 'evaluee' ? 'valide' : 'brouillon',
        extra: { source_action: editing ? 'edit' : 'create', cout: payload.cout, statut: payload.status },
      });

      setShowForm(false);
      setEditing(null);
      setSelectedEmp('');
      load();
    } catch (e) {
      notify('Erreur : ' + e.message, 'error');
    }
  }

  async function remove(f) {
    if (!canDelete) return;
    if (!(await systemConfirm(`Supprimer « ${f.titre} » ?`))) return;
    try {
      await api.deleteFormation(f.id);
      logAudit({
        type: 'Formation',
        client: f.titre,
        number: 'FOR-' + String(f.id).slice(-6).toUpperCase(),
        details: 'Formation supprimée',
        status: 'annule',
        extra: { source_action: 'delete' },
      });
      notify('Formation supprimée');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return formations;
    const q = search.toLowerCase();
    return formations.filter(f => {
      const participantNames = (participants[f.id] || [])
        .map(p => empName(employes, p.employe_id)).join(' ');
      return [f.titre, f.description, f.formateur, f.status, participantNames]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [formations, search, participants, employes]);

  const stats = useMemo(() => {
    return {
      total:      formations.length,
      enCours:    formations.filter(f => f.status === 'en_cours').length,
      planifiees: formations.filter(f => f.status === 'planifiee').length,
      terminees:  formations.filter(f => f.status === 'terminee').length,
    };
  }, [formations]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          ['📋 Total',      stats.total,      '#0f766e'],
          ['▶️ En cours',   stats.enCours,    '#8b5cf6'],
          ['📅 Planifiées', stats.planifiees, '#3b82f6'],
          ['✅ Terminées',  stats.terminees,  '#16a34a'],
        ].map(([label, value, color]) => (
          <div key={label} style={{
            flex: '1 1 140px', background: '#fff', border: `1px solid ${color}40`,
            borderLeft: `4px solid ${color}`, borderRadius: 10, padding: '10px 14px',
          }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12,
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Rechercher une formation, un formateur, un participant…"
          className="no-print"
          style={{
            flex: 1, minWidth: 200, padding: '8px 10px',
            border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none',
          }}
        />
        {canEdit && (
          <button onClick={startNew} className="no-print" style={{
            background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6,
            padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
          }}>
            + Nouvelle formation
          </button>
        )}
      </div>

      {showForm && (
        <div className="no-print" style={{
          background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 12,
          display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end',
        }}>
          <div>
            <label style={lbl}>Titre *</label>
            <input value={draft.titre} onChange={e => setDraft({ ...draft, titre: e.target.value })}
              placeholder="Ex: Habilitation électrique B2V" style={{ ...inp, width: 240 }} />
          </div>
          <div>
            <label style={lbl}>Formateur / Organisme</label>
            <input value={draft.formateur} onChange={e => setDraft({ ...draft, formateur: e.target.value })}
              placeholder="Ex: AFTRAL" style={{ ...inp, width: 200 }} />
          </div>
          <div>
            <label style={lbl}>Début</label>
            <input type="date" value={draft.date_debut}
              onChange={e => setDraft({ ...draft, date_debut: e.target.value })}
              style={{ ...inp, width: 140 }} />
          </div>
          <div>
            <label style={lbl}>Fin</label>
            <input type="date" value={draft.date_fin}
              onChange={e => setDraft({ ...draft, date_fin: e.target.value })}
              style={{ ...inp, width: 140 }} />
          </div>
          <div>
            <label style={lbl}>Coût (€)</label>
            <input type="number" value={draft.cout}
              onChange={e => setDraft({ ...draft, cout: e.target.value })}
              placeholder="0" style={{ ...inp, width: 100 }} />
          </div>
          <div>
            <label style={lbl}>Statut</label>
            <select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}
              style={{ ...inp, width: 140 }}>
              {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {!editing && (
            <div>
              <label style={lbl}>Participant (optionnel)</label>
              <select value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}
                style={{ ...inp, width: 200 }}>
                <option value="">— Aucun pour l'instant —</option>
                {employes.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.prenom} {emp.nom}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ flex: '1 1 200px' }}>
            <label style={lbl}>Description</label>
            <input value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              placeholder="Objectifs, programme…" style={{ ...inp, width: '100%' }} />
          </div>
          <button onClick={save} style={{
            background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6,
            padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
          }}>
            {editing ? '💾 Modifier' : '➕ Ajouter'}
          </button>
          <button onClick={() => { setShowForm(false); setEditing(null); }} style={{
            background: '#e2e8f0', color: '#475569', border: 'none', borderRadius: 6,
            padding: '8px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12,
          }}>
            Annuler
          </button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
              {['Titre', 'Formateur', 'Période', 'Coût', 'Participants', 'Statut', ''].map((h, i) => (
                <th key={i} className={h === '' ? 'no-print' : ''} style={{
                  textAlign: 'left', padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                  color: '#475569', fontWeight: 800, fontSize: 11,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>⏳ Chargement…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
                Aucune formation enregistrée
              </td></tr>
            )}
            {filtered.map(f => {
              const color = STATUS_COLORS[f.status] || '#64748b';
              const list  = participants[f.id] || [];
              const parts = list.map(p => empName(employes, p.employe_id)).filter(Boolean);
              return (
                <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '7px 10px', fontWeight: 700, color: '#1e293b' }}>
                    <div>{f.titre}</div>
                    {f.description && (
                      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400, marginTop: 2 }}>
                        {f.description}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '7px 10px' }}>{f.formateur || '—'}</td>
                  <td style={{ padding: '7px 10px', fontSize: 11, whiteSpace: 'nowrap' }}>
                    {f.date_debut || '—'}{f.date_fin ? ` → ${f.date_fin}` : ''}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700 }}>
                    {f.cout ? `${Number(f.cout).toFixed(2)} €` : '—'}
                  </td>
                  <td style={{ padding: '7px 10px', fontSize: 11 }}>
                    {parts.length > 0
                      ? <span>{parts.join(', ')} <strong style={{ color: '#0f766e' }}>({list.length})</strong></span>
                      : <span style={{ color: '#94a3b8' }}>Aucun</span>
                    }
                  </td>
                  <td style={{ padding: '7px 10px' }}>
                    <span style={{
                      background: `${color}20`, color, padding: '3px 10px',
                      borderRadius: 999, fontSize: 11, fontWeight: 800,
                    }}>
                      {STATUS_LABELS[f.status] || f.status}
                    </span>
                  </td>
                  <td className="no-print" style={{ padding: '7px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canEdit && (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <button onClick={() => startEdit(f)} style={{
                          background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0',
                          borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                        }}>
                          ✏️
                        </button>
                        {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => remove(f)} style={{
                          background: '#fff', color: '#dc2626', border: '1px solid #fecaca',
                          borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                        }}>
                          ×
                        </button>}
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

const lbl = {
  fontSize: 10, color: '#64748b', display: 'block', marginBottom: 2, fontWeight: 700,
};

const inp = {
  padding: '6px 8px', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, outline: 'none',
  boxSizing: 'border-box', background: '#fff',
};
