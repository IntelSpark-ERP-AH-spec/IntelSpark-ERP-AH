import { Router, raw } from 'express';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbRun, dbTransaction } from '../db.js';
import { authMiddleware, VALID_ROLES } from '../auth.js';
import { sendToUser, sendToRole } from '../websocket.js';

const router = Router();
router.use(authMiddleware);

const ALLOWED_DOCUMENT_TYPES = new Set(['DEV', 'BL', 'BC', 'FACT', 'AVOIR']);
const RECEIVED_DOCUMENT_ROLES = new Set(['admin', 'commercial', 'magasinier', 'comptable', 'financier', 'technicien', 'employe']);
const MAX_MESSAGE_LENGTH = 4000;
const MAX_DOCUMENT_BYTES = 128 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const ROUTE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PDF_UPLOAD_DIR = path.resolve(process.env.MESSAGE_PDF_DIR || path.resolve(ROUTE_DIR, '..', 'uploads', 'message-pdfs'));
mkdirSync(PDF_UPLOAD_DIR, { recursive: true });

function msgSelect() {
  return `SELECT m.*, u.username as sender_name, u.role as sender_role, u.full_name as sender_full_name
    FROM messages m JOIN users u ON m.sender_id = u.id`;
}

function userMessageCondition(userId, role) {
  return `(m.sender_id = ? OR m.recipient_id = ? OR (m.recipient_role = ? AND m.sender_id != ?))`;
}

function userMessageParams(userId, role) {
  return [userId, userId, role, userId];
}

function visibleToUser(row, user) {
  return row.sender_id === user.id
    || row.recipient_id === user.id
    || (!row.recipient_id && row.recipient_role === user.role && row.sender_id !== user.id);
}

function decodeHeader(value) {
  try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); }
}

function safePdfName(value) {
  const normalized = decodeHeader(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 180);
  return normalized.toLowerCase().endsWith('.pdf') ? normalized : `${normalized || 'document'}.pdf`;
}

function pdfPath(fileId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(fileId || ''))) return null;
  return path.join(PDF_UPLOAD_DIR, `${fileId}.pdf`);
}

function serializeMessage(row) {
  if (!row) return row;
  const message = { ...row };
  if (message.doc_payload) {
    try { message.document = JSON.parse(message.doc_payload); } catch { message.document = null; }
  }
  delete message.doc_payload;
  return message;
}

