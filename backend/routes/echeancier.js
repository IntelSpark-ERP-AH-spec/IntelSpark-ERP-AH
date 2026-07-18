import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbQuery, dbRun } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';

const router = Router();
router.use(authMiddleware);

const canRead = requireRole('admin', 'commercial', 'comptable');
const canEdit = requireRole('admin', 'commercial');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function cleanDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = String(value).trim();
  if (!DATE_RE.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined;
  return date;
}

router.get('/', canRead, (req, res) => {
  const status = String(req.query.status || '').trim();
  const params = [req.user.id, req.user.id];
  let sql = `SELECT e.*,
    CASE WHEN scheduled_ack.echeance_id IS NULL THEN 0 ELSE 1 END AS scheduled_acknowledged,
    scheduled_ack.acknowledged_at AS scheduled_acknowledged_at,
    CASE WHEN due_ack.echeance_id IS NULL THEN 0 ELSE 1 END AS due_acknowledged,
    due_ack.acknowledged_at AS due_acknowledged_at
    FROM echeancier e
    LEFT JOIN echeancier_notification_acknowledgements scheduled_ack
      ON scheduled_ack.echeance_id = e.id AND scheduled_ack.user_id = ? AND scheduled_ack.phase = 'scheduled'
    LEFT JOIN echeancier_notification_acknowledgements due_ack
      ON due_ack.echeance_id = e.id AND due_ack.user_id = ? AND due_ack.phase = 'due'`;
  if (status === 'paid' || status === 'unpaid') {
    sql += ' WHERE e.status = ?';
    params.push(status);
  }
  sql += ` ORDER BY
    CASE WHEN e.status = 'unpaid' AND e.due_date IS NOT NULL THEN 0 WHEN e.status = 'unpaid' THEN 1 ELSE 2 END,
    e.due_date ASC, e.created_at DESC`;
  res.json(dbQuery(sql, params));
});

router.post('/', canEdit, (req, res) => {
  const body = req.body || {};
  const documentNumber = cleanText(body.document_number, 80);
  const partyName = cleanText(body.party_name, 200);
  const sourceDevisNumber = cleanText(body.source_devis_number, 80) || null;
  const partyIce = cleanText(body.party_ice, 30) || null;
  const partyType = body.party_type === 'fournisseur' ? 'fournisseur' : 'client';
  const invoiceDate = cleanDate(body.invoice_date);
  const dueDate = cleanDate(body.due_date);
  const amount = Number(body.amount || 0);
  const currency = cleanText(body.currency, 12).toUpperCase() || 'MAD';
  const paid = body.paid === true;

  if (!documentNumber || !partyName) return res.status(400).json({ error: 'Facture et client/fournisseur requis' });
  if (invoiceDate === undefined || dueDate === undefined) return res.status(400).json({ error: 'Date invalide' });
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000_000) return res.status(400).json({ error: 'Montant invalide' });

  const existing = dbGet('SELECT id, status, paid_at FROM echeancier WHERE document_number = ?', [documentNumber]);
  const id = existing?.id || uuidv4();
  const status = existing?.status === 'paid' || paid ? 'paid' : 'unpaid';
  const paidAt = status === 'paid' ? (existing?.paid_at || new Date().toISOString()) : null;

  if (existing) {
    dbRun(`UPDATE echeancier SET source_devis_number=?, party_type=?, party_name=?, party_ice=?,
      invoice_date=?, due_date=COALESCE(?, due_date), amount=?, currency=?, status=?, paid_at=?,
      updated_at=datetime('now') WHERE id=?`,
    [sourceDevisNumber, partyType, partyName, partyIce, invoiceDate, dueDate, amount, currency, status, paidAt, id]);
  } else {
    dbRun(`INSERT INTO echeancier
      (id, document_number, source_devis_number, party_type, party_name, party_ice, invoice_date,
       due_date, amount, currency, status, paid_at, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, documentNumber, sourceDevisNumber, partyType, partyName, partyIce, invoiceDate, dueDate,
      amount, currency, status, paidAt, req.user.id]);
  }

  res.status(existing ? 200 : 201).json(dbGet('SELECT * FROM echeancier WHERE id = ?', [id]));
});

router.patch('/:id', canEdit, (req, res) => {
  const current = dbGet('SELECT * FROM echeancier WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Échéance introuvable' });

  const body = req.body || {};
  const dueDate = Object.hasOwn(body, 'due_date') ? cleanDate(body.due_date) : current.due_date;
  if (dueDate === undefined) return res.status(400).json({ error: 'Date invalide' });
  const paid = Object.hasOwn(body, 'paid') ? body.paid === true : current.status === 'paid';
  const status = paid ? 'paid' : 'unpaid';
  const paidAt = paid ? (current.paid_at || new Date().toISOString()) : null;

  dbRun(`UPDATE echeancier SET due_date=?, status=?, paid_at=?, updated_at=datetime('now') WHERE id=?`,
    [dueDate, status, paidAt, current.id]);
  if ((!paid && current.status === 'paid') || dueDate !== current.due_date) {
    dbRun('DELETE FROM echeancier_acknowledgements WHERE echeance_id=?', [current.id]);
    dbRun('DELETE FROM echeancier_notification_acknowledgements WHERE echeance_id=?', [current.id]);
  }
  res.json(dbGet('SELECT * FROM echeancier WHERE id = ?', [current.id]));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const current = dbGet('SELECT id FROM echeancier WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Échéance introuvable' });
  dbRun('DELETE FROM echeancier_acknowledgements WHERE echeance_id=?', [current.id]);
  dbRun('DELETE FROM echeancier_notification_acknowledgements WHERE echeance_id=?', [current.id]);
  dbRun('DELETE FROM echeancier WHERE id=?', [current.id]);
  res.json({ success: true });
});

router.post('/:id/acknowledge', canEdit, (req, res) => {
  const current = dbGet('SELECT id FROM echeancier WHERE id = ?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Échéance introuvable' });
  const phase = req.body?.phase === 'scheduled' ? 'scheduled' : req.body?.phase === 'due' ? 'due' : null;
  if (!phase) return res.status(400).json({ error: 'Phase de notification invalide' });
  dbRun(`INSERT INTO echeancier_notification_acknowledgements (id, echeance_id, user_id, phase)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(echeance_id, user_id, phase) DO UPDATE SET acknowledged_at=datetime('now')`,
  [uuidv4(), current.id, req.user.id, phase]);
  res.json({ acknowledged: true, echeance_id: current.id, phase });
});

export default router;
