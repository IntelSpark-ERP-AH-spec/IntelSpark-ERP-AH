import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun } from '../db.js';
import { generateToken, authMiddleware, blacklistToken, checkLoginLockout, recordLoginAttempt, validatePassword } from '../auth.js';
import { decryptSecret, encryptSecret, isEncryptedSecret, upgradeSecret } from '../secrets.js';
import { mailboxBoundary } from '../mail-sync-service.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || password.length > 128) {
      return res.status(400).json({ error: 'Identifiants requis' });
    }
    const normalizedUsername = username.trim();
    if (checkLoginLockout(normalizedUsername)) {
      return res.status(429).json({ error: 'Compte temporairement verrouillé. Réessayez dans 5 minutes.' });
    }
    const user = dbGet('SELECT * FROM users WHERE username = ? AND active = 1', [normalizedUsername]);
    
    if (!user) {
      recordLoginAttempt(normalizedUsername, false);
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    
    if (!await bcrypt.compare(password, user.password)) {
      recordLoginAttempt(normalizedUsername, false);
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    recordLoginAttempt(normalizedUsername, true);

    res.clearCookie('token', { path: '/' });
    
    const token = generateToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, department: user.department, full_name: user.full_name, email: user.email }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ error: 'Erreur interne lors de la connexion' });
  }
});

router.post('/logout', authMiddleware, (req, res) => {
  blacklistToken(req.user.jti, req.user.exp);
  res.json({ success: true });
});

router.get('/me', authMiddleware, (req, res) => {
  const user = dbGet('SELECT id, username, role, department, full_name, email FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(user);
});

router.put('/me', authMiddleware, (req, res) => {
  const { full_name, email } = req.body;
  dbRun('UPDATE users SET full_name = ?, email = ? WHERE id = ?', [full_name, email, req.user.id]);
  res.json({ success: true });
});

router.get('/me/smtp', authMiddleware, (req, res) => {
  const user = dbGet(`SELECT smtp_user, smtp_pass, mail_connected_at, mail_last_sync_at
    FROM users WHERE id = ?`, [req.user.id]);
  if (user?.smtp_pass && !isEncryptedSecret(user.smtp_pass)) {
    dbRun('UPDATE users SET smtp_pass = ? WHERE id = ?', [upgradeSecret(user.smtp_pass), req.user.id]);
  }
  res.json({
    smtp_user: user?.smtp_user || '',
    smtp_configured: Boolean(user?.smtp_user && user?.smtp_pass),
    mail_connected_at: user?.mail_connected_at || null,
    mail_last_sync_at: user?.mail_last_sync_at || null,
  });
});

router.put('/me/smtp', authMiddleware, async (req, res) => {
  const { smtp_user, smtp_pass, clear } = req.body;
  if (clear === true) {
    dbRun(`UPDATE users SET smtp_user = '', smtp_pass = '', mail_connected_at = NULL,
      mail_last_uid = 0, mail_uid_validity = NULL, mail_last_sync_at = NULL WHERE id = ?`, [req.user.id]);
    return res.json({ success: true, smtp_configured: false });
  }
  const normalizedEmail = String(smtp_user || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Adresse email invalide' });
  }
  const existing = dbGet(`SELECT smtp_user, smtp_pass, mail_connected_at, mail_last_uid, mail_uid_validity
    FROM users WHERE id = ?`, [req.user.id]);
  const suppliedPassword = typeof smtp_pass === 'string' ? smtp_pass.replace(/\s+/g, '') : '';
  const nextPassword = suppliedPassword ? encryptSecret(suppliedPassword) : upgradeSecret(existing?.smtp_pass || '');
  if (!nextPassword) return res.status(400).json({ error: 'Mot de passe applicatif requis' });
  const accountChanged = normalizedEmail !== String(existing?.smtp_user || '').trim().toLowerCase();
  const needsBoundary = accountChanged || Boolean(suppliedPassword) || !existing?.mail_connected_at;
  try {
    if (needsBoundary) {
      const plainPassword = suppliedPassword || decryptSecret(nextPassword);
      const boundary = await mailboxBoundary(normalizedEmail, plainPassword);
      dbRun(`UPDATE users SET smtp_user = ?, smtp_pass = ?, mail_connected_at = ?, mail_last_uid = ?,
        mail_uid_validity = ?, mail_last_sync_at = NULL WHERE id = ?`,
      [normalizedEmail, nextPassword, boundary.connected_at, boundary.last_uid, boundary.uid_validity, req.user.id]);
      return res.json({ success: true, smtp_configured: true, mail_connected_at: boundary.connected_at });
    }
    dbRun('UPDATE users SET smtp_user = ?, smtp_pass = ? WHERE id = ?', [normalizedEmail, nextPassword, req.user.id]);
    return res.json({ success: true, smtp_configured: true, mail_connected_at: existing.mail_connected_at });
  } catch (error) {
    const authenticationFailed = error?.authenticationFailed || error?.responseStatus === 'NO';
    return res.status(502).json({
      error: authenticationFailed
        ? 'Connexion messagerie refusee. Verifiez adresse et secret.'
        : 'Connexion messagerie impossible. Reessayez dans quelques instants.',
    });
  }
});

router.put('/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const passwordError = validatePassword(newPassword);
  if (passwordError) return res.status(400).json({ error: passwordError });
  const user = dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  }
  const hash = bcrypt.hashSync(newPassword, 12);
  dbRun('UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?', [hash, req.user.id]);
  blacklistToken(req.user.jti, req.user.exp);
  res.json({ success: true });
});

export default router;
