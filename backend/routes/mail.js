import { Router } from 'express';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../auth.js';
import { dbGet, dbQuery, dbRun } from '../db.js';
import {
  deleteOrganizationEmailAccount,
  deletePersonalEmailAccount,
  decryptedPasswordForAccount,
  EMAIL_DOCUMENT_TYPES,
  getOrganizationEmailAccounts,
  getOrganizationEmailAccountForAdmin,
  getPersonalEmailAccount,
  listAvailableEmailAccounts,
  replaceEmailAccountPermissions,
  resolveAuthorizedEmailAccount,
  saveOrganizationEmailAccount,
  savePersonalEmailAccount,
  setDefaultEmailAccount,
  testEmailCredentials,
} from '../email-account-service.js';
import { syncMailboxForUser } from '../mail-sync-service.js';

const router = Router();
router.use(authMiddleware);

function safeError(error) {
  const status = Number(error?.status || 500);
  const message = status < 500 ? error.message : 'Opération Gmail impossible';
  return { status, message };
}

function smtpTransport(account, password) {
  const port = Number.parseInt(process.env.SMTP_PORT || '465', 10);
  return nodemailer.createTransport({
    host: String(process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
    port: Number.isInteger(port) ? port : 465,
    secure: port === 465,
    auth: { user: account.email_address, pass: password },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 45_000,
  });
}

function normalizedDocumentType(value) {
  const type = String(value || '').trim().toUpperCase();
  if (!type) return '';
  if (!EMAIL_DOCUMENT_TYPES.has(type)) {
    throw Object.assign(new Error('Type document invalide'), { status: 400 });
  }
  return type;
}

function mailAttachments(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 10) throw Object.assign(new Error('Trop de pièces jointes'), { status: 400 });
  let total = 0;
  return value.map(item => {
    const filename = String(item?.filename || 'document').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 180);
    const content = String(item?.content || '');
    const encoding = item?.encoding === 'base64' ? 'base64' : 'utf8';
    total += Buffer.byteLength(content, encoding);
    if (total > 10 * 1024 * 1024) {
      throw Object.assign(new Error('Pièces jointes trop volumineuses'), { status: 413 });
    }
    return {
      filename,
      content,
      encoding,
      contentType: String(item?.content_type || 'application/octet-stream').slice(0, 120),
    };
  });
}

async function testStoredOrProvidedAccount(user, body, forcedAccountId = null) {
  let password = String(body?.app_password || body?.smtp_pass || '').replace(/\s+/g, '');
  let emailAddress = String(body?.email_address || body?.smtp_user || '').trim().toLowerCase();
  const accountId = forcedAccountId || body?.account_id;
  if (accountId) {
    const account = forcedAccountId
      ? getOrganizationEmailAccountForAdmin(user, forcedAccountId)
      : resolveAuthorizedEmailAccount(user, accountId, 'send');
    emailAddress ||= account.email_address;
    password ||= decryptedPasswordForAccount(account);
  } else {
    const personal = getPersonalEmailAccount(user);
    if (personal) {
      const account = resolveAuthorizedEmailAccount(user, personal.id, 'send');
      emailAddress ||= account.email_address;
      password ||= decryptedPasswordForAccount(account);
    }
  }
  try {
    return await testEmailCredentials({
      emailAddress,
      password,
      smtpEnabled: body?.smtp_enabled !== false,
      imapEnabled: body?.imap_enabled !== false,
    });
  } finally {
    password = '';
  }
}

router.get('/accounts', (req, res) => {
  res.json(listAvailableEmailAccounts(req.user));
});

router.get('/accounts/personal', (req, res) => {
  res.json(getPersonalEmailAccount(req.user) || {
    account_type: 'personal',
    configured: false,
    is_active: false,
  });
});

router.put('/accounts/personal', async (req, res) => {
  try {
    const result = await savePersonalEmailAccount(req.user, req.body || {});
    if (result.status !== 'connected') return res.status(422).json(result);
    return res.json(result);
  } catch (error) {
    const safe = safeError(error);
    return res.status(safe.status).json({ error: safe.message });
  }
});

