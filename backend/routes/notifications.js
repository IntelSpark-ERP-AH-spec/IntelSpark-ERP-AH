import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';
import { sendToUser } from '../websocket.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const { unread } = req.query;
  let sql = 'SELECT * FROM notifications WHERE user_id=?';
  const params = [req.user.id];
  if (unread === 'true') { sql += ' AND read=0'; }
  sql += ' ORDER BY created_at DESC LIMIT 50';
  res.json(dbQuery(sql, params));
});

router.get('/unread-count', (req, res) => {
  const count = dbQuery('SELECT COUNT(*) as total FROM notifications WHERE user_id=? AND read=0', [req.user.id])[0].total;
  res.json({ count });
});

router.put('/:id/read', (req, res) => {
  dbRun('UPDATE notifications SET read=1 WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

router.post('/create', requireRole('admin', 'magasinier', 'comptable', 'rh'), (req, res) => {
  const { user_id, type, title, message, broadcast_to_role } = req.body;
  if (!type || !title) return res.status(400).json({ error: 'type et title requis' });
  if (broadcast_to_role) {
    const users = dbQuery('SELECT id FROM users WHERE active=1 AND role=?', [broadcast_to_role]);
    for (const u of users) createNotification(u.id, type, title, message);
    return res.json({ success: true, count: users.length });
  }
  const id = createNotification(user_id || req.user.id, type, title, message || '');
  res.json({ success: true, id });
});

router.put('/read-all', (req, res) => {
  dbRun('UPDATE notifications SET read=1 WHERE user_id=?', [req.user.id]);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  dbRun('DELETE FROM notifications WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

export function createNotification(userId, type, title, message) {
  try {
    const id = uuidv4();
    const notification = {
      id, user_id: userId, type, title, message: message || null,
      read: 0, created_at: new Date().toISOString(),
    };
    dbRun(`INSERT INTO notifications (id, user_id, type, title, message, read, created_at)
      VALUES (?,?,?,?,?,0,?)`,
    [id, userId, type, title, notification.message, notification.created_at]);
    sendToUser(userId, { type: 'notification', notification });
    return id;
  } catch { return null; }
}

export function notifyAllUsers(type, title, message) {
  try {
    const users = dbQuery('SELECT id FROM users WHERE active=1');
    for (const user of users) {
      createNotification(user.id, type, title, message);
    }
  } catch {}
}

export default router;
