import { Fragment, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useWS } from '../WebSocketContext';
import { api } from '../api';
import { playNotifSound } from '../notifSound';
import { useLanguage } from '../LanguageContext';
import { useT } from '../appI18n';
import { systemConfirm } from '../SystemConfirm';
import '../CommunicationDrawer.css';

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#14b8a6'];
const DOCUMENT_TYPES = [
  { type: 'DEV', label: 'Devis', mark: 'DV', color: '#2563eb', tint: '#eff6ff' },
  { type: 'BL', label: 'Bons livraison', mark: 'BL', color: '#0891b2', tint: '#ecfeff' },
  { type: 'BC', label: 'Bons commande', mark: 'BC', color: '#d97706', tint: '#fffbeb' },
  { type: 'FACT', label: 'Factures', mark: 'FA', color: '#059669', tint: '#ecfdf5' },
  { type: 'AVOIR', label: 'Avoirs', mark: 'AV', color: '#7c3aed', tint: '#f5f3ff' },
];
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function documentTypeMeta(type) {
  return DOCUMENT_TYPES.find(item => item.type === String(type || '').toUpperCase()) || DOCUMENT_TYPES[0];
}

function hashColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

function initials(name) {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.floor((today - msg) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  if (diff < 7) return d.toLocaleDateString('fr-FR', { weekday: 'long' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

function formatFileSize(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} o`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function CommunicationDrawer({ isOpen, onToggle, onClose, user, savedDocs = [], onOpenDocument, hideToggle = false, initialTab = 'msgs' }) {
  const t = useT();
  const canDelete = user?.role === 'admin';
  const { language } = useLanguage();
  const locale = ({ fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', zh: 'zh-CN' })[language] || 'fr-FR';
  const { lastChatMessage, lastDeletedMessage, onlineUsers } = useWS();
  const [tab, setTab] = useState('msgs');
  const [convos, setConvos] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [users, setUsers] = useState([]);
  const [view, setView] = useState('list');
  const [target, setTarget] = useState(null);
  const [text, setText] = useState('');
  const [doc, setDoc] = useState(null);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const [docPickerType, setDocPickerType] = useState(null);
  const [docSearch, setDocSearch] = useState('');
  const [sendError, setSendError] = useState('');
  const [pdfFile, setPdfFile] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState(() => new Set());
  const [deletingMessages, setDeletingMessages] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(0);
  const [sending, setSending] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState('');
  const [mailUsers, setMailUsers] = useState([]);
  const [mailHistory, setMailHistory] = useState([]);
  const [mailView, setMailView] = useState('compose');
  const [selectedMail, setSelectedMail] = useState(null);
  const [smtpConfigured, setSmtpConfigured] = useState(null);
  const [mailSyncing, setMailSyncing] = useState(false);
  const [mailDeleting, setMailDeleting] = useState(false);
  const [mailDeleteError, setMailDeleteError] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const mailListRef = useRef(null);
  const mailScrollPos = useRef(0);

  const onlineIds = useMemo(() => new Set(onlineUsers.map(u => u.userId)), [onlineUsers]);
  const availableDocuments = useMemo(
    () => savedDocs.filter(item => DOCUMENT_TYPES.some(type => type.type === String(item?.type || '').toUpperCase()) && Array.isArray(item?.items)),
    [savedDocs]
  );
  const filteredDocuments = useMemo(() => {
    const query = docSearch.trim().toLocaleLowerCase('fr');
    return availableDocuments.filter(item => {
      if (docPickerType && docPickerType !== 'ALL' && String(item.type).toUpperCase() !== docPickerType) return false;
      if (!query) return true;
      return [item.number, item.client, item.date].some(value => String(value || '').toLocaleLowerCase('fr').includes(query));
    });
  }, [availableDocuments, docPickerType, docSearch]);

  const refresh = useCallback(() => {
    api.getUnreadCount().then(d => setUnread(d.count || 0)).catch(() => {});
    api.getConversations().then(setConvos).catch(() => {});
    api.getMessageUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => { if (isOpen) refresh(); }, [isOpen, refresh]);
  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setTab(initialTab === 'mail' ? 'mail' : 'msgs');
      if (initialTab === 'mail') setMailView('received');
    });
    return () => { active = false; };
  }, [isOpen, initialTab]);

  const syncMail = useCallback(async () => {
    setMailSyncing(true);
    try { await api.syncMail(); } catch (error) { setEmailStatus(error.message || 'Synchronisation impossible'); }
    try { setMailHistory(await api.getMailHistory()); } catch {}
    setMailSyncing(false);
  }, []);

  useEffect(() => { if (isOpen && tab === 'mail') { api.getMailUsers().then(setMailUsers).catch(() => {}); api.getMailHistory().then(setMailHistory).catch(() => {}); api.getMySmtp().then(d => { const ok = Boolean(d.smtp_configured); setSmtpConfigured(ok); if (ok) syncMail(); }).catch(() => setSmtpConfigured(false)); } }, [isOpen, tab, syncMail]);

  const sendEmail = useCallback(async () => {
    if (!emailTo.trim() || emailSending) return;
    setEmailSending(true);
    setEmailStatus('');
    try {
      await api.sendEmail({ to: emailTo.trim(), subject: emailSubject.trim(), body: emailBody.trim() });
      setEmailStatus('ok');
      api.getMailHistory().then(setMailHistory).catch(() => {});
    } catch (e) {
      setEmailStatus(e.message || 'Erreur');
    }
    setEmailSending(false);
  }, [emailTo, emailSubject, emailBody, emailSending]);

  const openMail = useCallback((mail) => {
    if (mailListRef.current) mailScrollPos.current = mailListRef.current.scrollTop;
    const opened = { ...mail, is_read: 1 };
    setSelectedMail(opened);
    setMailHistory(previous => previous.map(item => item.id === mail.id ? opened : item));
    if (mail.direction === 'received' && !mail.is_read) api.markMailRead(mail.id).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedMail && mailListRef.current && mailScrollPos.current > 0) {
      requestAnimationFrame(() => { if (mailListRef.current) mailListRef.current.scrollTop = mailScrollPos.current; });
    }
  }, [selectedMail]);

  const replyToMail = useCallback((mail) => {
    const recipient = mail.sender_email || mail.correspondent || '';
    setEmailTo(recipient);
    setEmailSubject(/^re\s*:/i.test(mail.subject || '') ? mail.subject : `Re: ${mail.subject || ''}`);
    setEmailBody('');
    setSelectedMail(null);
    setMailView('compose');
  }, []);

  const deleteMail = useCallback(async (mail) => {
    if (!canDelete || !mail || mailDeleting) return;
    const label = mail.direction === 'received'
      ? `supprimer le mail reçu "${mail.subject || 'Sans sujet'}" ?`
      : `supprimer le mail envoyé "${mail.subject || 'Sans sujet'}" ?`;
    if (!(await systemConfirm(label))) return;
    setMailDeleting(true);
    setMailDeleteError('');
    try {
      await api.deleteMail(mail.id);
      setMailHistory(previous => previous.filter(item => item.id !== mail.id));
      if (selectedMail?.id === mail.id) setSelectedMail(null);
    } catch (error) {
      setMailDeleteError(error.message || 'Suppression impossible');
    } finally {
      setMailDeleting(false);
    }
  }, [canDelete, mailDeleting, selectedMail]);

  useEffect(() => {
    if (view === 'chat' && target && isOpen) {
      const params = target.isRole
        ? `?with_role=${target.role}`
        : `?with_user=${target.id}`;
      const searchParam = search ? `${params.includes('?') ? '&' : '?'}search=${encodeURIComponent(search)}` : '';
      api.getMessages(`${params}${searchParam}`)
        .then(setMsgs).catch(() => {});
      if (!target.isRole) {
        api.readConversation(target.id).then(() => {
          setUnread(prev => Math.max(0, prev - (target.unread_count || 0)));
          setConvos(prev => prev.map(c => c.other_id === target.id ? { ...c, unread_count: 0 } : c));
        }).catch(() => {});
      }
    }
  }, [view, target, search, isOpen]);

  useEffect(() => {
    if (lastChatMessage && isOpen) {
      setMsgs(prev => prev.find(m => m.id === lastChatMessage.id) ? prev : [...prev, lastChatMessage]);
      if (String(lastChatMessage.sender_id) !== String(user?.id)) playNotifSound();
      const isCurrent = target && (
        String(lastChatMessage.sender_id) === String(target.id)
        || String(lastChatMessage.recipient_id) === String(target.id)
      );
      if (!isCurrent) {
        refresh();
      }
    }
  }, [lastChatMessage, isOpen, user?.id, target, refresh]);

  useEffect(() => {
    if (lastDeletedMessage) {
      setMsgs(prev => prev.filter(m => m.id !== lastDeletedMessage.id));
      setSelectedMessageIds(previous => {
        const next = new Set(previous);
        next.delete(lastDeletedMessage.id);
        return next;
      });
    }
  }, [lastDeletedMessage]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  const send = useCallback(async () => {
    if ((!text.trim() && !doc && !pdfFile) || sending || !target) return;
    setSending(true);
    setSendError('');
    try {
      let m;
      if (pdfFile) {
        m = await api.sendPdfMessage({
          recipient_id: target.isRole ? null : target.id,
          recipient_role: target.isRole ? target.role : null,
          content: text.trim(),
          file: pdfFile,
        });
      } else {
        const body = { content: text.trim() };
        if (target.isRole) {
          body.recipient_role = target.role;
        } else {
          body.recipient_id = target.id;
        }
        if (doc) {
          const selectedType = String(doc.type || '').toUpperCase();
          body.doc_type = selectedType;
          body.doc_id = String(doc.id || doc.number);
          body.document = { ...doc, type: selectedType };
        }
        m = await api.sendMessage(body);
      }
      setMsgs(prev => [...prev, m]);
      setText('');
      setDoc(null);
      setPdfFile(null);
      if (pdfInputRef.current) pdfInputRef.current.value = '';
      setShowDocPicker(false);
      setDocPickerType(null);
      setDocSearch('');
      refresh();
    } catch (e) {
      setSendError(e.message || 'Envoi impossible');
    }
    setSending(false);
  }, [text, sending, target, doc, pdfFile, refresh]);

  const onKey = useCallback(e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }, [send]);

  const selectPdf = useCallback((event) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setSendError('Choisissez uniquement un fichier PDF.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setSendError('PDF trop volumineux. Maximum 10 Mo.');
      event.target.value = '';
      return;
    }
    setSendError('');
    setPdfFile(file);
    setDoc(null);
    setShowDocPicker(false);
  }, []);

  const toggleMessageSelection = useCallback((messageId) => {
    setSelectedMessageIds(previous => {
      const next = new Set(previous);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const stopSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
  }, []);

  const requestDeleteSelectedMessages = () => {
    if (!canDelete) return;
    const ids = [...selectedMessageIds];
    if (!ids.length || deletingMessages) return;
    setDeleteError('');
    setDeleteRequest({ ids, mode: 'selection' });
  };

  const requestDeleteMessage = (messageId) => {
    if (!canDelete) return;
    if (!messageId || deletingMessages) return;
    setDeleteError('');
    setDeleteRequest({ ids: [messageId], mode: 'single' });
  };

  const confirmDeleteMessages = useCallback(async () => {
    if (!canDelete || !deleteRequest?.ids?.length || deletingMessages) return;
    const requestedIds = deleteRequest.ids.map(id => String(id));
    setDeletingMessages(true);
    setDeleteError('');
    try {
      let deletedIds;
      if (deleteRequest.mode === 'single') {
        await api.deleteMessage(deleteRequest.ids[0]);
        deletedIds = new Set(requestedIds);
      } else {
        const result = await api.deleteMessages(deleteRequest.ids);
        if (!result?.success) throw new Error('Suppression impossible. Réessayez.');
        deletedIds = new Set(requestedIds);
      }
      setMsgs(previous => previous.filter(message => !deletedIds.has(String(message.id))));
      setDeleteRequest(null);
      stopSelection();
      refresh();
    } catch (error) {
      setDeleteError(error.message || 'Suppression impossible');
    } finally {
      setDeletingMessages(false);
    }
  }, [canDelete, deleteRequest, deletingMessages, refresh, stopSelection]);

  const openChat = useCallback((convo) => {
    const isRole = convo.conv_type === 'role';
    setTarget({ id: isRole ? null : convo.other_id, name: convo.other_full_name || convo.other_username, role: convo.other_role, unread_count: convo.unread_count, isRole });
    setView('chat');
    setSearch('');
    setMsgs([]);
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
    setPdfFile(null);
  }, []);

  const startNew = useCallback(() => { setView('pick'); setTarget(null); setMsgs([]); setSearch(''); stopSelection(); setPdfFile(null); }, [stopSelection]);
  const goBack = useCallback(() => { setView('list'); setTarget(null); setMsgs([]); setSearch(''); stopSelection(); setPdfFile(null); }, [stopSelection]);

  const pickUser = useCallback((u) => {
    setTarget({ id: u.id, name: u.full_name || u.username, role: u.role, unread_count: 0 });
    setView('chat');
    setMsgs([]);
    stopSelection();
    setPdfFile(null);
  }, [stopSelection]);

  return (
    <>
      <div className={`cd-overlay${isOpen ? ' open' : ''}`} onClick={onClose} />
      {!isOpen && !hideToggle && (
        <button className="cd-toggle" onClick={onToggle}>
          &#128172;
          {unread > 0 && <span className="cd-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      )}

      <aside className={`cd-drawer${isOpen ? ' open' : ''}${selectedMail ? ' mail-open' : ''}`}>
        {/* HEADER */}
        <div className="cd-header">
          {view === 'chat' && <button className="cd-back" onClick={goBack}>&#8592;</button>}
          {view === 'pick' && <button className="cd-back" onClick={goBack}>&#8592;</button>}
          <h3>{view === 'chat' && target ? target.name : view === 'pick' ? 'Nouveau message' : 'Communication'}</h3>
          <button className="cd-close" onClick={onClose}>&times;</button>
        </div>

        {/* TABS */}
        <div className="cd-tabs">
          <button className={`cd-tab${tab === 'msgs' ? ' a' : ''}`} onClick={() => setTab('msgs')}>Messages</button>
          <button className={`cd-tab${tab === 'mail' ? ' a' : ''}`} onClick={() => setTab('mail')}>Email</button>
        </div>

        <div className="cd-body">
          {tab === 'msgs' ? (
            <>
              {/* ===== LIST ===== */}
              {view === 'list' && (
                <div className="cd-list">
                  <div className="cd-list-top">
                    <button className="cd-new-btn" onClick={startNew}>+ Nouveau message</button>
                  </div>
                  {convos.length === 0 && (
                    <div className="cd-empty">
                      <div style={{ fontSize: 36 }}>&#128172;</div>
                      <p>Aucune conversation</p>
                      <p style={{ fontSize: 12, opacity: 0.7 }}>Cliquez sur "+ Nouveau message"</p>
                    </div>
                  )}
                  {convos.map(c => (
                    <div key={`${c.conv_type || 'user'}:${c.other_id || c.recipient_role}`} className="cd-row" onClick={() => openChat(c)}>
                      <div className="cd-av" style={{ background: hashColor(c.other_full_name || c.other_username) }}>
                        {initials(c.other_full_name || c.other_username)}
                        {onlineIds.has(c.other_id) && <span className="cd-dot" />}
                      </div>
                      <div className="cd-row-info">
                        <div className="cd-row-top">
                          <span className="cd-name">{c.other_full_name || c.other_username}</span>
                          <span className="cd-time">{fmtTime(c.created_at)}</span>
                        </div>
                        <div className="cd-row-bot">
                          <span className="cd-role">{c.other_role}</span>
                          <span className="cd-snippet">{c.content ? (c.content.length > 40 ? c.content.slice(0, 40) + '...' : c.content) : ''}</span>
                        </div>
                      </div>
                      {c.unread_count > 0 && <span className="cd-unread">{c.unread_count}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* ===== PICK RECIPIENT ===== */}
              {view === 'pick' && (
                <div className="cd-list">
                  <div className="cd-pick-label">Par rôle</div>
                  {['magasinier','commercial','comptable','rh','admin'].map(r => (
                    <div key={r} className="cd-row" onClick={() => {
                      setTarget({ id: null, name: `Tous les ${r}s`, role: r, unread_count: 0, isRole: true });
                      setView('chat');
                      setMsgs([]);
                    }}>
                      <div className="cd-av" style={{ background: hashColor(r) }}>{initials(r)}</div>
                      <div className="cd-row-info"><span className="cd-name">Tous les {r}s</span></div>
                      <span className="cd-arrow">&#8250;</span>
                    </div>
                  ))}
                  <div className="cd-pick-label">Par utilisateur</div>
                  {users.map(u => (
                    <div key={u.id} className="cd-row" onClick={() => pickUser(u)}>
                      <div className="cd-av" style={{ background: hashColor(u.full_name || u.username) }}>
                        {initials(u.full_name || u.username)}
                        {onlineIds.has(u.id) && <span className="cd-dot" />}
                      </div>
                      <div className="cd-row-info">
                        <span className="cd-name">{u.full_name || u.username}</span>
                        <span className="cd-role">{u.role}</span>
                      </div>
                      <span className="cd-arrow">&#8250;</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ===== CHAT ===== */}
              {view === 'chat' && target && (
                <>
                  {/* search bar */}
                  <div className="cd-search">
                    <input type="text" placeholder="Rechercher..." value={search} onChange={e => setSearch(e.target.value)} />
                  </div>

                  {/* messages */}
                  <div className="cd-msgs">
                    {msgs.length === 0 && (
                      <div className="cd-empty" style={{ padding: 20 }}><p style={{ fontSize: 13 }}>Aucun message</p></div>
                    )}
                    {(() => {
                      let last = '';
                      return msgs.map(m => {
                        const isMe = String(m.sender_id) === String(user?.id);
                        const senderLabel = m.sender_role || m.sender_full_name || m.sender_name || 'Utilisateur';
                        const d = fmtDate(m.created_at);
                        const showD = d !== last;
                        last = d;
                        return (
                          <Fragment key={m.id}>
                            {showD && <div className="cd-date"><span>{d}</span></div>}
                            <div
                              className={`cd-message-item${selectionMode ? ' selectable' : ''}${selectedMessageIds.has(m.id) ? ' selected' : ''}`}
                              onClick={selectionMode ? () => toggleMessageSelection(m.id) : undefined}
                              onKeyDown={selectionMode ? event => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  toggleMessageSelection(m.id);
                                }
                              } : undefined}
                              role={selectionMode ? 'checkbox' : undefined}
                              aria-checked={selectionMode ? selectedMessageIds.has(m.id) : undefined}
                              aria-label={selectionMode ? `${selectedMessageIds.has(m.id) ? 'Retirer' : 'Sélectionner'} le message de ${senderLabel}` : undefined}
                              tabIndex={selectionMode ? 0 : undefined}
                            >
                              <div className="cd-message-line">
                                {selectionMode && (
                                  <span className="cd-message-check" aria-hidden="true"><span /></span>
                                )}
                                <div className={`cd-msg ${isMe ? 'me' : 'received'}`}>
                                  {!isMe && <div className="cd-av-s" style={{ background: hashColor(m.sender_full_name || m.sender_name) }}>{initials(m.sender_full_name || m.sender_name)}</div>}
                                  <div className="cd-bubble">
                                    <span className="cd-sender">{senderLabel}</span>
                                    {m.content && <div className="cd-text" data-time={fmtTime(m.created_at)}>{m.content}{isMe && <span className="cd-checks">✓✓</span>}</div>}
                                    {m.doc_type === 'PDF' ? (
                                      <button
                                        type="button"
                                        className="cd-attachment cd-pdf-attachment"
                                        onClick={() => api.downloadMessagePdf(m.id, m.document?.name).catch(error => setSendError(error.message))}
                                      >
                                        <span className="cd-pdf-mark">PDF</span>
                                        <span><strong>{m.document?.name || 'Document PDF'}</strong><small>{formatFileSize(m.document?.size)}</small></span>
                                        <b>Télécharger</b>
                                      </button>
                                    ) : m.doc_type ? (
                                    <button
                                      type="button"
                                      className="cd-attachment"
                                      onClick={() => m.document && onOpenDocument?.(m.document)}
                                      disabled={!m.document || !onOpenDocument}
                                    >
                                      <span>&#128196;</span>
                                      <span><strong>{m.document?.number || m.doc_id || m.doc_type}</strong><small>{m.document?.client || `${documentTypeMeta(m.doc_type).label} joint`}</small></span>
                                      {m.document?.totals?.ttc != null && <b>{Number(m.document.totals.ttc).toLocaleString('fr-MA')} {m.document.currency || 'MAD'}</b>}
                                    </button>
                                    ) : null}
                                    {canDelete && !selectionMode && <button className="cd-delete-msg admin-delete-action" title="Supprimer" onClick={() => requestDeleteMessage(m.id)}>×</button>}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </Fragment>
                        );
                      });
                    })()}
                    <div ref={endRef} />
                  </div>

                  {/* selection toolbar or message input */}
                  {selectionMode ? (
                    <div className="cd-selection-bar" role="toolbar" aria-label="Sélection des messages">
                      <button type="button" className="cd-selection-cancel" onClick={stopSelection}>Annuler</button>
                      <div className="cd-selection-status" aria-live="polite">
                        <strong>{selectedMessageIds.size}</strong>
                        <span>{selectedMessageIds.size > 1 ? 'messages sélectionnés' : 'message sélectionné'}</span>
                      </div>
                      <button
                        type="button"
                        className="cd-selection-delete"
                        onClick={requestDeleteSelectedMessages}
                        disabled={!selectedMessageIds.size || deletingMessages}
                      >
                        {deletingMessages ? 'Suppression…' : 'Supprimer'}
                      </button>
                    </div>
                  ) : (
                    <div className="cd-input">
                      <input ref={pdfInputRef} className="cd-pdf-input" type="file" accept="application/pdf,.pdf" onChange={selectPdf} />
                      <div className="cd-compose-tools">
                        {canDelete && <button
                          type="button"
                          className="cd-select-action"
                          onClick={() => {
                            setShowDocPicker(false);
                            setSelectionMode(true);
                          }}
                          title="Sélectionner des messages"
                          aria-label="Sélectionner des messages"
                          disabled={deletingMessages}
                        >
                          <span aria-hidden="true">✓</span>
                        </button>}
                        <button
                          className="cd-action"
                          onClick={() => { setShowDocPicker(value => !value); setDocPickerType(null); setDocSearch(''); }}
                          title="Joindre un PDF ou document"
                          aria-label="Joindre un PDF ou document"
                          aria-expanded={showDocPicker}
                          aria-controls="cd-document-picker"
                          style={(doc || pdfFile) ? { background: '#e6faf5', borderColor: '#00a884' } : {}}
                        >📎</button>
                      </div>
                      <textarea ref={inputRef} rows="1" value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
                        placeholder={`Message à ${target.name}...`} autoFocus />
                      <button className="cd-send" onClick={send} disabled={(!text.trim() && !doc && !pdfFile) || sending} aria-label="Envoyer">&#10148;</button>
                    </div>
                  )}
                  {showDocPicker && (
                    <div className="cd-doc-picker" id="cd-document-picker">
                      {!docPickerType ? (
                        <>
                          <div className="cd-doc-picker-head"><strong>Joindre un fichier ou document</strong><button type="button" onClick={() => setShowDocPicker(false)} aria-label="Fermer">&times;</button></div>
                          <div className="cd-doc-types">
                            <button type="button" className="cd-pdf-picker-option" onClick={() => pdfInputRef.current?.click()}>
                              <i>PDF</i><span>PDF depuis le PC</span><small>Local</small>
                            </button>
                            {DOCUMENT_TYPES.map(type => {
                              const count = availableDocuments.filter(item => String(item.type).toUpperCase() === type.type).length;
                              return (
                                <button key={type.type} type="button" onClick={() => setDocPickerType(type.type)} disabled={count === 0}>
                                  <i style={{ background: type.tint, color: type.color }}>{type.mark}</i><span>{type.label}</span><small>{count}</small>
                                </button>
                              );
                            })}
                          </div>
                          {availableDocuments.length === 0 && <p className="cd-doc-empty">Enregistrez d’abord un document.</p>}
                        </>
                      ) : (
                        <>
                          <div className="cd-doc-picker-head">
                            <button className="cd-doc-back" type="button" onClick={() => { setDocPickerType(null); setDocSearch(''); }} aria-label="Retour">&#8592;</button>
                            <strong>{docPickerType === 'ALL' ? 'Tous les documents' : documentTypeMeta(docPickerType).label}</strong>
                            <button type="button" onClick={() => setShowDocPicker(false)} aria-label="Fermer">&times;</button>
                          </div>
                          <input className="cd-doc-search" value={docSearch} onChange={event => setDocSearch(event.target.value)} placeholder="Rechercher numéro, client..." autoFocus />
                          <div className="cd-doc-results">
                            {filteredDocuments.length === 0 ? <p className="cd-doc-empty">Aucun document trouvé.</p> : filteredDocuments.map(item => {
                              const type = documentTypeMeta(item.type);
                              return (
                                <button key={`${item.type}:${item.id || item.number}`} type="button" onClick={() => { setDoc(item); setShowDocPicker(false); setDocPickerType(null); setDocSearch(''); }}>
                                  <i style={{ background: type.tint, color: type.color }}>{type.mark}</i>
                                  <span><strong>{item.number}</strong><small>{item.client || 'Client non renseigné'}</small></span>
                                  <time>{item.date || ''}</time>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {doc && !selectionMode && (
                    <div className="cd-doc-bar">
                      <span className="cd-chip">{documentTypeMeta(doc.type).mark} · {doc.number} <button onClick={() => setDoc(null)}>&times;</button></span>
                    </div>
                  )}
                  {pdfFile && !selectionMode && (
                    <div className="cd-doc-bar cd-pdf-bar">
                      <span className="cd-chip"><b>PDF</b> {pdfFile.name} <small>{formatFileSize(pdfFile.size)}</small><button onClick={() => { setPdfFile(null); if (pdfInputRef.current) pdfInputRef.current.value = ''; }}>&times;</button></span>
                    </div>
                  )}
                  {sendError && !selectionMode && <div className="cd-send-error">{sendError}</div>}
                </>
              )}
            </>
          ) : (
            <div className="cd-email">
              {!selectedMail && <div className="cd-mail-nav"><button className={mailView === 'compose' ? 'a' : ''} onClick={() => { setMailView('compose'); setSelectedMail(null); }}>{t('Nouveau')}</button><button className={mailView === 'sent' ? 'a' : ''} onClick={() => { setMailView('sent'); setSelectedMail(null); }}>{t('Envoyés')}</button><button className={mailView === 'received' ? 'a' : ''} onClick={() => { setMailView('received'); setSelectedMail(null); }}>{t('Reçus')} {mailHistory.filter(mail => mail.direction === 'received' && !mail.is_read).length > 0 ? `(${mailHistory.filter(mail => mail.direction === 'received' && !mail.is_read).length})` : ''}</button></div>}
              {!selectedMail && <button className="cd-mail-sync" onClick={syncMail} disabled={mailSyncing}>{mailSyncing ? 'Synchronisation…' : 'Actualiser Gmail'}</button>}
              {mailDeleteError && <div className="cd-send-error">{mailDeleteError}</div>}
              {(mailView === 'sent' || mailView === 'received') && (selectedMail ? (
                <section className="cd-mail-detail">
                  <nav className="cd-mail-detail-toolbar" aria-label="Actions email">
                    <button className="cd-mail-back" type="button" onClick={() => setSelectedMail(null)} aria-label={t('Retour boîte de réception')}><span aria-hidden="true">←</span><strong>{t('Retour')}</strong></button>
                    <span>{t(selectedMail.direction === 'received' ? 'Boîte de réception' : 'Messages envoyés')}</span>
                    {selectedMail.direction === 'received' && <button type="button" onClick={() => replyToMail(selectedMail)}>{t('Répondre')}</button>}
                    {canDelete && <button type="button" className="admin-delete-action" onClick={() => deleteMail(selectedMail)} disabled={mailDeleting}>{mailDeleting ? 'Suppression…' : 'Supprimer'}</button>}
                  </nav>
                  <div className="cd-mail-detail-page">
                    <header className="cd-mail-subject">
                      <div><h1>{selectedMail.subject || 'Sans sujet'}</h1><b>{selectedMail.direction === 'received' ? 'Reçu' : 'Envoyé'}</b></div>
                    </header>
                    <section className="cd-mail-identity">
                      <i>{initials(selectedMail.direction === 'received' ? (selectedMail.sender_name || selectedMail.sender_email) : selectedMail.correspondent)}</i>
                      <div className="cd-mail-contact">
                        <strong>{selectedMail.direction === 'received' ? (selectedMail.sender_name || 'Expéditeur inconnu') : selectedMail.correspondent}</strong>
                        <span>{selectedMail.direction === 'received' ? (selectedMail.sender_email || selectedMail.correspondent || 'Adresse inconnue') : selectedMail.account_email}</span>
                      </div>
                      <time>{new Date(selectedMail.created_at).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' })}</time>
                    </section>
                    <dl className="cd-mail-metadata">
                      <div><dt>De</dt><dd>{selectedMail.direction === 'received' ? `${selectedMail.sender_name || 'Expéditeur inconnu'} <${selectedMail.sender_email || selectedMail.correspondent || 'Adresse inconnue'}>` : selectedMail.account_email}</dd></div>
                      <div><dt>À</dt><dd>{selectedMail.direction === 'received' ? (selectedMail.account_email || user?.email || 'Moi') : selectedMail.correspondent}</dd></div>
                      <div><dt>{t('Date')}</dt><dd>{new Date(selectedMail.created_at).toLocaleString(locale)}</dd></div>
                    </dl>
                    <article className="cd-mail-content">{selectedMail.body || 'Message vide'}</article>
                    {selectedMail.direction === 'received' && <footer className="cd-mail-detail-actions"><button type="button" onClick={() => replyToMail(selectedMail)}>↩ {t('Répondre')}</button></footer>}
                  </div>
                </section>
              ) : (
                <div ref={mailListRef} className="cd-mail-list">{mailHistory.filter(mail => mail.direction === mailView).length === 0 ? <div className="cd-empty">Aucun courrier reçu depuis connexion Gmail.</div> : mailHistory.filter(mail => mail.direction === mailView).map(mail => (
                  <article key={mail.id} className={`cd-mail-row${mail.direction === 'received' && !mail.is_read ? ' unread' : ''}`} role="button" tabIndex={0} onClick={() => openMail(mail)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') openMail(mail); }}>
                    <header>
                      <strong>{mail.direction === 'received' ? (mail.sender_name || mail.sender_email || mail.correspondent || t('Expéditeur inconnu')) : `${t('À')} : ${mail.correspondent}`}</strong>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <time>{new Date(mail.created_at).toLocaleDateString(locale)}</time>
                        {canDelete && <button type="button" className="admin-delete-action" onClick={(event) => { event.stopPropagation(); deleteMail(mail); }} disabled={mailDeleting} aria-label="Supprimer cet email">×</button>}
                      </div>
                    </header>
                    <span>{mail.direction === 'received' ? (mail.sender_email || mail.correspondent || '') : mail.correspondent}</span>
                    <p><b>{mail.subject || 'Sans sujet'}</b><em> — {mail.body || 'Message vide'}</em></p>
                  </article>
                ))}</div>
              ))}
              {mailView === 'compose' && <>
              {smtpConfigured === false && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#fef3c7', border: '1px solid #fbbf24', fontSize: 12, color: '#92400e', marginBottom: 8, lineHeight: 1.5 }}>
                  ⚠️ Vous devez configurer votre Gmail personnel dans <strong>Réglages {'>'} Configuration Email</strong> avant d'envoyer des emails.
                </div>
              )}
              {smtpConfigured === true && (
                <div style={{ padding: '6px 12px', borderRadius: 8, background: '#d1fae5', border: '1px solid #34d399', fontSize: 11, color: '#065f46', marginBottom: 8 }}>
                  ✓ Votre Gmail est configuré
                </div>
              )}
              {mailUsers.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', width: '100%' }}>Utilisateurs internes:</span>
                  {mailUsers.map(u => (
                    <button key={u.id} onClick={() => setEmailTo(u.email || '')} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, border: '1px solid #e2e8f0', background: emailTo === u.email ? '#00a884' : '#fff', color: emailTo === u.email ? '#fff' : '#475569', cursor: 'pointer' }}>{u.full_name || u.username}</button>
                  ))}
                </div>
              )}
              <input type="email" placeholder="Destinataire (email)..." value={emailTo} onChange={e => setEmailTo(e.target.value)} />
              <input type="text" placeholder="Sujet..." value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
              <textarea placeholder="Corps du message..." value={emailBody} onChange={e => setEmailBody(e.target.value)} />
              {emailStatus === 'ok' && <div style={{ color: '#00a884', fontSize: 12, fontWeight: 600 }}>Envoyé avec succès!</div>}
              {emailStatus && emailStatus !== 'ok' && <div style={{ color: '#ef4444', fontSize: 12 }}>{emailStatus}</div>}
              <button onClick={sendEmail} disabled={!emailTo.trim() || emailSending}>{emailSending ? 'Envoi...' : 'Envoyer'}</button>
              </>}
            </div>
          )}
        </div>
      </aside>
      {canDelete && deleteRequest && (
        <div className="cd-confirm-overlay">
          <section className="cd-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cd-confirm-title" aria-describedby="cd-confirm-description">
            <div className="cd-confirm-icon" aria-hidden="true">!</div>
            <div className="cd-confirm-copy">
              <h4 id="cd-confirm-title">
                {deleteRequest.mode === 'single'
                  ? 'Supprimer ce message ?'
                  : `Supprimer ${deleteRequest.ids.length} message${deleteRequest.ids.length > 1 ? 's' : ''} ?`}
              </h4>
              <p id="cd-confirm-description">
                {deleteRequest.mode === 'single'
                  ? 'Ce message sera supprimé pour tous les participants.'
                  : 'Ces messages disparaîtront de votre messagerie.'}
              </p>
              {deleteError && <div className="cd-confirm-error" role="alert">{deleteError}</div>}
            </div>
            <div className="cd-confirm-actions">
              <button type="button" className="cd-confirm-keep" onClick={() => { setDeleteRequest(null); setDeleteError(''); }} disabled={deletingMessages}>Conserver</button>
              <button type="button" className="cd-confirm-delete" onClick={confirmDeleteMessages} disabled={deletingMessages} autoFocus>
                {deletingMessages ? 'Suppression…' : 'Supprimer'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