function validateDocumentAttachment(docType, docId, document) {
  if (!docType && !docId && !document) return { docType: null, docId: null, payload: null };
  const normalizedType = String(docType || '').trim().toUpperCase();
  const normalizedId = String(docId || '').trim();
  if (!ALLOWED_DOCUMENT_TYPES.has(normalizedType)) throw new Error('Type document invalide');
  if (!normalizedId || normalizedId.length > 120) throw new Error('Identifiant document invalide');
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Contenu document requis');
  if (String(document.type || '').trim().toUpperCase() !== normalizedType) throw new Error('Type document incoherent');
  if (!String(document.number || '').trim()) throw new Error('Numero document requis');
  if (!Array.isArray(document.items)) throw new Error('Articles document requis');
  const payload = JSON.stringify(document);
  if (Buffer.byteLength(payload, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('Document trop volumineux');
  return { docType: normalizedType, docId: normalizedId, payload };
}

router.get('/users', (req, res) => {
  const users = dbQuery(
    `SELECT id, username, role, full_name, department FROM users WHERE active=1 AND id != ? ORDER BY username`,
    [req.user.id]
  );
  res.json(users);
});

router.get('/unread-count', (req, res) => {
  const count = dbQuery(
    `SELECT COUNT(*) as total FROM messages
     WHERE read = 0 AND sender_id != ? AND (recipient_id = ? OR recipient_role = ?)
       AND NOT EXISTS (SELECT 1 FROM message_deletions md WHERE md.message_id = messages.id AND md.user_id = ?)`,
    [req.user.id, req.user.id, req.user.role, req.user.id]
  )[0].total;
  res.json({ count });
});

router.get('/received-documents', (req, res) => {
  if (!RECEIVED_DOCUMENT_ROLES.has(req.user.role)) {
    return res.status(403).json({ error: 'Page documents recus non autorisee' });
  }
  const placeholders = [...ALLOWED_DOCUMENT_TYPES].map(() => '?').join(',');
  const rows = dbQuery(`${msgSelect()}
    WHERE m.sender_id != ?
      AND m.doc_payload IS NOT NULL
      AND m.doc_type IN (${placeholders})
      AND (m.recipient_id = ? OR (m.recipient_id IS NULL AND m.recipient_role = ?))
      AND NOT EXISTS (SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = ?)
    ORDER BY m.created_at DESC
    LIMIT 500`, [req.user.id, ...ALLOWED_DOCUMENT_TYPES, req.user.id, req.user.role, req.user.id]);
  return res.json(rows.map(serializeMessage));
});

router.get('/conversations', (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;

  const convos = dbQuery(`
    WITH directed AS (
      SELECT
        CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END as other_id,
        CASE WHEN sender_id = ? THEN 'user' ELSE 'user' END as conv_type,
        id, sender_id, recipient_id, recipient_role, content, created_at, read
      FROM messages m
      WHERE ((sender_id = ? AND recipient_id IS NOT NULL)
         OR (recipient_id = ?))
        AND NOT EXISTS (
          SELECT 1 FROM message_deletions md
          WHERE md.message_id = m.id AND md.user_id = ?
        )
    ),
    role_based AS (
      SELECT sender_id as other_id, 'role' as conv_type,
        id, sender_id, recipient_id, recipient_role, content, created_at, read
      FROM messages m
      WHERE recipient_role = ? AND sender_id != ? AND recipient_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM message_deletions md
          WHERE md.message_id = m.id AND md.user_id = ?
        )
    ),
    all_msgs AS (
      SELECT * FROM directed WHERE other_id IS NOT NULL
      UNION ALL
      SELECT * FROM role_based
    ),
    last_per_user AS (
      SELECT other_id, MAX(created_at) as last_at
      FROM all_msgs GROUP BY other_id
    )
    SELECT
      am.*,
      u.username as other_username,
      u.full_name as other_full_name,
      u.role as other_role,
      (SELECT COUNT(*) FROM messages
       WHERE read = 0 AND sender_id = am.other_id
         AND (recipient_id = ? OR recipient_role = ?)
         AND sender_id != ?
         AND NOT EXISTS (
           SELECT 1 FROM message_deletions md
           WHERE md.message_id = messages.id AND md.user_id = ?
         )) as unread_count
    FROM last_per_user lpu
    JOIN all_msgs am ON am.other_id = lpu.other_id AND am.created_at = lpu.last_at
    JOIN users u ON u.id = am.other_id
    ORDER BY am.created_at DESC
    LIMIT 50
  `, [userId, userId, userId, userId, userId, role, userId, userId, userId, role, userId, userId]);

  const roleConvos = dbQuery(`
    SELECT m.*, 'role' as conv_type,
      ('role:' || m.recipient_role) as other_id,
      ('Tous les ' || m.recipient_role || 's') as other_username,
      ('Tous les ' || m.recipient_role || 's') as other_full_name,
      m.recipient_role as other_role,
      0 as unread_count
    FROM messages m
    WHERE m.sender_id = ? AND m.recipient_role IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM message_deletions md
        WHERE md.message_id = m.id AND md.user_id = ?
      )
      AND m.created_at = (
        SELECT MAX(latest.created_at) FROM messages latest
        WHERE latest.sender_id = m.sender_id AND latest.recipient_role = m.recipient_role
          AND NOT EXISTS (
            SELECT 1 FROM message_deletions md
            WHERE md.message_id = latest.id AND md.user_id = ?
          )
      )
  `, [userId, userId, userId]);

  res.json([...convos, ...roleConvos].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at))).slice(0, 50));
});

