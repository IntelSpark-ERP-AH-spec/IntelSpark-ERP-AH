import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { systemConfirm } from '../SystemConfirm';

const FILTERS = [
  ['all', 'Tous'],
  ['unpaid', 'À payer'],
  ['paid', 'Payés'],
];

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return 'À renseigner';
  const [year, month, day] = String(value).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatAmount(value, currency) {
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))} ${currency || 'MAD'}`;
}

export default function Echeancier({ onPaidChange, onDueDateChange }) {
  const { user } = useAuth();
  const canEdit = ['admin', 'commercial'].includes(user?.role);
  const canDelete = user?.role === 'admin';
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  const today = todayISO();

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await api.getEcheancier();
        if (active) setRows(Array.isArray(result) ? result : []);
      } catch (loadError) {
        if (active) setError(loadError.message || 'Échéancier indisponible');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    const timer = window.setInterval(load, 60_000);
    window.addEventListener('echeancier:updated', load);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('echeancier:updated', load); };
  }, []);

  const counts = useMemo(() => ({
    all: rows.length,
    unpaid: rows.filter(row => row.status === 'unpaid').length,
    paid: rows.filter(row => row.status === 'paid').length,
  }), [rows, today]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter(row => {
      const overdue = row.status === 'unpaid' && row.due_date && row.due_date <= today;
      if (filter === 'unpaid' && row.status !== 'unpaid') return false;
      if (filter === 'paid' && row.status !== 'paid') return false;
      if (!query) return true;
      return [row.document_number, row.source_devis_number, row.party_name, row.party_ice]
        .some(value => String(value || '').toLowerCase().includes(query));
    });
  }, [rows, filter, search, today]);

  async function updateRow(row, patch) {
    if (!canEdit || savingId) return;
    setSavingId(row.id);
    setError('');
    try {
      const updated = await api.updateEcheance(row.id, patch);
      setRows(current => current.map(item => item.id === row.id ? updated : item));
      if (Object.hasOwn(patch, 'paid')) onPaidChange?.(row.document_number, patch.paid);
      if (Object.hasOwn(patch, 'due_date') && patch.due_date) onDueDateChange?.(updated);
    } catch (saveError) {
      setError(saveError.message || 'Modification impossible');
    } finally {
      setSavingId(null);
    }
  }

  async function deleteRow(row) {
    if (!canDelete || savingId) return;
    const ok = await systemConfirm(`Supprimer définitivement ${row.document_number} ?`);
    if (!ok) return;
    setSavingId(row.id);
    setError('');
    try {
      await api.deleteEcheance(row.id);
      setRows(current => current.filter(item => item.id !== row.id));
    } catch (deleteError) {
      setError(deleteError.message || 'Suppression impossible');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="schedule-page">
      <header className="schedule-hero">
        <div><span>SUIVI DES RÈGLEMENTS</span><h1>Échéancier</h1><p>Factures clients et fournisseurs. Historique partagé.</p></div>
      </header>

      <div className="schedule-toolbar">
        <div className="schedule-filters">
          {FILTERS.map(([value, label]) => <button type="button" key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}<b>{counts[value]}</b></button>)}
        </div>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Facture, devis, client, ICE…" aria-label="Rechercher échéance" />
      </div>

      {error && <div className="schedule-error" role="alert">{error}</div>}
      {!canEdit && <div className="schedule-readonly">Consultation comptable. Notifications et modifications désactivées.</div>}

      <div className="schedule-table-wrap">
        <table>
          <thead><tr><th>Facture</th><th>Devis source</th><th>Client / Fournisseur</th><th>Date facture</th><th>Échéance</th><th>Montant</th><th>Statut</th><th>Payé</th><th></th></tr></thead>
          <tbody>
            {visibleRows.map(row => {
              const overdue = row.status === 'unpaid' && row.due_date && row.due_date <= today;
              return (
                <tr key={row.id} className={overdue ? 'is-overdue' : row.status === 'paid' ? 'is-paid' : ''}>
                  <td><strong>{row.document_number}</strong><small>{row.party_type === 'fournisseur' ? 'Achat' : 'Vente'}</small></td>
                  <td>{row.source_devis_number || '—'}</td>
                  <td><strong>{row.party_name}</strong><small>{row.party_ice ? `ICE ${row.party_ice}` : row.party_type}</small></td>
                  <td>{formatDate(row.invoice_date)}</td>
                  <td>{canEdit ? <input type="date" value={row.due_date || ''} disabled={savingId === row.id || row.status === 'paid'} onChange={event => updateRow(row, { due_date: event.target.value || null })} aria-label={`Échéance ${row.document_number}`} /> : formatDate(row.due_date)}</td>
                  <td><strong>{formatAmount(row.amount, row.currency)}</strong></td>
                  <td><span className={`schedule-status ${row.status === 'paid' ? 'is-paid' : overdue ? 'is-overdue' : 'is-pending'}`}>{row.status === 'paid' ? 'Payé' : overdue ? 'En retard' : row.due_date ? 'À payer' : 'Date requise'}</span>{row.paid_at && <small>{formatDate(String(row.paid_at).slice(0, 10))}</small>}</td>
                  <td>{canEdit ? <label className="schedule-paid-check"><input type="checkbox" checked={row.status === 'paid'} disabled={savingId === row.id} onChange={event => updateRow(row, { paid: event.target.checked })} /><span>Payé</span></label> : row.status === 'paid' ? '✓' : '—'}</td>
                  <td>{canDelete && <button type="button" className="admin-delete-action" title="Supprimer" onClick={() => deleteRow(row)} disabled={savingId === row.id} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, width: 27, height: 27, padding: 0, fontWeight: 900, cursor: 'pointer' }}>{savingId === row.id ? '…' : '×'}</button>}</td>
                </tr>
              );
            })}
            {!loading && visibleRows.length === 0 && <tr><td colSpan="9" className="schedule-empty">Aucune échéance correspondante.</td></tr>}
            {loading && <tr><td colSpan="9" className="schedule-empty">Chargement échéancier…</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
