import { Router } from 'express';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../auth.js';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { decryptSecret, isEncryptedSecret, upgradeSecret } from '../secrets.js';
import { syncMailboxForUser } from '../mail-sync-service.js';

const router = Router();
router.use(authMiddleware);

function smtpHost() {
  return String(process.env.SMTP_HOST || 'smtp.gmail.com').trim();
}

function smtpPort() {
  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
  return Number.isInteger(port) ? port : 587;
}

function smtpCredentials(userId) {
  const row = dbGet('SELECT smtp_user, smtp_pass, full_name FROM users WHERE id = ?', [userId]);
  if (!row?.smtp_user || !row?.smtp_pass) return null;
  if (!isEncryptedSecret(row.smtp_pass)) {
    const encrypted = upgradeSecret(row.smtp_pass);
    dbRun('UPDATE users SET smtp_pass = ? WHERE id = ?', [encrypted, userId]);
    row.smtp_pass = encrypted;
  }
  return { ...row, smtp_pass: decryptSecret(row.smtp_pass) };
}

router.post('/send', async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    const recipient = String(to || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254) {
      return res.status(400).json({ error: 'Destinataire invalide' });
    }
    const safeSubject = String(subject || '').trim().slice(0, 200);
    const safeBody = String(body || '').trim().slice(0, 50_000);

    const me = smtpCredentials(req.user.id);
    if (!me?.smtp_user || !me?.smtp_pass) {
      return res.status(400).json({ error: 'Vous devez configurer votre messagerie dans Réglages > Configuration SMTP avant d\'envoyer des emails.' });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost(),
      port: smtpPort(),
      secure: false,
      auth: { user: me.smtp_user, pass: me.smtp_pass },
    });

    const fromName = me.full_name || req.user.username;

    await transporter.sendMail({
      from: `"${fromName}" <${me.smtp_user}>`,
      to: recipient,
      subject: safeSubject,
      text: safeBody,
    });

    dbRun(`INSERT INTO email_history
      (id, user_id, direction, correspondent, subject, body, account_email, is_read)
      VALUES (?, ?, 'sent', ?, ?, ?, ?, 1)`,
    [uuidv4(), req.user.id, recipient, safeSubject, safeBody, me.smtp_user]);

    res.json({ success: true, message: 'Email envoyé avec succès' });
  } catch (err) {
    console.error('Email error:', err);
    if (err.code === 'EAUTH') {
      return res.status(500).json({ error: 'Identifiants de messagerie incorrects. Vérifiez votre adresse et votre mot de passe dans Réglages > Configuration SMTP.' });
    }
    res.status(500).json({ error: 'Échec envoi email' });
  }
});

router.get('/history', (req, res) => {
  const userId = String(req.user?.id || '');
  const account = dbGet('SELECT smtp_user FROM users WHERE id = ?', [userId]);
  if (!account?.smtp_user) return res.json([]);
  const accountEmail = String(account.smtp_user);
  return res.json(dbQuery(`SELECT id, direction, correspondent, subject, body, created_at,
      sender_name, sender_email, account_email, is_read
    FROM email_history WHERE user_id = ?
      AND (account_email = ? OR (account_email IS NULL AND direction = 'sent'))
      AND id NOT IN (SELECT email_id FROM email_deletions WHERE user_id = ?)
    ORDER BY created_at DESC LIMIT 500`, [userId, accountEmail, userId]));
});

router.post('/sync', async (req, res) => {
  try {
    const result = await syncMailboxForUser(req.user.id);
    if (result.skipped === 'not_configured') return res.status(400).json({ error: 'Configuration messagerie requise' });
    return res.json({ success: true, ...result });
  } catch (error) {
    res.status(502).json({ error: error.authenticationFailed ? 'Identifiants de messagerie refusés' : 'Synchronisation messagerie impossible' });
  }
});

router.put('/:id/read', (req, res) => {
  const result = dbRun(`UPDATE email_history SET is_read = 1
    WHERE id = ? AND user_id = ? AND direction = 'received'`, [req.params.id, req.user.id]);
  if (!result.changes) return res.status(404).json({ error: 'Email introuvable' });
  return res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const row = dbGet(`SELECT id, direction, account_email FROM email_history
    WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
  if (!row) return res.status(404).json({ error: 'Email introuvable' });

  dbRun(`INSERT INTO email_deletions (email_id, user_id, created_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(email_id, user_id) DO NOTHING`, [req.params.id, req.user.id]);
  dbRun('DELETE FROM email_history WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

  return res.json({ success: true });
});

router.get('/users', (req, res) => {
  const users = dbQuery(
    'SELECT id, username, full_name, email FROM users WHERE active = 1 AND email IS NOT NULL AND email != "" ORDER BY username'
  );
  res.json(users);
});

export default router;
