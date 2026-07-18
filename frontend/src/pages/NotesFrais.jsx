import { useEffect, useState } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useCurrency } from '../CurrencyContext';
import { useUserDoc } from '../useUserDoc';
import { useAudit } from '../AuditContext';
import { useAppI18n } from '../appI18n';

const COMPTES = [
  { code: '625700', label: '🍽️ Frais de réception (resto, repas)', keywords: ['restaurant', 'resto', 'repas', 'dejeuner', 'diner', 'café', 'bistrot', 'uber eat', 'deliveroo'] },
  { code: '625100', label: '🚆 Voyages & déplacements (train/avion/hôtel/taxi)', keywords: ['taxi', 'uber', 'vtc', 'train', 'sncf', 'avion', 'vol', 'hotel', 'hôtel', 'airbnb', 'déplacement', 'deplacement', 'voyage'] },
  { code: '606100', label: '⛽ Carburant & péages', keywords: ['essence', 'carburant', 'gasoil', 'gazole', 'diesel', 'péage', 'peage', 'station'] },
  { code: '606300', label: '📦 Fournitures non stockables', keywords: ['fourniture', 'bureau', 'cartouche', 'encre', 'papier'] },
  { code: '625600', label: '📞 Télécommunications', keywords: ['telephone', 'téléphone', 'mobile', 'forfait', 'internet', 'box'] },
];

const TVA_DEFAUT = 20;

const STATUTS_REMBOURSEMENT = ['En attente', 'Remboursé'];
const STATUT_COLORS = {
  'En attente': '#f59e0b',
  'Remboursé':  '#16a34a',
};

const LS_KEY_FRAIS         = 'rh_notes_frais';
const LS_KEY_COMPTABLE     = 'rh_notes_frais_compta';
const LS_KEY_ECRITURES     = 'rh_notes_frais_ecritures';

