import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useUserDoc } from '../useUserDoc';
import { useAudit } from '../AuditContext';
import { useAppI18n } from '../appI18n';

// ─── Pipeline ────────────────────────────────────────────────────────────────

const PIPELINE = [
  { value: 'nouveau_cv',    labelKey: 'newCv',      color: '#3b82f6' },
  { value: 'entretien',     labelKey: 'entretien',  color: '#8b5cf6' },
  { value: 'offre_envoyee', labelKey: 'offre',      color: '#f59e0b' },
  { value: 'embauche',      labelKey: 'embauche',   color: '#16a34a' },
  { value: 'refuse',        labelKey: 'refuse',     color: '#dc2626' },
];

const MONTHS = {
  janvier: 0, fevrier: 1, février: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, août: 7, septembre: 8, octobre: 9, novembre: 10,
  decembre: 11, décembre: 11,
};

// statusLabels sera calculé dynamiquement via i18n
let statusLabels = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayDDMMYYYY() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function formatDDMMYYYY(day, month, yearToken) {
  const year = yearToken
    ? (String(yearToken).length === 2 ? `20${yearToken}` : yearToken)
    : new Date().getFullYear();
  return `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}/${year}`;
}

function formatDisplayDate(date) {
  if (!date) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date.split('-').reverse().join('/');
  return date;
}

function normalizeText(value) {
  return String(value || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ').trim();
}

function cleanValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
    .replace(/^[,:-]+\s*/, '').replace(/[.;,]+$/, '');
}

function cleanNameParts(value) {
  const stop = new Set(['le','la','les','un','une','pour','du','de','des','avec','et']);
  const parts = cleanValue(value).split(/\s+/)
    .filter(p => p && !/^\d/.test(p) && !stop.has(p.toLowerCase()));
  while (parts.length > 2 && !/^[A-ZÀ-ÿ]/.test(parts[parts.length - 1])) parts.pop();
  return parts;
}

function capitalize(value) {
  return cleanValue(value).replace(/\b\w/g, l => l.toUpperCase());
}

function normalizeStatus(status) {
  const v = normalizeText(status || 'nouveau_cv');
  if (v.includes('embauche') || v === 'retenu' || v === 'hired') return 'embauche';
  if (v.includes('offre') || v.includes('envoy') || v === 'sent') return 'offre_envoyee';
  if (v.includes('entretien') || v.includes('contact') || v === 'interview') return 'entretien';
  if (v.includes('refus') || v.includes('rejet') || v === 'rejected') return 'refuse';
  return 'nouveau_cv';
}

function normalizeCandidate(c) {
  return { ...c, status: normalizeStatus(c.status) };
}

function stageColor(status) {
  return PIPELINE.find(s => s.value === status)?.color || '#64748b';
}

function findExistingCandidate(candidates, payload) {
  const email = normalizeText(payload.email);
  if (email) {
    const byEmail = candidates.find(c => normalizeText(c.email) === email);
    if (byEmail) return byEmail;
  }
  return candidates.find(
    c => normalizeText(c.nom) === normalizeText(payload.nom) &&
         normalizeText(c.prenom) === normalizeText(payload.prenom)
  );
}

function buildNotes(text) {
  const source = cleanValue(text).slice(0, 500);
  return source ? `Extraction automatique depuis la saisie IA : ${source}` : '';
}

// ─── Extraction ──────────────────────────────────────────────────────────────

function extractEmail(text) {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : '';
}

function extractPhone(text) {
  const m = text.match(/(?:\+?\d{2,3}[\s.-]?)?(?:0[1-7]\d[\s.-]?\d{2}[\s.-]?\d{2}[\s.-]?\d{2})/);
  return m ? m[0].replace(/[\s.-]/g, '') : '';
}

