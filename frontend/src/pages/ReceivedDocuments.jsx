import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useWS } from '../WebSocketContext';
import { systemConfirm } from '../SystemConfirm';
import './ReceivedDocuments.css';

const TYPES = [
  { id: 'ALL', label: 'Tous' },
  { id: 'DEV', label: 'Devis' },
  { id: 'BL', label: 'BL' },
  { id: 'BC', label: 'BC' },
  { id: 'FACT', label: 'Factures' },
  { id: 'AVOIR', label: 'Avoirs' },
];

const TYPE_LABELS = { DEV: 'Devis', BL: 'Bon de livraison', BC: 'Bon de commande', FACT: 'Facture', AVOIR: 'Avoir' };

function dateTime(value) {
  if (!value) return '';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('fr-MA', { dateStyle: 'short', timeStyle: 'short' });
}

function amount(value, currency = 'MAD') {
  return `${Number(value || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function itemValue(item, ...keys) {
  for (const key of keys) if (item?.[key] != null) return item[key];
  return '';
}

export default function ReceivedDocuments() {
  const { user } = useAuth();
  const { lastChatMessage, lastDeletedMessage } = useWS();
  const canDelete = user?.role === 'admin';
  const [messages, setMessages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [type, setType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const rows = await api.getReceivedDocuments();
      const next = Array.isArray(rows) ? rows : [];
      setMessages(next);
      setSelectedId(current => next.some(message => message.id === current) ? current : next[0]?.id || null);
    } catch (requestError) {
      setError(requestError.message || 'Chargement impossible');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!lastChatMessage?.document || !lastChatMessage?.doc_type || lastChatMessage.sender_id === user?.id) return;
    setMessages(current => [lastChatMessage, ...current.filter(message => message.id !== lastChatMessage.id)]);
    setSelectedId(lastChatMessage.id);
  }, [lastChatMessage, user?.id]);

  useEffect(() => {
    if (!lastDeletedMessage?.id) return;
    setMessages(current => current.filter(message => message.id !== lastDeletedMessage.id));
    setSelectedId(current => current === lastDeletedMessage.id ? null : current);
  }, [lastDeletedMessage]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('fr');
    return messages.filter(message => {
      if (type !== 'ALL' && message.doc_type !== type) return false;
      if (!query) return true;
      return [message.document?.number, message.document?.client, message.sender_full_name, message.sender_name]
        .some(value => String(value || '').toLocaleLowerCase('fr').includes(query));
    });
  }, [messages, search, type]);

  const selected = filtered.find(message => message.id === selectedId) || filtered[0] || null;
  const document = selected?.document;
  const totals = document?.totals || {};
  const currency = document?.currency || 'MAD';

  const selectMessage = useCallback((message) => {
    setSelectedId(message.id);
    if (!message.read) {
      api.markMessageRead(message.id).catch(() => {});
      setMessages(current => current.map(item => item.id === message.id ? { ...item, read: 1 } : item));
    }
  }, []);

  const deleteMessage = useCallback(async (message) => {
    if (!canDelete) return;
    const ok = await systemConfirm(`Supprimer définitivement ${message.document?.number || 'ce document'} ?`);
    if (!ok) return;
    try {
      await api.deleteMessage(message.id);
      setMessages(current => current.filter(item => item.id !== message.id));
      setSelectedId(current => (current === message.id ? null : current));
    } catch (deleteError) {
      setError(deleteError.message || 'Suppression impossible');
    }
  }, [canDelete]);

  return (
    <section className="received-documents-page">
      <header className="received-documents-header">
        <div><span>MESSAGERIE</span><h2>Documents reçus</h2><p>Dernier document reçu affiché automatiquement.</p></div>
        <button type="button" onClick={refresh} disabled={loading}>{loading ? 'Chargement...' : 'Actualiser'}</button>
      </header>

      <div className="received-documents-toolbar">
        <div className="received-documents-types" role="tablist" aria-label="Types documents">
          {TYPES.map(item => {
            const count = item.id === 'ALL' ? messages.length : messages.filter(message => message.doc_type === item.id).length;
            return <button key={item.id} type="button" role="tab" aria-selected={type === item.id} className={type === item.id ? 'active' : ''} onClick={() => setType(item.id)}>{item.label}<small>{count}</small></button>;
          })}
        </div>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher numéro, client, expéditeur..." />
      </div>

      {error && <div className="received-documents-error">{error}<button type="button" onClick={refresh}>Réessayer</button></div>}

      <div className="received-documents-layout">
        <aside className="received-documents-list" aria-label="Documents reçus">
          {loading && messages.length === 0 && Array.from({ length: 4 }, (_, index) => <div className="received-document-skeleton" key={index} />)}
          {!loading && filtered.length === 0 && <div className="received-documents-empty"><strong>Aucun document reçu</strong><span>Documents envoyés apparaîtront ici.</span></div>}
          {filtered.map(message => (
            <button key={message.id} type="button" className={selected?.id === message.id ? 'active' : ''} onClick={() => selectMessage(message)}>
              <i>{message.doc_type}</i>
              <span><strong>{message.document?.number || message.doc_id}</strong><small>{message.document?.client || 'Client non renseigné'}</small><small>Par {message.sender_full_name || message.sender_name}</small></span>
              <time>{dateTime(message.created_at)}</time>
              {!message.read && <b>Nouveau</b>}
            </button>
          ))}
        </aside>

        <article className="received-document-preview">
          {!document ? (
            <div className="received-document-placeholder"><strong>Sélectionnez un document</strong><span>Aperçu complet disponible ici.</span></div>
          ) : (
            <>
              <header>
                <div><span>{TYPE_LABELS[selected.doc_type] || selected.doc_type}</span><h3>{document.number}</h3><p>Envoyé par {selected.sender_full_name || selected.sender_name} · {dateTime(selected.created_at)}</p></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <em>{document.status || 'reçu'}</em>
                  {canDelete && <button type="button" className="admin-delete-action" title="Supprimer" onClick={() => deleteMessage(selected)} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, width: 27, height: 27, padding: 0, fontWeight: 900, cursor: 'pointer' }}>×</button>}
                </div>
              </header>
              <div className="received-document-meta">
                <div><span>Client</span><strong>{document.client || 'Non renseigné'}</strong></div>
                <div><span>Date document</span><strong>{document.date || 'Non renseignée'}</strong></div>
                <div><span>Devise</span><strong>{currency}</strong></div>
              </div>
              <div className="received-document-table-wrap">
                <table>
                  <thead><tr><th>Référence</th><th>Désignation</th><th>Quantité</th><th>Prix HT</th><th>Remise</th><th>Total HT</th></tr></thead>
                  <tbody>
                    {(document.items || []).map((item, index) => {
                      const qty = Number(itemValue(item, 'qty', 'quantite') || 0);
                      const price = Number(itemValue(item, 'priceHT', 'prix_ht', 'price') || 0);
                      const discount = Number(itemValue(item, 'discount', 'remise') || 0);
                      const total = qty * price * (1 - discount / 100);
                      return <tr key={`${itemValue(item, 'ref', 'reference')}-${index}`}><td>{itemValue(item, 'ref', 'reference') || '-'}</td><td>{itemValue(item, 'name', 'designation') || '-'}</td><td>{qty}</td><td>{amount(price, currency)}</td><td>{discount}%</td><td>{amount(total, currency)}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
              <footer>
                <div><span>Total HT</span><strong>{amount(totals.ht ?? document.totalHT, currency)}</strong></div>
                <div><span>TVA</span><strong>{amount(totals.tva ?? document.totalTVA, currency)}</strong></div>
                <div className="total"><span>Total TTC</span><strong>{amount(totals.ttc ?? document.totalTTC, currency)}</strong></div>
              </footer>
            </>
          )}
        </article>
      </div>
    </section>
  );
}
