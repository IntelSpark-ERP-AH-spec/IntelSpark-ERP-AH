import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useCurrency } from '../CurrencyContext';
import { useUserDoc } from '../useUserDoc';
import { useAudit } from '../AuditContext';
import { useAppI18n } from '../appI18n';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const HEURES_LEGALES_SEMAINE = 35;
const HEURES_MAX_SEMAINE = 48;
const TAUX_MAJORATION_HS = 25; // +25% pour les 8 premières HS, +50% au-delà

const LS_KEY_SAISIES = 'rh_suivi_temps_saisies';
const LS_KEY_HS_BULLETIN = 'rh_suivi_temps_hs_bulletin';

function todayISO() { return new Date().toISOString().slice(0, 10); }
function weekStartISO(d = new Date()) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  return m.toISOString().slice(0, 10);
}
function formatFR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function startOfISOWeekLabel(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const jours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  return `${jours[date.getDay()]} ${d}/${m}/${y}`;
}

export default function SuiviTemps({ showMsg }) {
  const { hasRole } = useAuth();
  const { formatMoney } = useCurrency();
  const { log: logAudit } = useAudit();
  const t = useAppI18n();
  const canEdit = hasRole('admin', 'rh');
  const canDelete = hasRole('admin');

  const [tab, setTab] = useState('hebdo');

  const [employes, setEmployes] = useState([]);
  const saisiesDoc = useUserDoc(LS_KEY_SAISIES, []);
  const hsDoc      = useUserDoc(LS_KEY_HS_BULLETIN, {});
  const saisies = saisiesDoc.data;
  const hsCumul = hsDoc.data;
  const setSaisies = saisiesDoc.setData;
  const setHsCumul = hsDoc.setData;

  const [semaine, setSemaine]   = useState(weekStartISO());
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [draft, setDraft]       = useState({
    employe_id: '', projet: '',
    heures: { Lundi: 0, Mardi: 0, Mercredi: 0, Jeudi: 0, Vendredi: 0 },
  });

  useEffect(() => {
    setLoading(true);
    api.getEmployes('').catch(() => [])
      .then(emps => setEmployes(Array.isArray(emps) ? emps : []))
      .finally(() => setLoading(false));
  }, []);
  function notify(msg, type = 'success') { showMsg && showMsg(msg, type); }

  function persistSaisies(next) { setSaisies(next); }
  function persistHs(map) { setHsCumul(map); }

  function totalHeures(h) {
    return Object.values(h || {}).reduce((s, v) => s + Number(v || 0), 0);
  }

  function startNew() {
    setEditing(null);
    setDraft({
      employe_id: employes[0]?.id || '',
      projet: '',
      heures: { Lundi: 0, Mardi: 0, Mercredi: 0, Jeudi: 0, Vendredi: 0 },
    });
    setShowForm(true);
  }

  function startEdit(s) {
    setEditing(s);
    setDraft({
      employe_id: s.employe_id || '',
      projet: s.projet || '',
      heures: { ...(s.heures || { Lundi: 0, Mardi: 0, Mercredi: 0, Jeudi: 0, Vendredi: 0 }) },
    });
    setShowForm(true);
  }

  function save() {
    if (!draft.employe_id) return notify('Sélectionnez un salarié', 'error');
    if (!draft.projet.trim()) return notify('Projet / Client obligatoire', 'error');
    const total = totalHeures(draft.heures);
    if (total <= 0) return notify('Au moins une heure saisie', 'error');

    const item = {
      ...draft,
      semaine: editing ? editing.semaine : semaine,
      total,
      id: editing ? editing.id : Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    };
    let next;
    if (editing) next = saisies.map(x => x.id === editing.id ? { ...x, ...item } : x);
    else next = [item, ...saisies];
    persistSaisies(next);
    const emp = employes.find(e => String(e.id) === String(item.employe_id));
    logAudit({
      type: 'Temps de travail',
      client: emp ? `${emp.prenom} ${emp.nom}` : '',
      number: 'TPS-' + String(item.id).slice(-6).toUpperCase(),
      date: item.semaine || new Date().toISOString().slice(0, 10),
      details: `${item.projet} — ${item.total}h`,
      status: 'valide',
      extra: { source_action: editing ? 'edit' : 'create', heures: item.total },
    });
    notify(editing ? 'Saisie mise à jour' : `✅ ${total}h enregistrées`);
    setShowForm(false); setEditing(null);
  }

  async function remove(s) {
    if (!canDelete) return;
    if (!(await systemConfirm('Supprimer cette saisie ?'))) return;
    persistSaisies(saisies.filter(x => x.id !== s.id));
    const emp = employes.find(e => String(e.id) === String(s.employe_id));
    logAudit({
      type: 'Temps de travail',
      client: emp ? `${emp.prenom} ${emp.nom}` : '',
      number: 'TPS-' + String(s.id).slice(-6).toUpperCase(),
      details: `Saisie supprimée (${s.projet})`,
      status: 'annule',
      extra: { source_action: 'delete' },
    });
    notify('Saisie supprimée');
  }

  function recomputeHS() {
    // Cumul mensuel pour chaque salarié (basé sur le mois courant)
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const cum = {};
    saisies.forEach(s => {
      if (!s.semaine || !s.semaine.startsWith(ym)) return;
      const empId = String(s.employe_id);
      const total = Number(s.total || 0);
      const hs = Math.max(0, total - HEURES_LEGALES_SEMAINE);
      cum[empId] = (cum[empId] || 0) + hs;
    });
    persistHs(cum);
  }

  useEffect(() => { if (saisiesDoc.loaded) recomputeHS(); }, [saisies, saisiesDoc.loaded]);

  // ── Calculs pour le tableau hebdo ─────────────────────────────────────────

  const saisiesSemaine = useMemo(() => {
    return saisies.filter(s => s.semaine === semaine);
  }, [saisies, semaine]);

  const totalSemaineParSalarie = useMemo(() => {
    const m = {};
    saisiesSemaine.forEach(s => {
      const id = String(s.employe_id);
      m[id] = (m[id] || 0) + Number(s.total || 0);
    });
    return m;
  }, [saisiesSemaine]);

  const filteredSaisies = saisiesSemaine.filter(s => {
    if (!search.trim()) return true;
    const emp = employes.find(e => String(e.id) === String(s.employe_id));
    const q = search.toLowerCase();
    return [
      emp ? `${emp.prenom} ${emp.nom}` : '',
      s.projet, s.semaine, String(s.total || ''),
    ].join(' ').toLowerCase().includes(q);
  });

  const filteredAlertes = employes
    .map(emp => {
      const total = totalSemaineParSalarie[String(emp.id)] || 0;
      const hs = Math.max(0, total - HEURES_LEGALES_SEMAINE);
      return {
        id: emp.id,
        nom: emp.nom, prenom: emp.prenom, poste: emp.poste,
        normales: Math.min(total, HEURES_LEGALES_SEMAINE),
        supplementaires: hs,
        total,
        depassementLegal: total > HEURES_MAX_SEMAINE,
        moisHsCumul: hsCumul[String(emp.id)] || 0,
      };
    })
    .filter(c => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return [c.nom, c.prenom, c.poste].join(' ').toLowerCase().includes(q);
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 4 }}>Saisie manuelle</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>Utilisez le bouton « + Saisie » ci-dessous pour saisir manuellement le temps de travail.</div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          ['⏱️ Heures saisies cette semaine', filteredSaisies.reduce((s, x) => s + Number(x.total || 0), 0).toFixed(1) + ' h', '#0f766e'],
          ['⚠️ ' + t.statut.depassement, filteredAlertes.filter(a => a.depassementLegal).length, '#dc2626'],
          ['💸 Heures sup ce mois', Object.values(hsCumul).reduce((s, v) => s + v, 0).toFixed(1) + ' h', '#f59e0b'],
        ].map(([label, value, color]) => (
          <div key={label} style={{
            flex: '1 1 200px', background: '#fff', border: `1px solid ${color}40`,
            borderLeft: `4px solid ${color}`, borderRadius: 10, padding: '10px 14px',
          }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {[
          { id: 'hebdo',   label: '🗓️ ' + t.suivi.hebdo },
          { id: 'alertes', label: '⚠️ ' + t.suivi.alertes },
          { id: 'paie',    label: '💵 ' + t.suivi.paie },
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
          placeholder="🔍 Rechercher (salarié, projet)…"
          className="no-print"
          style={{ flex: 1, minWidth: 200, padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none' }} />
        {tab === 'hebdo' && canEdit && (
          <>
            <input type="date" value={semaine} onChange={e => setSemaine(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }} />
            <button onClick={() => setSemaine(weekStartISO())} style={btnGhost}>Cette semaine</button>
            <button onClick={startNew} style={btnAdd}>+ Saisie</button>
          </>
        )}
      </div>

      {tab === 'hebdo' && (
        <HebdoPanel
          saisies={filteredSaisies}
          employes={employes}
          semaine={semaine}
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={startEdit}
          onRemove={remove}
          totalParSalarie={totalSemaineParSalarie}
        />
      )}

      {tab === 'alertes' && (
        <AlertesPanel
          alertes={filteredAlertes}
          hsCumul={hsCumul}
        />
      )}

      {tab === 'paie' && (
        <BulletinHSPanel
          employes={employes}
          hsCumul={hsCumul}
          formatMoney={formatMoney}
        />
      )}

      {showForm && (
        <ModalForm
          draft={draft}
          setDraft={setDraft}
          employes={employes}
          editing={editing}
          semaine={semaine}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSave={save}
        />
      )}
    </div>
  );
}

function HebdoPanel({ saisies, employes, semaine, canEdit, canDelete, onEdit, onRemove, totalParSalarie }) {
  const cols = [
    { key: 'salarie', label: 'Salarié',           align: 'center', w: 180 },
    { key: 'projet',  label: 'Projet / Client',   align: 'center', w: 220 },
    { key: 'lun',     label: 'Lundi',             align: 'center', w: 80 },
    { key: 'mar',     label: 'Mardi',             align: 'center', w: 80 },
    { key: 'mer',     label: 'Mercredi',          align: 'center', w: 80 },
    { key: 'jeu',     label: 'Jeudi',             align: 'center', w: 80 },
    { key: 'ven',     label: 'Vendredi',          align: 'center', w: 80 },
    { key: 'total',   label: 'Total Heures',      align: 'center', w: 110 },
    { key: 'actions', label: '',                  align: 'center', w: 90 },
  ];
  return (
    <div>
      <div style={{
        background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
        padding: '8px 14px', marginBottom: 10, fontSize: 12, color: '#475569',
      }}>
        📅 Semaine du <strong>{startOfISOWeekLabel(semaine)}</strong>
        {' — '}
        <span style={{ color: '#0f766e', fontWeight: 700 }}>
          Plafond légal : {HEURES_LEGALES_SEMAINE}h/semaine · Max : {HEURES_MAX_SEMAINE}h/semaine
        </span>
      </div>

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
            {saisies.length === 0 && (
              <tr><td colSpan={cols.length} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
                Aucune saisie pour cette semaine.
              </td></tr>
            )}
            {saisies.map(s => {
              const emp = employes.find(e => String(e.id) === String(s.employe_id));
              return (
                <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#1e293b', verticalAlign: 'middle' }}>
                    {emp ? `${emp.prenom} ${emp.nom}` : `#${s.employe_id}`}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>{s.projet}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>{s.heures?.Lundi || 0}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>{s.heures?.Mardi || 0}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>{s.heures?.Mercredi || 0}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>{s.heures?.Jeudi || 0}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>{s.heures?.Vendredi || 0}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#0f766e', verticalAlign: 'middle' }}>
                    {Number(s.total).toFixed(1)} h
                  </td>
                  <td className="no-print" style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                    {(canEdit || canDelete) && (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        {canEdit && <button onClick={() => onEdit(s)} style={{
                          background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0',
                          borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                        }}>✏️</button>}
                        {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => onRemove(s)} style={{
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

function AlertesPanel({ alertes }) {
  const t = useAppI18n();
  const cols = [
    { key: 'salarie',   label: 'Salarié',                align: 'center', w: 200 },
    { key: 'normales',  label: 'Heures Normales',        align: 'center', w: 150 },
    { key: 'hs',        label: 'Heures Supplémentaires', align: 'center', w: 170 },
    { key: 'statut',    label: 'Statut',                 align: 'center', w: 220 },
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
              <th key={c.key} style={{
                textAlign: c.align, padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                color: '#475569', fontWeight: 800, fontSize: 11, verticalAlign: 'middle',
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {alertes.length === 0 && (
            <tr><td colSpan={cols.length} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
              Aucun salarié enregistré.
            </td></tr>
          )}
          {alertes.map(a => (
            <tr key={a.id} style={{
              borderBottom: '1px solid #f1f5f9',
              background: a.depassementLegal ? '#fef2f2' : 'transparent',
            }}>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#1e293b', verticalAlign: 'middle' }}>
                {a.prenom} {a.nom}
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>{a.poste || ''}</div>
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 700, color: '#16a34a' }}>
                {a.normales.toFixed(1)} h
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle', fontWeight: 800, color: a.supplementaires > 0 ? '#f59e0b' : '#94a3b8' }}>
                {a.supplementaires.toFixed(1)} h
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                {a.depassementLegal ? (
                  <span style={{
                    background: '#dc2626', color: '#fff', padding: '4px 10px',
                    borderRadius: 999, fontSize: 11, fontWeight: 800,
                  }}>🚨 {t.statut.depassement} ({a.total.toFixed(1)}h &gt; 48h)</span>
                ) : a.supplementaires > 0 ? (
                  <span style={{
                    background: '#fef3c7', color: '#b45309', padding: '4px 10px',
                    borderRadius: 999, fontSize: 11, fontWeight: 800,
                  }}>⚠️ {t('Heures sup à valider')}</span>
                ) : (
                  <span style={{
                    background: '#dcfce7', color: '#16a34a', padding: '4px 10px',
                    borderRadius: 999, fontSize: 11, fontWeight: 800,
                  }}>✅ {t.statut.conforme}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BulletinHSPanel({ employes, hsCumul, formatMoney }) {
  // Estimation de la majoration : salaire_base / 151.67 × HS × 1.25
  const items = employes.map(emp => {
    const hs = hsCumul[String(emp.id)] || 0;
    const salaireBase = Number(emp.salaire_base || 0);
    const tauxHoraire = salaireBase > 0 ? salaireBase / 151.67 : 0;
    const valeurHs = hs * tauxHoraire * (1 + TAUX_MAJORATION_HS / 100);
    return { emp, hs, tauxHoraire, valeurHs };
  }).filter(x => x.hs > 0);

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
      <div style={{ padding: '10px 14px', background: '#fef3c7', borderBottom: '1px solid #fde68a', fontSize: 12, color: '#b45309', fontWeight: 700 }}>
        💸 Passerelle Bulletins de paie — Cumul mensuel des heures supplémentaires à rémunérer
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f8fafc' }}>
            {['Salarié', 'Heures sup', 'Taux horaire', 'Majoration', 'À payer'].map(h => (
              <th key={h} style={{
                textAlign: 'center', padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                color: '#475569', fontWeight: 800, fontSize: 11,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
              Aucune heure supplémentaire cumulée ce mois-ci.
            </td></tr>
          )}
          {items.map(({ emp, hs, tauxHoraire, valeurHs }) => (
            <tr key={emp.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, verticalAlign: 'middle' }}>
                {emp.prenom} {emp.nom}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#f59e0b', verticalAlign: 'middle' }}>
                {hs.toFixed(1)} h
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                {formatMoney(tauxHoraire)}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                +{TAUX_MAJORATION_HS}%
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#16a34a', verticalAlign: 'middle' }}>
                {formatMoney(valeurHs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModalForm({ draft, setDraft, employes, editing, semaine, onCancel, onSave }) {
  const total = Object.values(draft.heures || {}).reduce((s, v) => s + Number(v || 0), 0);
  return (
    <div className="no-print" style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 18, width: 540, maxWidth: '92vw',
        boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
      }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 12, color: '#0f766e' }}>
          {editing ? '✏️ Modifier la saisie' : '➕ Nouvelle saisie horaire'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
            <label style={lbl}>Projet / Client</label>
            <input value={draft.projet} onChange={e => setDraft({ ...draft, projet: e.target.value })}
              placeholder="Ex: Projet Client X" style={{ ...inp, width: '100%' }} />
          </div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>
            ⏱️ Répartition horaire (heures par jour ouvré)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
            {JOURS.map(j => (
              <div key={j}>
                <label style={{ ...lbl, textAlign: 'center' }}>{j.slice(0, 3)}</label>
                <input type="number" step="0.5" min="0" max="24"
                  value={draft.heures?.[j] || 0}
                  onChange={e => setDraft({ ...draft, heures: { ...draft.heures, [j]: Number(e.target.value) || 0 } })}
                  style={{ ...inp, width: '100%', textAlign: 'center' }} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#0f766e', fontWeight: 700, textAlign: 'right' }}>
            ⏱ Total semaine : {total.toFixed(1)} h
          </div>
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