function extractNames(text, email) {
  const nomM = text.match(/\b(?:nom|last name|surname)\s*[:]\s*([A-ZÀ-ÿ][A-ZÀ-ÿ''.-]*)/i);
  const prenomM = text.match(/\b(?:pr[eé]nom|first name|given name)\s*[:]\s*([A-ZÀ-ÿ][A-ZÀ-ÿ''.-]*)/i);
  if (nomM && prenomM) return { nom: cleanValue(nomM[1]), prenom: cleanValue(prenomM[1]) };

  const naturalM = text.match(/\b(?:ajouter|ajout|avec|pour)\s+([A-ZÀ-ÿ][A-ZÀ-ÿ'._-]+\s+[A-ZÀ-ÿ][A-ZÀ-ÿ'._-]{2,})/i);
  if (naturalM) {
    const parts = cleanNameParts(naturalM[1]);
    if (parts.length >= 2) return { prenom: parts[0], nom: parts.slice(1).join(' ') };
  }

  const cvM = text.match(/\b(?:candidat|profil|cv|curriculum)\s+(?:de\s+)?([A-ZÀ-ÿ][A-ZÀ-ÿ'._-]*(?:\s+[A-ZÀ-ÿ][A-ZÀ-ÿ'._-]*){0,5})/i);
  if (cvM) {
    const parts = cleanNameParts(cvM[1]);
    if (parts.length >= 2) return { prenom: parts[0], nom: parts.slice(1).join(' ') };
    if (parts.length === 1) return { prenom: parts[0], nom: 'Candidat' };
  }

  if (email) {
    const parts = email.split('@')[0].split(/[._-]+/).filter(Boolean);
    if (parts.length >= 2) return { prenom: capitalize(parts[0]), nom: capitalize(parts.slice(1).join(' ')) };
    if (parts.length === 1) return { prenom: capitalize(parts[0]), nom: 'Candidat' };
  }

  return { nom: 'Candidat', prenom: 'Non renseigné' };
}