function todayISO() { return new Date().toISOString().slice(0, 10); }
function todayFR() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function parseDateFR(s) {
  if (!s) return '';
  const str = String(s).trim();
  let m = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (m) { let [, d, mo, y] = m; if (y.length === 2) y = '20' + y; return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return str.slice(0, 10);
  return '';
}
function formatFR(iso) { if (!iso) return ''; const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; }

function parseAmount(v) {
  if (v === null || v === undefined) return 0;
  const cleaned = String(v).replace(/\s/g, '').replace(/[€$]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function detectCompte(text) {
  const lower = String(text || '').toLowerCase();
  for (const c of COMPTES) {
    if (c.keywords.some(k => lower.includes(k))) return c.code;
  }
  return '625700';
}

function compteInfo(code) {
  return COMPTES.find(c => c.code === code) || { code, label: `Compte ${code}` };
}

export default function NotesFrais({ showMsg }) {
  const { hasRole, user } = useAuth();
  const { formatMoney, moneySymbol } = useCurrency();
  const { log: logAudit } = useAudit();
  const t = useAppI18n();
  const canEdit = hasRole('admin', 'rh', 'comptable');
  const canDelete = hasRole('admin');
  const [tab, setTab] = useState('remboursements');

  const [employes, setEmployes] = useState([]);
  const fraisDoc      = useUserDoc(LS_KEY_FRAIS, []);
  const comptaDoc     = useUserDoc(LS_KEY_COMPTABLE, []);
  const ecrituresDoc  = useUserDoc(LS_KEY_ECRITURES, []);

  const frais = fraisDoc.data;
  const compta = comptaDoc.data;
  const ecritures = ecrituresDoc.data;
  const setFrais = fraisDoc.setData;
  const setCompta = comptaDoc.setData;
  const setEcritures = ecrituresDoc.setData;

  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [draft, setDraft]       = useState({
    employe_id: '', date_depense: todayISO(),
    description: '', montant_ttc: '', tva_rate: TVA_DEFAUT, compte: '625700',
    fournisseur: '', statut: 'En attente',
  });

  useEffect(() => {
    setLoading(true);
    api.getEmployes('').catch(() => [])
      .then(emps => setEmployes(Array.isArray(emps) ? emps : []))
      .finally(() => setLoading(false));
  }, []);

  function notify(msg, type = 'success') { showMsg && showMsg(msg, type); }

  function persist(nextFrais, nextCompta) {
    setFrais(nextFrais);
    if (nextCompta) {
      setCompta(nextCompta);
    }
  }

  function startNew() {
    setEditing(null);
    setDraft({
      employe_id: employes[0]?.id || '',
      date_depense: todayISO(),
      description: '', montant_ttc: '', tva_rate: TVA_DEFAUT, compte: '625700',
      fournisseur: '', statut: 'En attente',
    });
    setShowForm(true);
  }

  function startEdit(f) {
    setEditing(f);
    setDraft({
      employe_id: f.employe_id || '',
      date_depense: f.date_depense || todayISO(),
      description: f.description || '',
      montant_ttc: f.montant_ttc || '',
      tva_rate: f.tva_rate ?? TVA_DEFAUT,
      compte: f.compte || '625700',
      fournisseur: f.fournisseur || '',
      statut: f.statut || 'En attente',
    });
    setShowForm(true);
  }

  function computeTTC(d) {
    const ttc = parseAmount(d.montant_ttc);
    const tva = parseAmount(d.tva_rate);
    const ht = tva > 0 ? +(ttc / (1 + tva / 100)).toFixed(2) : ttc;
    const tvaM = +(ttc - ht).toFixed(2);
    return { ht, tva: tvaM, ttc };
  }

  function save() {
    if (!draft.employe_id) return notify('Sélectionnez un salarié', 'error');
    const ttc = parseAmount(draft.montant_ttc);
    if (ttc <= 0) return notify('Montant TTC obligatoire', 'error');
    if (!draft.description.trim()) return notify('Description obligatoire', 'error');

    const { ht, tva } = computeTTC(draft);
    const item = {
      ...draft,
      montant_ttc: ttc,
      montant_ht: ht,
      montant_tva: tva,
      id: editing ? editing.id : Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    };

    let nextFrais;
    if (editing) nextFrais = frais.map(x => x.id === editing.id ? { ...x, ...item } : x);
    else nextFrais = [item, ...frais];

    const ligneCompta = {
      id: 'CP-' + item.id,
      numero_piece: 'NF-' + item.id.slice(-6).toUpperCase(),
      frais_id: item.id,
      compte: item.compte,
      compte_label: compteInfo(item.compte).label,
      montant_ht: item.montant_ht,
      montant_tva: item.montant_tva,
      montant_ttc: item.montant_ttc,
      statut: item.statut === 'Remboursé' ? 'comptabilise' : 'a_valider',
      date: item.date_depense,
      fournisseur: item.fournisseur,
    };
    const nextCompta = [ligneCompta, ...compta.filter(c => c.frais_id !== item.id)];

    persist(nextFrais, nextCompta);
    const emp = employes.find(e => String(e.id) === String(item.employe_id));
    logAudit({
      type: 'Note de frais',
      client: emp ? `${emp.prenom} ${emp.nom}` : '',
      number: ligneCompta.numero_piece,
      date: item.date_depense,
      details: `${item.fournisseur || 'Frais'} — ${item.description || ''}`,
      status: item.statut === 'Remboursé' ? 'valide' : (item.statut === 'Refusé' ? 'annule' : 'brouillon'),
      totalHT: item.montant_ht,
      totalTVA: item.montant_tva,
      totalTTC: item.montant_ttc,
      currency: moneySymbol(),
      extra: { source_action: editing ? 'edit' : 'create', compte: item.compte, fournisseur: item.fournisseur },
    });
    notify(editing ? 'Note de frais mise à jour' : 'Note de frais enregistrée');
    setShowForm(false); setEditing(null);
  }

  async function remove(f) {
    if (!canDelete) return;
    if (!(await systemConfirm('Supprimer cette note de frais ?'))) return;
    persist(frais.filter(x => x.id !== f.id), compta.filter(c => c.frais_id !== f.id));
    const emp = employes.find(e => String(e.id) === String(f.employe_id));
    logAudit({
      type: 'Note de frais',
      client: emp ? `${emp.prenom} ${emp.nom}` : '',
      number: 'NF-' + String(f.id).slice(-6).toUpperCase(),
      details: 'Note de frais supprimée',
      status: 'annule',
      extra: { source_action: 'delete' },
    });
    notify('Note supprimée');
  }

  function setStatut(f, statut) {
    const nextFrais = frais.map(x => x.id === f.id ? { ...x, statut } : x);
    const nextCompta = compta.map(c => c.frais_id === f.id ? { ...c, statut: statut === 'Remboursé' ? 'comptabilise' : 'a_valider' } : c);
    persist(nextFrais, nextCompta);
    notify(`Statut → ${statut}`);
  }

  function validateCompta(c) {
    const nextCompta = compta.map(x => x.id === c.id ? { ...x, statut: 'comptabilise' } : x);
    setCompta(nextCompta);

    const ecriture = {
      id: 'EC-' + Date.now(),
      date: c.date,
      journal: 'ACH',
      compte_debit:  c.compte,
      compte_credit: '455000',
      montant_ht:  c.montant_ht,
      montant_tva: c.montant_tva,
      montant_ttc: c.montant_ttc,
      libelle:     `Note de frais ${c.numero_piece} — ${c.fournisseur || 'Frais pro'}`,
      fournisseur: c.fournisseur,
      source: 'notes_frais',
      statut: 'brouillon',
    };
    const nextEcritures = [ecriture, ...ecritures];
    setEcritures(nextEcritures);

    const nextFrais = frais.map(f => f.id === c.frais_id ? { ...f, statut: 'Remboursé' } : f);
    setFrais(nextFrais);
    notify(`✅ Écriture envoyée au Journal des Achats (${c.compte} → 455000)`);
  }

  // ─── Rendu ──────────────────────────────────────────────────────────────────

  const filteredFrais = frais.filter(f => {
    if (!search.trim()) return true;
    const emp = employes.find(e => String(e.id) === String(f.employe_id));
    const q = search.toLowerCase();
    return [
      emp ? `${emp.prenom} ${emp.nom}` : '',
      f.description, f.fournisseur, f.compte, f.statut, f.date_depense,
    ].join(' ').toLowerCase().includes(q);
  });

  const filteredCompta = compta.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return [c.numero_piece, c.compte, c.compte_label, c.fournisseur, c.date].join(' ').toLowerCase().includes(q);
  });

  const totalARembourser = filteredFrais.filter(f => f.statut === 'En attente').reduce((s, f) => s + Number(f.montant_ttc || 0), 0);
  const totalRembourse    = filteredFrais.filter(f => f.statut === 'Remboursé').reduce((s, f) => s + Number(f.montant_ttc || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 4 }}>Saisie manuelle</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>Utilisez le bouton « + Note de frais » ci-dessous pour saisir manuellement une note de frais.</div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          ['💸 ' + t.notes.toRefund, totalARembourser, '#f59e0b', true],
          ['✅ ' + t.notes.refunded,  totalRembourse,    '#16a34a', true],
          ['📒 Écritures générées', ecritures.length, '#0f766e', false],
        ].map(([label, value, color, isMoney]) => (
          <div key={label} style={{
            flex: '1 1 160px', background: '#fff', border: `1px solid ${color}40`,
            borderLeft: `4px solid ${color}`, borderRadius: 10, padding: '10px 14px',
          }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color }}>
              {isMoney ? formatMoney(value) : value}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {[
          { id: 'remboursements', label: '💼 Remboursements Salariés' },
          { id: 'compta',         label: '📒 ' + t.notes.compta },
          { id: 'ecritures',      label: '🧾 ' + t.notes.ecritures },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '7px 14px', border: 'none', borderRadius: 8,
            cursor: 'pointer', fontWeight: 700, fontSize: 12,
            background: tab === t.id ? '#0f766e' : '#f1f5f9',
            color: tab === t.id ? '#fff' : '#475569',
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10,
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Rechercher (nom, fournisseur, compte, n° pièce)…"
          className="no-print"
          style={{ flex: 1, minWidth: 200, padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none' }} />
        {canEdit && tab === 'remboursements' && (
          <button onClick={startNew} className="no-print" style={btnAdd}>+ Note de frais</button>
        )}
      </div>

      {tab === 'remboursements' && (
        <RemboursementsPanel
          frais={filteredFrais}
          employes={employes}
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={startEdit}
          onRemove={remove}
          onSetStatut={setStatut}
          formatMoney={formatMoney}
        />
      )}

      {tab === 'compta' && (
        <ComptaPanel
          lignes={filteredCompta}
          canEdit={canEdit}
          onValidate={validateCompta}
          formatMoney={formatMoney}
        />
      )}

      {tab === 'ecritures' && (
        <EcrituresPanel ecritures={ecritures} formatMoney={formatMoney} />
      )}

      {showForm && (
        <ModalForm
          draft={draft}
          setDraft={setDraft}
          employes={employes}
          editing={editing}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSave={save}
          computeTTC={computeTTC}
          formatMoney={formatMoney}
        />
      )}
    </div>
  );
}

function RemboursementsPanel({ frais, employes, canEdit, canDelete, onEdit, onRemove, onSetStatut, formatMoney }) {
  const t = useAppI18n();
  // Largeurs fixes pour alignement propre
  const cols = [
    { key: 'salarie',   label: 'Salarié',          align: 'center', w: 180 },
    { key: 'date',      label: 'Date',             align: 'center', w: 110 },
    { key: 'desc',      label: 'Description / Motif', align: 'center', w: 0 },
    { key: 'fourn',     label: 'Fournisseur',      align: 'center', w: 140 },
    { key: 'ttc',       label: 'Montant TTC',      align: 'center', w: 150 },
    { key: 'statut',    label: 'Statut',           align: 'center', w: 140 },
    { key: 'actions',   label: '',                 align: 'center', w: 90 },
  ];
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, tableLayout: 'auto' }}>
        <colgroup>
          {cols.map(c => <col key={c.key} style={{ width: c.w || undefined }} />)}
        </colgroup>
        <thead>
          <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
            {cols.map(c => (
              <th key={c.key} className={c.key === 'actions' ? 'no-print' : ''} style={{
                textAlign: c.align, padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                color: '#475569', fontWeight: 800, fontSize: 11, verticalAlign: 'middle',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {frais.length === 0 && (
            <tr><td colSpan={cols.length} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
              Aucune note de frais. Saisissez ou déposez un reçu ci-dessus.
            </td></tr>
          )}
          {frais.map(f => {
            const emp = employes.find(e => String(e.id) === String(f.employe_id));
            const color = STATUT_COLORS[f.statut] || '#64748b';
            return (
              <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#1e293b', verticalAlign: 'middle' }}>
                  {emp ? `${emp.prenom} ${emp.nom}` : `#${f.employe_id}`}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{formatFR(f.date_depense)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>{f.description}</td>
                <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 11, color: '#64748b', verticalAlign: 'middle' }}>{f.fournisseur || '—'}</td>
                <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#0f766e', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                  {formatMoney(f.montant_ttc)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                  {canEdit ? (
                    <select value={f.statut} onChange={e => onSetStatut(f, e.target.value)}
                      style={{
                        padding: '3px 8px', borderRadius: 999, border: '1px solid #e2e8f0',
                        background: `${color}20`, color, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                      }}>
                      {STATUTS_REMBOURSEMENT.map(s => <option key={s}>{s}</option>)}
                    </select>
                  ) : (
                    <span style={{
                      background: `${color}20`, color, padding: '3px 10px',
                      borderRadius: 999, fontSize: 11, fontWeight: 800,
                    }}>
                      {f.statut === 'En attente' ? t.statut.enAttente
                       : f.statut === 'Remboursé' ? t.statut.valide
                       : f.statut === 'Refusé' ? t.statut.refuse
                       : f.statut}
                    </span>
                  )}
                </td>
                <td className="no-print" style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                  {(canEdit || canDelete) && (
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      {canEdit &&
                      <button onClick={() => onEdit(f)} style={{
                        background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0',
                        borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                      }}>✏️</button>}
                      {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => onRemove(f)} style={{
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
  );
}

function ComptaPanel({ lignes, canEdit, onValidate, formatMoney }) {
  const cols = [
    { key: 'piece',  label: 'N° Pièce',          align: 'center', w: 130 },
    { key: 'compte', label: 'Compte de charge',  align: 'center', w: 240 },
    { key: 'ht',     label: 'HT',                align: 'center', w: 110 },
    { key: 'tva',    label: 'TVA',               align: 'center', w: 110 },
    { key: 'ttc',    label: 'TTC',               align: 'center', w: 130 },
    { key: 'statut', label: 'Statut',            align: 'center', w: 160 },
    { key: 'actions',label: '',                  align: 'center', w: 110 },
  ];
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <colgroup>
          {cols.map(c => <col key={c.key} style={{ width: c.w }} />)}
        </colgroup>
        <thead>
          <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
            {cols.map(c => (
              <th key={c.key} className={c.key === 'actions' ? 'no-print' : ''} style={{
                textAlign: c.align, padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                color: '#475569', fontWeight: 800, fontSize: 11, verticalAlign: 'middle',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.length === 0 && (
            <tr><td colSpan={cols.length} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
              Aucune écriture à comptabiliser.
            </td></tr>
          )}
          {lignes.map(c => (
            <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 700, color: '#0f766e', verticalAlign: 'middle' }}>
                {c.numero_piece}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                <div style={{ fontWeight: 800, color: '#1e293b' }}>{c.compte}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{c.compte_label}</div>
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{formatMoney(c.montant_ht)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', color: '#dc2626', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{formatMoney(c.montant_tva)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{formatMoney(c.montant_ttc)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                <span style={{
                  background: c.statut === 'comptabilise' ? '#dcfce7' : '#fef3c7',
                  color:      c.statut === 'comptabilise' ? '#16a34a' : '#b45309',
                  padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                }}>
                  {c.statut === 'comptabilise' ? '✅ Comptabilisé' : '⏳ À valider'}
                </span>
              </td>
              <td className="no-print" style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                {canEdit && c.statut !== 'comptabilise' && (
                  <button onClick={() => onValidate(c)} style={{
                    background: '#0f766e', color: '#fff', border: 'none',
                    borderRadius: 5, padding: '5px 10px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                  }}>
                    ✅ Valider
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EcrituresPanel({ ecritures, formatMoney }) {
  const cols = [
    { key: 'date',  label: 'Date',     align: 'center', w: 110 },
    { key: 'jr',    label: 'Journal',  align: 'center', w: 90  },
    { key: 'cd',    label: 'Compte D', align: 'center', w: 100 },
    { key: 'cc',    label: 'Compte C', align: 'center', w: 100 },
    { key: 'lib',   label: 'Libellé',  align: 'center', w: 0   },
    { key: 'ht',    label: 'HT',       align: 'center', w: 110 },
    { key: 'tva',   label: 'TVA',      align: 'center', w: 110 },
    { key: 'ttc',   label: 'TTC',      align: 'center', w: 130 },
  ];
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <colgroup>
          {cols.map(c => <col key={c.key} style={{ width: c.w || undefined }} />)}
        </colgroup>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            {cols.map(c => (
              <th key={c.key} style={{
                textAlign: c.align, padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                color: '#475569', fontWeight: 800, fontSize: 11, verticalAlign: 'middle',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ecritures.length === 0 && (
            <tr><td colSpan={cols.length} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
              Aucune écriture comptable générée.<br />
              <span style={{ fontSize: 11 }}>Cliquez sur « Valider » dans l'onglet Ventilation pour générer une écriture (débit compte de charge, crédit 455000).</span>
            </td></tr>
          )}
          {ecritures.map(e => (
            <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{formatFR(e.date)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, verticalAlign: 'middle' }}>{e.journal}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'monospace', verticalAlign: 'middle' }}>{e.compte_debit}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'monospace', verticalAlign: 'middle' }}>{e.compte_credit}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>{e.libelle}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{formatMoney(e.montant_ht)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', color: '#dc2626', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{formatMoney(e.montant_tva)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{formatMoney(e.montant_ttc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModalForm({ draft, setDraft, employes, editing, onCancel, onSave, computeTTC, formatMoney }) {
  const ttc = computeTTC(draft);
  return (
    <div className="no-print" style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 18, width: 520, maxWidth: '92vw',
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
      }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12, color: '#0f766e' }}>
          {editing ? '✏️ Modifier la note de frais' : '➕ Nouvelle note de frais'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ gridColumn: '1 / 3' }}>
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
            <label style={lbl}>Date de la dépense</label>
            <input type="date" value={draft.date_depense}
              onChange={e => setDraft({ ...draft, date_depense: e.target.value })}
              style={{ ...inp, width: '100%' }} />
          </div>
          <div>
            <label style={lbl}>Fournisseur</label>
            <input value={draft.fournisseur} onChange={e => setDraft({ ...draft, fournisseur: e.target.value })}
              placeholder="Uber, Total, Le Bistrot…" style={{ ...inp, width: '100%' }} />
          </div>
          <div style={{ gridColumn: '1 / 3' }}>
            <label style={lbl}>Description / Motif</label>
            <input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}
              placeholder="Ex: Taxi aéroport CDG" style={{ ...inp, width: '100%' }} />
          </div>
          <div>
            <label style={lbl}>Montant TTC (€)</label>
            <input type="number" step="0.01" value={draft.montant_ttc}
              onChange={e => setDraft({ ...draft, montant_ttc: e.target.value })}
              style={{ ...inp, width: '100%' }} />
          </div>
          <div>
            <label style={lbl}>TVA (%)</label>
            <select value={draft.tva_rate} onChange={e => setDraft({ ...draft, tva_rate: Number(e.target.value) })}
              style={{ ...inp, width: '100%' }}>
              {[0, 5.5, 10, 20].map(r => <option key={r} value={r}>{r}%</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / 3' }}>
            <label style={lbl}>Compte de charge (Plan comptable)</label>
            <select value={draft.compte} onChange={e => setDraft({ ...draft, compte: e.target.value })}
              style={{ ...inp, width: '100%' }}>
              {COMPTES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginTop: 12, padding: 10, background: '#f0fdf4', borderRadius: 6, fontSize: 12, color: '#0f766e', fontWeight: 700 }}>
          💡 Ventilation auto : HT {formatMoney(ttc.ht)} · TVA {formatMoney(ttc.tva)} · TTC {formatMoney(ttc.ttc)}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={btnGhost}>Annuler</button>
          <button onClick={onSave} style={btnPrimary}>{editing ? '💾 Modifier' : '➕ Enregistrer'}</button>
        </div>
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
