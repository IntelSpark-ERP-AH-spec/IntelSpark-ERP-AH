import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { dbGet, dbRun } from '../db.js';
import { generateToken, authMiddleware, blacklistToken, checkLoginLockout, recordLoginAttempt, validatePassword } from '../auth.js';
import {
  decryptedPasswordForAccount,
  deletePersonalEmailAccount,
  getPersonalEmailAccount,
  resolveAuthorizedEmailAccount,
  savePersonalEmailAccount,
  testEmailCredentials,
} from '../email-account-service.js';

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
      user: { id: user.id, username: user.username, role: user.role, department: user.department, organization_id: user.organization_id || 'org_default', full_name: user.full_name, email: user.email }
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
  const user = dbGet('SELECT id, username, role, department, organization_id, full_name, email FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(user);
});

router.put('/me', authMiddleware, (req, res) => {
  const { full_name, email } = req.body;
  dbRun('UPDATE users SET full_name = ?, email = ? WHERE id = ?', [full_name, email, req.user.id]);
  res.json({ success: true });
});

router.get('/me/smtp', authMiddleware, (req, res) => {
  const account = getPersonalEmailAccount(req.user);
  res.json({
    smtp_user: account?.email_address || '',
    smtp_configured: Boolean(account?.configured),
    mail_connected_at: account?.mail_connected_at || null,
    mail_last_sync_at: account?.mail_last_sync_at || null,
    account_id: account?.id || null,
  });
});

router.put('/me/smtp', authMiddleware, async (req, res) => {
  if (req.body?.clear === true) {
    deletePersonalEmailAccount(req.user);
    return res.json({ success: true, smtp_configured: false });
  }
  try {
    const result = await savePersonalEmailAccount(req.user, req.body || {});
    if (result.status !== 'connected') {
      return res.status(422).json({ error: 'Connexion Gmail impossible', status: result.status });
    }
    return res.json({
      success: true,
      smtp_configured: true,
      mail_connected_at: result.account.mail_connected_at,
      account_id: result.account.id,
    });
  } catch (error) {
    return res.status(Number(error?.status || 400)).json({ error: error?.message || 'Configuration Gmail impossible' });
  }
});

router.post('/me/smtp/test', authMiddleware, async (req, res) => {
  const existing = getPersonalEmailAccount(req.user);
  let password = String(req.body?.smtp_pass || '').replace(/\s+/g, '');
  let emailAddress = String(req.body?.smtp_user || existing?.email_address || '').trim().toLowerCase();
  try {
    if (!password && existing?.id) {
      const account = resolveAuthorizedEmailAccount(req.user, existing.id, 'send');
      password = decryptedPasswordForAccount(account);
      emailAddress = account.email_address;
    }
    return res.json(await testEmailCredentials({ emailAddress, password }));
  } catch {
    return res.json({ status: 'configuration_incomplete' });
  } finally {
    password = '';
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