function extractPosition(text) {
  const patterns = [
    /poste\s+vis[eé]\s*[:]\s*([^\n\r.;]+)/i,
    /poste\s+occup[eé]\s*[:]\s*([^\n\r.;]+)/i,
    /dernier\s+poste\s+occup[eé]\s*[:]\s*([^\n\r.;]+)/i,
    /poste\s+actuel\s*[:]\s*([^\n\r.;]+)/i,
    /poste\s*[:]\s*([^\n\r.;]+)/i,
    /poste\s+de\s+([^\n\r.;]+)/i,
    /pour\s+le\s+poste\s+de\s+([^\n\r.;]+)/i,
    /emploi\s+(?:pour|de)\s+([^\n\r.;]+)/i,
    /offre\s+d['']emploi\s+(?:pour\s+)?(?:le\s+)?poste\s+de\s+([^\n\r.;]+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return cleanValue(m[1]);
  }
  return '';
}

function detectStatus(text) {
  const lower = normalizeText(text);
  if (lower.includes('embauche') || lower.includes('engage') || lower.includes('retenu') || lower.includes('recrute')) return 'embauche';
  if (lower.includes('offre envoy') || lower.includes('offre envoyée') || lower.includes('offre envoyee')) return 'offre_envoyee';
  if (lower.includes('entretien') || lower.includes('rendez-vous') || lower.includes('rdv') || lower.includes('convocation') || lower.includes('contact')) return 'entretien';
  if (lower.includes('refus') || lower.includes('rejete') || lower.includes('rejected') || lower.includes('refuser')) return 'refuse';
  return 'nouveau_cv';
}

function extractDate(text) {
  const numeric = text.match(/\b(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?\b/);
  if (numeric) return formatDDMMYYYY(Number(numeric[1]), Number(numeric[2]), numeric[3]);

  const monthName = text.match(/\b(\d{1,2})\s+(janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)(?:\s+\d{4})?\b/i);
  if (monthName) return formatDDMMYYYY(Number(monthName[1]), MONTHS[monthName[2].toLowerCase()] + 1, monthName[0].match(/\d{4}/)?.[0]);

  return todayDDMMYYYY();
}

function extractRecruitmentData(text) {
  const email     = extractEmail(text);
  const telephone = extractPhone(text);
  const { nom, prenom } = extractNames(text, email);
  const poste  = extractPosition(text);
  const status = detectStatus(text);
  const date   = extractDate(text);
  return { nom, prenom, email, telephone, poste, status, date };
}

// ─── Persistance serveur par utilisateur (useUserDoc) ───────────────────────

const LS_KEY = 'rh_recrutements_local';

async function safeUpdateCandidature(id, payload, persistLocal) {
  try {
    const result = await api.updateCandidature(id, payload);
    persistLocal(prev => prev.map(c => c.id === id ? { ...c, ...payload } : c));
    return { ok: true, data: result };
  } catch (e) {
    const msg = (e.message || '').toLowerCase();
    const isEmployeError = msg.includes('introuvable') || msg.includes('not found') || msg.includes('404') || msg.includes('employé');
    if (isEmployeError) {
      persistLocal(prev => {
        const idx = prev.findIndex(c => c.id === id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = { ...next[idx], ...payload };
          return next;
        }
        return [{ id, ...payload }, ...prev];
      });
      return { ok: true, data: { id, ...payload }, local: true };
    }
    throw e;
  }
}

async function safeCreateCandidature(payload, persistLocal) {
  try {
    const result = await api.createCandidature(payload);
    persistLocal(prev => [{ ...payload, id: result.id || result }, ...prev]);
    return { ok: true, data: result };
  } catch (e) {
    const newId = Date.now();
    persistLocal(prev => [{ ...payload, id: newId }, ...prev]);
    return { ok: true, data: { id: newId, ...payload }, local: true };
  }
}

async function safeGetCandidatures(persistLocal) {
  try {
    const data = await api.getCandidatures();
    const serverIds = new Set(data.map(c => c.id));
    const merged = [...data];
    persistLocal(prev => {
      const onlyLocal = prev.filter(c => !serverIds.has(c.id));
      return [...data, ...onlyLocal];
    });
    return merged;
  } catch {
    return null;
  }
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function RecrutementsPage({ showMsg }) {
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'rh');
  const canDelete = hasRole('admin');

  const candDoc = useUserDoc(LS_KEY, []);
  const candidates = candDoc.data;
  const setCandidates = candDoc.setData;
  const { log: logAudit } = useAudit();
  const t = useAppI18n();

  const [loading, setLoading]         = useState(false);
  const [editingId, setEditingId]     = useState(null);
  const [draft, setDraft]             = useState(null);
  const [search, setSearch]           = useState('');
  const [savingId, setSavingId]       = useState(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCandidat, setNewCandidat] = useState({ prenom: '', nom: '', email: '', telephone: '', poste: '', statut: 'nouveau_cv', date_dernier_contact: '' });

  // Pipeline + status labels traduits dynamiquement
  const pipeline = useMemo(() => PIPELINE.map(p => ({ ...p, label: t.recrutements[p.labelKey] || p.labelKey })), [t]);
  const statusLabels = useMemo(() => pipeline.reduce((acc, s) => { acc[s.value] = s.label; return acc; }, {}), [pipeline]);

  useEffect(() => {
    (async () => {
      try {
        const data = await safeGetCandidatures(setCandidates);
        if (data) setCandidates(data.map(normalizeCandidate));
      } catch (e) { notify(e.message, 'error'); }
    })();
    // eslint-disable-next-line
  }, []);

  // À chaque modif locale, on persiste via useUserDoc (déjà automatique)
  useEffect(() => {
    if (!candDoc.loaded) return;
  }, [candidates, candDoc.loaded]);

  // ── Notification helper ──────────────────────────────────────────────────────

  function notify(message, type = 'success') {
    if (showMsg) showMsg(message, type);
  }

  // ── Nouvelle candidature ─────────────────────────────────────────────────────

  function handleNewField(field, value) {
    setNewCandidat(prev => ({ ...prev, [field]: value }));
  }

  async function handleCreateCandidat() {
    const { prenom, nom } = newCandidat;
    if (!prenom.trim() && !nom.trim()) { notify('Prénom ou nom requis.', 'error'); return; }
    setLoading(true);
    try {
      const payload = {
        nom:                  nom.trim() || 'Candidat',
        prenom:               prenom.trim() || 'Non renseigné',
        email:                newCandidat.email || '',
        telephone:            newCandidat.telephone || '',
        poste:                newCandidat.poste || '',
        departement:          '',
        date_dernier_contact: newCandidat.date_dernier_contact || todayDDMMYYYY(),
        status:               normalizeStatus(newCandidat.statut),
        notes:                '',
        description_ia:       '',
      };

      const existing = findExistingCandidate(candidates, payload);

      if (existing) {
        const res = await safeUpdateCandidature(existing.id, payload, setCandidates);
        setCandidates(prev => prev.map(c => c.id === existing.id ? { ...c, ...payload } : c));
        logAudit({
          type: 'Candidature',
          client: `${payload.prenom} ${payload.nom}`,
          number: `CAND-${String(existing.id).slice(0, 6)}`,
          details: `Statut changé → ${statusLabels[payload.status]}`,
          status: 'valide',
          extra: { source_action: 'saisie_manuelle', poste: payload.poste, statut: payload.status },
        });
        notify(res.local
          ? `Statut mis à jour localement : ${statusLabels[payload.status]}`
          : `Candidature mise à jour : ${statusLabels[payload.status]}`
        );
      } else {
        const res = await safeCreateCandidature(payload, setCandidates);
        const newId = res.data?.id || Date.now();
        setCandidates(prev => [{ id: newId, ...payload }, ...prev]);
        logAudit({
          type: 'Candidature',
          client: `${payload.prenom} ${payload.nom}`,
          number: `CAND-${String(newId).slice(0, 6)}`,
          details: `Nouvelle candidature : ${statusLabels[payload.status]} — ${payload.poste}`,
          status: 'valide',
          extra: { source_action: 'saisie_manuelle', poste: payload.poste, statut: payload.status },
        });
        notify(res.local ? 'Candidature créée localement' : 'Candidature créée');
      }

      setNewCandidat({ prenom: '', nom: '', email: '', telephone: '', poste: '', statut: 'nouveau_cv', date_dernier_contact: '' });
      setShowNewForm(false);
      setEditingId(null);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  // ── Edition inline ──────────────────────────────────────────────────────────

  function startEdit(candidate) {
    setEditingId(candidate.id);
    setDraft(normalizeCandidate(candidate));
  }

  function updateDraft(field, value) {
    setDraft(prev => ({ ...prev, [field]: value }));
  }

  async function saveDraft() {
    if (!draft) return;
    setSavingId(draft.id);
    try {
      const payload = {
        nom:                  draft.nom    || 'Candidat',
        prenom:               draft.prenom || 'Non renseigné',
        email:                draft.email  || '',
        telephone:            draft.telephone || '',
        poste:                draft.poste  || '',
        departement:          draft.departement || '',
        date_dernier_contact: draft.date_dernier_contact || todayDDMMYYYY(),
        status:               normalizeStatus(draft.status),
        notes:                draft.notes  || '',
      };

      const res = await safeUpdateCandidature(draft.id, payload, setCandidates);

      setCandidates(prev =>
        prev.map(c => c.id === draft.id ? { ...c, ...payload, status: normalizeStatus(payload.status) } : c)
      );

      if (payload.status === 'embauche' && res.data?.employee_created) {
        notify('Candidat embauché transféré vers Administration & Paie');
      } else {
        notify(res.local
          ? `✅ Statut changé localement en « ${statusLabels[payload.status]} »`
          : `✅ Statut mis à jour : « ${statusLabels[payload.status]} »`
        );
      }

      setEditingId(null);
      setDraft(null);
    } catch (e) {
      notify('Erreur lors de la sauvegarde : ' + e.message, 'error');
    } finally {
      setSavingId(null);
    }
  }

  // ── Changement rapide de statut (boutons pipeline kanban) ──────────────────

  async function quickStatus(candidate, newStatus) {
    if (!canEdit) return;
    setSavingId(candidate.id);
    try {
      const payload = { ...candidate, status: newStatus };
      await safeUpdateCandidature(candidate.id, payload, setCandidates);
      setCandidates(prev =>
        prev.map(c => c.id === candidate.id ? { ...c, status: newStatus } : c)
      );
      logAudit({
        type: 'Candidature',
        client: `${candidate.prenom} ${candidate.nom}`,
        number: `CAND-${String(candidate.id).slice(0, 6)}`,
        details: `Pipeline → ${statusLabels[newStatus]}`,
        status: 'valide',
        extra: { source_action: 'quick_status', poste: candidate.poste, statut: newStatus },
      });
      notify(`✅ ${candidate.prenom} ${candidate.nom} → ${statusLabels[newStatus]}`);
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setSavingId(null);
    }
  }

  // ── Suppression ─────────────────────────────────────────────────────────────

  async function deleteCandidate(candidate) {
    if (!canDelete) return;
    if (!(await systemConfirm(`Supprimer la candidature de ${candidate.prenom} ${candidate.nom} ?`))) return;
    try {
      await api.deleteCandidature?.(candidate.id);
    } catch { /* ignore si l'API n'existe pas */ }
    setCandidates(prev => prev.filter(c => c.id !== candidate.id));
    logAudit({
      type: 'Candidature',
      client: `${candidate.prenom} ${candidate.nom}`,
      number: `CAND-${String(candidate.id).slice(0, 6)}`,
      details: `Candidature supprimée`,
      status: 'annule',
      extra: { source_action: 'delete', poste: candidate.poste },
    });
    notify('Candidature supprimée');
  }

  // ── Filtrage ─────────────────────────────────────────────────────────────────

  const filteredCandidates = useMemo(() => {
    if (!search.trim()) return candidates;
    const q = normalizeText(search);
    return candidates.filter(c =>
      normalizeText([c.nom, c.prenom, c.email, c.telephone, c.poste, statusLabels[c.status]].join(' ')).includes(q)
    );
  }, [candidates, search]);

  // ── Rendu ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, height: '100%', minHeight: 0 }}>

      {/* ── Zone ajout manuel ── */}
      {!showNewForm ? (
        <div style={{ background: '#f8fafc', border: '2px solid #e2e8f0', borderRadius: 12, padding: 14, flex: '0 0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#334155' }}>Candidatures</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Ajoutez des candidatures via le formulaire de saisie manuelle
              </div>
            </div>
            {canEdit && (
              <button onClick={() => setShowNewForm(true)}
                style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 800, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                + Nouvelle candidature
              </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ background: '#f0f9ff', border: '2px solid #bae6fd', borderRadius: 12, padding: 14, flex: '0 0 auto' }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: '#0369a1', marginBottom: 10 }}>Nouvelle candidature</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            <input value={newCandidat.prenom} onChange={e => handleNewField('prenom', e.target.value)} placeholder="Prénom *" style={inputStyle} />
            <input value={newCandidat.nom} onChange={e => handleNewField('nom', e.target.value)} placeholder="Nom *" style={inputStyle} />
            <input value={newCandidat.email} onChange={e => handleNewField('email', e.target.value)} placeholder="Email" style={inputStyle} />
            <input value={newCandidat.telephone} onChange={e => handleNewField('telephone', e.target.value)} placeholder="Téléphone" style={inputStyle} />
            <input value={newCandidat.poste} onChange={e => handleNewField('poste', e.target.value)} placeholder="Poste" style={inputStyle} />
            <select value={newCandidat.statut} onChange={e => handleNewField('statut', e.target.value)} style={selectStyle}>
              {pipeline.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input value={newCandidat.date_dernier_contact} onChange={e => handleNewField('date_dernier_contact', e.target.value)} placeholder="Date de contact (JJ/MM/AAAA)" style={{ ...inputStyle, width: '100%' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowNewForm(false); setNewCandidat({ prenom: '', nom: '', email: '', telephone: '', poste: '', statut: 'nouveau_cv', date_dernier_contact: '' }); }}
              style={ghostButton}>
              Annuler
            </button>
            <button onClick={handleCreateCandidat} disabled={loading}
              style={{ ...primaryButton, opacity: loading ? .65 : 1 }}>
              {loading ? '⏳ Création...' : '✅ Créer'}
            </button>
          </div>
        </div>
      )}

      {/* ── Pipeline Kanban ── */}
      <div style={{ flex: '0 0 auto' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 Rechercher par nom, poste, email..."
            style={{ flex: 1, padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, outline: 'none' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(170px, 1fr))', gap: 10 }}>
          {pipeline.map(stage => {
            const items = filteredCandidates.filter(c => c.status === stage.value);
            return (
              <div key={stage.value} style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 260 }}>
                <div style={{ padding: '9px 10px', borderBottom: '1px solid #e2e8f0', background: `${stage.color}12`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 800, fontSize: 12, color: '#334155' }}>{stage.label}</div>
                  <span style={{ background: stage.color, color: '#fff', borderRadius: 999, padding: '2px 7px', fontSize: 11, fontWeight: 800 }}>{items.length}</span>
                </div>
                <div style={{ padding: 8, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 11, textAlign: 'center', padding: 14 }}>Aucun profil</div>}
                  {items.map(c => (
                    <div key={c.id} style={{ background: c.status === 'embauche' ? '#ecfdf5' : '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 9, padding: 9, cursor: 'default' }}>
                      <div style={{ fontWeight: 800, fontSize: 12, color: '#1e293b' }}>{c.prenom} {c.nom}</div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.poste || 'Poste non renseigné'}</div>
                      <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 4 }}>{formatDisplayDate(c.date_dernier_contact)}</div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                          {PIPELINE.filter(s => s.value !== c.status).map(s => (
                            <button key={s.value} onClick={() => quickStatus(c, s.value)}
                              disabled={savingId === c.id}
                              title={`Changer en : ${s.label}`}
                              style={{ background: `${s.color}18`, color: s.color, border: `1px solid ${s.color}40`, borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700, cursor: savingId === c.id ? 'wait' : 'pointer' }}>
                              {savingId === c.id ? '…' : s.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Tableau liste ── */}
      <div style={{ flex: '1 1 auto', minHeight: 0, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
              {['Candidat', 'Notes', 'Poste visé', 'Dernier contact', 'Statut', 'Actions'].map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '9px 10px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 800, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredCandidates.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 12 }}>Aucune candidature</td></tr>
            )}
            {filteredCandidates.map(candidate => {
              const isEditing = editingId === candidate.id;
              const row = isEditing ? draft : candidate;
              if (!row) return null;
              const isSaving = savingId === candidate.id;

              return (
                <tr key={candidate.id}
                  style={{ cursor: isEditing ? 'default' : 'pointer', background: candidate.status === 'embauche' ? '#f0fdf4' : 'transparent' }}>

                  {/* Candidat */}
                  <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input value={row.prenom || ''} onChange={e => updateDraft('prenom', e.target.value)} placeholder="Prénom" style={inputStyle} />
                        <input value={row.nom || ''} onChange={e => updateDraft('nom', e.target.value)} placeholder="Nom" style={inputStyle} />
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontWeight: 800, color: '#1e293b' }}>{row.prenom} {row.nom}</div>
                        <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 2 }}>
                          {[row.email, row.telephone].filter(Boolean).join(' · ') || 'Contact non renseigné'}
                        </div>
                      </div>
                    )}
                  </td>

                  {/* Notes */}
                  <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' }}>
                    {isEditing ? (
                      <input value={row.notes || ''} onChange={e => updateDraft('notes', e.target.value)} placeholder="Notes..." style={inputStyle} />
                    ) : (
                      <span style={{ fontSize: 11, color: candidate.notes ? '#475569' : '#94a3b8' }}>
                        {candidate.notes
                          ? candidate.notes.slice(0, 80) + (candidate.notes.length > 80 ? '…' : '')
                          : '—'}
                      </span>
                    )}
                  </td>

                  {/* Poste */}
                  <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' }}>
                    {isEditing
                      ? <input value={row.poste || ''} onChange={e => updateDraft('poste', e.target.value)} placeholder="Poste visé" style={inputStyle} />
                      : row.poste || '—'}
                  </td>

                  {/* Date */}
                  <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' }}>
                    {isEditing
                      ? <input value={row.date_dernier_contact || ''} onChange={e => updateDraft('date_dernier_contact', e.target.value)} placeholder="JJ/MM/AAAA" style={{ ...inputStyle, width: 110 }} />
                      : formatDisplayDate(row.date_dernier_contact)}
                  </td>

                  {/* Statut */}
                  <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' }}>
                    {isEditing ? (
                      <select
                        value={normalizeStatus(row.status)}
                        onChange={e => updateDraft('status', e.target.value)}
                        style={{ ...selectStyle, borderColor: stageColor(normalizeStatus(row.status)) }}
                      >
                        {pipeline.map(s => (
                          <option key={s.value} value={s.value}>{s.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={{
                        background: `${stageColor(row.status)}20`,
                        color: stageColor(row.status),
                        padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                      }}>
                        {statusLabels[row.status] || row.status}
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td style={{ padding: '7px 10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={saveDraft}
                          disabled={!canEdit || isSaving}
                          style={{ ...primaryButton, opacity: isSaving ? .6 : 1 }}
                        >
                          {isSaving ? '⏳' : '✅ Enregistrer'}
                        </button>
                        <button onClick={() => { setEditingId(null); setDraft(null); }} disabled={!canEdit} style={ghostButton}>
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button onClick={e => { e.stopPropagation(); startEdit(candidate); }} disabled={!canEdit} style={ghostButton}>
                          ✏️ Modifier
                        </button>
                        {canDelete && (
                          <button className="admin-delete-action" title="Supprimer" onClick={e => { e.stopPropagation(); deleteCandidate(candidate); }} style={{ ...ghostButton, color: '#dc2626', borderColor: '#fecaca' }}>
                            ×
                          </button>
                        )}
                      </div>
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

// ─── Styles ──────────────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%',
  padding: '4px 7px',
  border: '1px solid #cbd5e1',
  borderRadius: 5,
  fontSize: 11,
  outline: 'none',
  boxSizing: 'border-box',
  background: '#fff',
};

const selectStyle = {
  padding: '5px 8px',
  border: '1px solid #cbd5e1',
  borderRadius: 5,
  fontSize: 12,
  outline: 'none',
  background: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
};

const primaryButton = {
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '5px 10px',
  fontWeight: 800,
  cursor: 'pointer',
  fontSize: 11,
};

const ghostButton = {
  background: '#f8fafc',
  color: '#475569',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '5px 10px',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: 11,
};