router.post('/accounts/personal/test', async (req, res) => {
  try {
    return res.json(await testStoredOrProvidedAccount(req.user, req.body || {}));
  } catch {
    return res.json({ status: 'configuration_incomplete' });
  }
});

router.delete('/accounts/personal', (req, res) => {
  deletePersonalEmailAccount(req.user);
  res.json({ success: true });
});

router.put('/accounts/default', (req, res) => {
  try {
    const accountId = setDefaultEmailAccount(req.user, req.body?.account_id);
    res.json({ success: true, account_id: accountId });
  } catch (error) {
    const safe = safeError(error);
    res.status(safe.status).json({ error: safe.message });
  }
});

router.get('/accounts/organization', (req, res) => {
  try {
    res.json(getOrganizationEmailAccounts(req.user));
  } catch (error) {
    const safe = safeError(error);
    res.status(safe.status).json({ error: safe.message });
  }
});

router.post('/accounts/organization', async (req, res) => {
  try {
    const result = await saveOrganizationEmailAccount(req.user, req.body || {});
    if (result.status !== 'connected') return res.status(422).json(result);
    if (Array.isArray(req.body?.permissions)) {
      result.account.permissions = replaceEmailAccountPermissions(req.user, result.account.id, req.body.permissions);
    }
    res.status(201).json(result);
  } catch (error) {
    const safe = safeError(error);
    res.status(safe.status).json({ error: safe.message });
  }
});

router.put('/accounts/organization/:id', async (req, res) => {
  try {
    const result = await saveOrganizationEmailAccount(req.user, req.body || {}, req.params.id);
    if (result.status !== 'connected') return res.status(422).json(result);
    if (Array.isArray(req.body?.permissions)) {
      result.account.permissions = replaceEmailAccountPermissions(req.user, result.account.id, req.body.permissions);
    }
    res.json(result);
  } catch (error) {
    const safe = safeError(error);
    res.status(safe.status).json({ error: safe.message });
  }
});

router.put('/accounts/organization/:id/permissions', (req, res) => {
  try {
    res.json({
      permissions: replaceEmailAccountPermissions(req.user, req.params.id, req.body?.permissions),
    });
  } catch (error) {
    const safe = safeError(error);
    res.status(safe.status).json({ error: safe.message });
  }
});

router.post('/accounts/organization/:id/test', async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Accès administrateur requis' });
    return res.json(await testStoredOrProvidedAccount(req.user, req.body || {}, req.params.id));
  } catch {
    return res.json({ status: 'configuration_incomplete' });
  }
});