router.get('/', (req, res) => {
  const { with_user, with_role, search } = req.query;
  const userId = req.user.id;
  const role = req.user.role;
  let sql = msgSelect();
  const params = [];

  if (with_role) {
    sql += ` WHERE ((m.recipient_role = ? AND m.sender_id = ?) OR (m.recipient_id = ? AND u.role = ?))`;
    params.push(with_role, userId, userId, with_role);
  } else if (with_user) {
    sql += ` WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))`;
    params.push(userId, with_user, with_user, userId);
  } else {
    sql += ` WHERE ${userMessageCondition(userId, role)}`;
    params.push(...userMessageParams(userId, role));
  }

  sql += ` AND NOT EXISTS (SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = ?)`;
  params.push(userId);

  if (search) {
    sql += ` AND m.content LIKE ?`;
    params.push(`%${search}%`);
  }

  sql += ` ORDER BY m.created_at ASC LIMIT 300`;
  res.json(dbQuery(sql, params).map(serializeMessage));
});

router.post('/pdf', raw({ type: 'application/pdf', limit: MAX_PDF_BYTES }), (req, res) => {
  const recipientId = String(req.get('x-recipient-id') || '').trim() || null;
  const recipientRole = String(req.get('x-recipient-role') || '').trim() || null;
  if ((!recipientId && !recipientRole) || (recipientId && recipientRole)) {
    return res.status(400).json({ error: 'Destinataire unique requis' });
  }
  if (recipientRole && !VALID_ROLES.includes(recipientRole)) {
    return res.status(400).json({ error: 'Role destinataire invalide' });
  }
  if (recipientId) {
    const recipient = dbQuery('SELECT id FROM users WHERE id = ? AND active = 1', [recipientId])[0];
    if (!recipient) return res.status(404).json({ error: 'Destinataire introuvable' });
  }

  const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!bytes.length || bytes.length > MAX_PDF_BYTES || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return res.status(400).json({ error: 'Fichier PDF invalide ou trop volumineux' });
  }

  const fileName = safePdfName(req.get('x-file-name'));
  const cleanContent = decodeHeader(req.get('x-message-content')).trim().slice(0, 1000);
  const fileId = uuidv4();
  const messageId = uuidv4();
  const filePath = pdfPath(fileId);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const payload = JSON.stringify({ kind: 'pdf', name: fileName, size: bytes.length, mime: 'application/pdf' });

  try {
    writeFileSync(filePath, bytes, { flag: 'wx' });
    dbRun(
      'INSERT INTO messages (id, sender_id, recipient_id, recipient_role, content, doc_type, doc_id, doc_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [messageId, req.user.id, recipientId, recipientRole, cleanContent, 'PDF', fileId, payload, now]
    );
  } catch {
    try { if (filePath && existsSync(filePath)) unlinkSync(filePath); } catch {}
    return res.status(500).json({ error: 'Envoi du PDF impossible' });
  }

  const row = serializeMessage(dbQuery(`${msgSelect()} WHERE m.id = ?`, [messageId])[0]);
  if (recipientId) sendToUser(recipientId, { type: 'chat_message', message: row });
  if (recipientRole) sendToRole(recipientRole, { type: 'chat_message', message: row });
  return res.json(row);
});

router.post('/delete-selection', (req, res) => {
  const requestedIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(requestedIds.map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error: 'Sélection vide' });
  if (ids.length > 100) return res.status(400).json({ error: 'Maximum 100 messages par suppression' });

  const placeholders = ids.map(() => '?').join(',');
  const visibleRows = dbQuery(
    `SELECT m.* FROM messages m WHERE m.id IN (${placeholders}) AND ${userMessageCondition(req.user.id, req.user.role)}`,
    [...ids, ...userMessageParams(req.user.id, req.user.role)]
  );
  dbTransaction(() => {
    for (const row of visibleRows) {
      dbRun('DELETE FROM messages WHERE id = ?', [row.id]);
    }
  });

  for (const row of visibleRows) {
    if (row.doc_type === 'PDF') {
      const filePath = pdfPath(row.doc_id);
      try { if (filePath && existsSync(filePath)) unlinkSync(filePath); } catch {}
    }
    sendToUser(row.sender_id, { type: 'chat_message_deleted', id: row.id });
    if (row.recipient_id) sendToUser(row.recipient_id, { type: 'chat_message_deleted', id: row.id });
    if (row.recipient_role) sendToRole(row.recipient_role, { type: 'chat_message_deleted', id: row.id });
  }

  return res.json({
    success: true,
    permanent: true,
    deleted: visibleRows.length,
    ids: visibleRows.map(row => row.id),
  });
});

