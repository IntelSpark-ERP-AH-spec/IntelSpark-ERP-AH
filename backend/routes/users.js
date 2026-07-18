import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun, dbTransaction } from '../db.js';
import { authMiddleware, roleMiddleware, VALID_ROLES, validatePassword } from '../auth.js';
import { disconnectUser } from '../websocket.js';

const router = Router();

router.use(authMiddleware);
router.use(roleMiddleware('admin'));

router.get('/', (req, res) => {
  const users = dbQuery('SELECT id, username, role, department, full_name, email, active, created_at, last_login FROM users ORDER BY created_at');
  res.json(users);
});

router.post('/', (req, res) => {
  const { username, password, role, department, full_name, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username et password requis' });
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,50}$/.test(username)) return res.status(400).json({ error: 'Nom d’utilisateur invalide' });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
  const normalizedUsername = username.trim().toLowerCase();
  const existing = dbGet('SELECT id FROM users WHERE lower(username) = ?', [normalizedUsername]);
  if (existing) return res.status(400).json({ error: 'Nom d\'utilisateur déjà pris' });
  const hash = bcrypt.hashSync(password, 12);
  const idColumn = dbGet("SELECT type FROM pragma_table_info('users') WHERE name='id'");
  const usesNumericId = /INT/i.test(String(idColumn?.type || ''));
  let id;
  if (usesNumericId) {
    const result = dbRun('INSERT INTO users (username, password, role, department, full_name, email) VALUES (?,?,?,?,?,?)',
      [normalizedUsername, hash, role || 'employe', department || null, full_name || null, email || null]);
    id = Number(result.lastInsertRowid);
  } else {
    id = uuidv4();
    dbRun('INSERT INTO users (id, username, password, role, department, full_name, email) VALUES (?,?,?,?,?,?,?)',
      [id, normalizedUsername, hash, role || 'employe', department || null, full_name || null, email || null]);
  }
  res.status(201).json({ id, username: normalizedUsername, role: role || 'employe', department, full_name, email });
});

router.put('/:id', (req, res) => {
  const existing = dbGet('SELECT id, username, role, department, full_name, email, active FROM users WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const { role, department, full_name, email, active } = req.body;
  const nextRole = role ?? existing.role;
  if (!VALID_ROLES.includes(nextRole)) return res.status(400).json({ error: 'Rôle invalide' });
  const nextActive = active === undefined ? existing.active : (active ? 1 : 0);
  if (String(existing.id) === String(req.user.id) && !nextActive) {
    return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte' });
  }
  const revokeSessions = nextRole !== existing.role || nextActive !== existing.active;
  dbRun(`UPDATE users SET role=?, department=?, full_name=?, email=?, active=?,
      token_version=token_version + ? WHERE id=?`,
    [nextRole, department ?? existing.department, full_name ?? existing.full_name, email ?? existing.email, nextActive, revokeSessions ? 1 : 0, req.params.id]);
  if (revokeSessions) disconnectUser(existing.id, 'Droits utilisateur modifiés');
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const target = dbGet('SELECT id, username, role FROM users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (String(target.id) === String(req.user.id)) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
  }
  if (target.role === 'admin') {
    const adminCount = dbGet("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND active = 1")?.total || 0;
    if (adminCount <= 1) return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur actif' });
  }

  try {
    // Remove dependent rows first: older databases do not define ON DELETE CASCADE
    // for these tables, which otherwise raises SQLITE_CONSTRAINT_FOREIGNKEY.
    const result = dbTransaction(() => {
      dbRun('DELETE FROM notifications WHERE user_id = ?', [target.id]);
      dbRun('DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?', [target.id, target.id]);
      dbRun('DELETE FROM user_data WHERE user_id = ?', [target.id]);
      return dbRun('DELETE FROM users WHERE id = ?', [target.id]);
    });
    if (!result.changes) return res.status(404).json({ error: 'Utilisateur introuvable' });
    return res.json({ success: true, deleted: { id: target.id, username: target.username } });
  } catch (error) {
    console.error('Suppression utilisateur impossible:', error.message);
    return res.status(409).json({ error: 'Suppression impossible: des données liées doivent être vérifiées' });
  }
});

router.post('/:id/reset-password', (req, res) => {
  const target = dbGet('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const tempPass = Array.from({ length: 24 }, () => chars[crypto.randomInt(0, chars.length)]).join('');
  const hash = bcrypt.hashSync(tempPass, 12);
  dbRun('UPDATE users SET password=?, token_version=token_version + 1 WHERE id=?', [hash, req.params.id]);
  disconnectUser(req.params.id, 'Mot de passe réinitialisé');
  res.json({ success: true, temporary_password: tempPass });
});

export default router;