router.delete('/accounts/organization/:id', (req, res) => {
  try {
    const deleted = deleteOrganizationEmailAccount(req.user, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Compte partagé introuvable' });
    return res.json({ success: true });
  } catch (error) {
    const safe = safeError(error);
    return res.status(safe.status).json({ error: safe.message });
  }
});

router.post('/send', async (req, res) => {
  const recipient = String(req.body?.to || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254) {
    return res.status(400).json({ error: 'Destinataire invalide' });
  }
  const safeSubject = String(req.body?.subject || '').trim().slice(0, 200);
  const safeBody = String(req.body?.body || '').trim().slice(0, 50_000);
  const documentType = normalizedDocumentType(req.body?.document_type);
  const documentId = String(req.body?.document_id || '').trim().slice(0, 120) || null;
  let account;
  let password = '';
  let transporter;
  const historyId = uuidv4();

  try {
    account = resolveAuthorizedEmailAccount(
      req.user,
      req.body?.account_id,
      'send',
      documentType,
    );
    password = decryptedPasswordForAccount(account);
    if (!password || !account.smtp_enabled || !account.is_active) {
      throw Object.assign(new Error('Compte Gmail indisponible'), { status: 400 });
    }
    transporter = smtpTransport(account, password);
    await transporter.sendMail({
      from: `"${String(account.sender_name || req.user.full_name || req.user.username).replace(/"/g, '')}" <${account.email_address}>`,
      to: recipient,
      subject: safeSubject,
      text: safeBody,
      attachments: mailAttachments(req.body?.attachments),
    });
    dbRun(`INSERT INTO email_history
      (id,user_id,organization_id,email_account_id,sender_user_id,direction,correspondent,
       subject,body,account_email,is_read,document_type,document_id,status)
      VALUES (?,?,?,?,?,'sent',?,?,?,?,1,?,?, 'sent')`, [
      historyId,
      req.user.id,
      req.user.organization_id,
      account.id,
      req.user.id,
      recipient,
      safeSubject,
      safeBody,
      account.email_address,
      documentType || null,
      documentId,
    ]);
    return res.json({
      success: true,
      message: 'Email envoyé avec succès',
      account_id: account.id,
      account_email: account.email_address,
    });
  } catch (error) {
    const code = String(error?.code || '').toUpperCase();
    const simplified = code === 'EAUTH' ? 'identifiants_refuses' : 'envoi_impossible';
    if (account) {
      dbRun(`INSERT INTO email_history
        (id,user_id,organization_id,email_account_id,sender_user_id,direction,correspondent,
         subject,body,account_email,is_read,document_type,document_id,status,error_code)
        VALUES (?,?,?,?,?,'sent',?,?,?,?,1,?,?,'failed',?)`, [
        historyId,
        req.user.id,
        req.user.organization_id,
        account.id,
        req.user.id,
        recipient,
        safeSubject,
        safeBody,
        account.email_address,
        documentType || null,
        documentId,
        simplified,
      ]);
    }
    console.error('Email error:', {
      accountId: account?.id || undefined,
      code: code.slice(0, 40) || 'UNKNOWN',
      responseCode: Number(error?.responseCode || 0) || undefined,
    });
    const safe = safeError(error);
    if (code === 'EAUTH') return res.status(502).json({ error: 'Identifiants Gmail refusés' });
    return res.status(safe.status).json({ error: safe.status < 500 ? safe.message : 'Échec envoi email' });
  } finally {
    password = '';
    if (transporter) transporter.close();
  }
});

router.get('/history', (req, res) => {
  res.json(dbQuery(`SELECT id,direction,correspondent,subject,body,created_at,sender_name,
      sender_email,account_email,email_account_id,sender_user_id,is_read,document_type,
      document_id,status,error_code
    FROM email_history
    WHERE user_id=? AND organization_id=?
      AND id NOT IN (SELECT email_id FROM email_deletions WHERE user_id=?)
    ORDER BY created_at DESC LIMIT 500`, [
    req.user.id,
    req.user.organization_id,
    req.user.id,
  ]));
});

router.post('/sync', async (req, res) => {
  try {
    const result = await syncMailboxForUser(req.user);
    if (result.skipped === 'not_configured') {
      return res.status(400).json({ error: 'Configuration messagerie requise' });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(502).json({
      error: error?.authenticationFailed ? 'Identifiants messagerie refusés' : 'Synchronisation messagerie impossible',
    });
  }
});

router.put('/:id/read', (req, res) => {
  const result = dbRun(`UPDATE email_history SET is_read=1
    WHERE id=? AND user_id=? AND organization_id=? AND direction='received'`, [
    req.params.id,
    req.user.id,
    req.user.organization_id,
  ]);
  if (!result.changes) return res.status(404).json({ error: 'Email introuvable' });
  return res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const row = dbGet(`SELECT id FROM email_history
    WHERE id=? AND user_id=? AND organization_id=?`, [
    req.params.id,
    req.user.id,
    req.user.organization_id,
  ]);
  if (!row) return res.status(404).json({ error: 'Email introuvable' });
  dbRun(`INSERT INTO email_deletions(email_id,user_id,created_at)
    VALUES (?,?,datetime('now')) ON CONFLICT(email_id,user_id) DO NOTHING`, [
    req.params.id,
    req.user.id,
  ]);
  dbRun('DELETE FROM email_history WHERE id=? AND user_id=? AND organization_id=?', [
    req.params.id,
    req.user.id,
    req.user.organization_id,
  ]);
  return res.json({ success: true });
});

router.get('/users', (req, res) => {
  res.json(dbQuery(`SELECT id,username,full_name,email,role
    FROM users WHERE active=1 AND organization_id=? AND email IS NOT NULL AND email!=''
    ORDER BY username`, [req.user.organization_id]));
});

export default router;