router.get('/:id/pdf', (req, res) => {
  const row = dbQuery(`SELECT m.* FROM messages m
    WHERE m.id = ? AND m.doc_type = 'PDF'
      AND ${userMessageCondition(req.user.id, req.user.role)}
      AND NOT EXISTS (SELECT 1 FROM message_deletions md WHERE md.message_id = m.id AND md.user_id = ?)`,
  [req.params.id, ...userMessageParams(req.user.id, req.user.role), req.user.id])[0];
  if (!row || !visibleToUser(row, req.user)) return res.status(404).json({ error: 'PDF introuvable' });

  const filePath = pdfPath(row.doc_id);
  if (!filePath || !existsSync(filePath)) return res.status(404).json({ error: 'Fichier PDF introuvable' });
  let metadata = {};
  try { metadata = JSON.parse(row.doc_payload || '{}'); } catch {}
  const fileName = safePdfName(metadata.name);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return res.sendFile(filePath);
});

router.post('/', (req, res) => {
  const { recipient_id, recipient_role, content, doc_type, doc_id, document } = req.body;
  const cleanContent = String(content || '').trim();
  if (!cleanContent && !document) return res.status(400).json({ error: 'Message ou document requis' });
  if (cleanContent.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: 'Message trop long' });
  if ((!recipient_id && !recipient_role) || (recipient_id && recipient_role)) {
    return res.status(400).json({ error: 'Destinataire unique requis' });
  }
  if (recipient_role && !VALID_ROLES.includes(recipient_role)) {
    return res.status(400).json({ error: 'Role destinataire invalide' });
  }
  if (recipient_id) {
    const recipient = dbQuery('SELECT id FROM users WHERE id = ? AND active = 1', [recipient_id])[0];
    if (!recipient) return res.status(404).json({ error: 'Destinataire introuvable' });
  }

  let attachment;
  try {
    attachment = validateDocumentAttachment(doc_type, doc_id, document);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const id = uuidv4();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  dbRun(
    'INSERT INTO messages (id, sender_id, recipient_id, recipient_role, content, doc_type, doc_id, doc_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, req.user.id, recipient_id || null, recipient_role || null, cleanContent || `${attachment.docType} ${document.number}`, attachment.docType, attachment.docId, attachment.payload, now]
  );

  const row = serializeMessage(dbQuery(`${msgSelect()} WHERE m.id = ?`, [id])[0]);

  if (recipient_id) sendToUser(recipient_id, { type: 'chat_message', message: row });
  if (recipient_role) sendToRole(recipient_role, { type: 'chat_message', message: row });

  res.json(row);
});

router.put('/read-conversation', (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id requis' });
  dbRun(
    `UPDATE messages SET read = 1 WHERE sender_id = ? AND recipient_id = ? AND read = 0`,
    [user_id, req.user.id]
  );
  dbRun(
    `UPDATE messages SET read = 1 WHERE sender_id = ? AND recipient_role = ? AND recipient_id IS NULL AND read = 0`,
    [user_id, req.user.role]
  );
  res.json({ success: true });
});

router.put('/:id/read', (req, res) => {
  dbRun('UPDATE messages SET read = 1 WHERE id = ? AND (recipient_id = ? OR recipient_role = ?)',
    [req.params.id, req.user.id, req.user.role]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const msg = dbQuery('SELECT * FROM messages WHERE id = ?', [req.params.id])[0];
  if (!msg) return res.status(404).json({ error: 'Message introuvable' });
  if (req.user.role !== 'admin' && msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Non autorisé' });
  dbRun('DELETE FROM messages WHERE id = ?', [req.params.id]);
  if (msg.doc_type === 'PDF') {
    const filePath = pdfPath(msg.doc_id);
    try { if (filePath && existsSync(filePath)) unlinkSync(filePath); } catch {}
  }
  if (msg.recipient_id) sendToUser(msg.recipient_id, { type: 'chat_message_deleted', id: msg.id });
  if (msg.recipient_role) sendToRole(msg.recipient_role, { type: 'chat_message_deleted', id: msg.id });
  res.json({ success: true });
});

export default router;
