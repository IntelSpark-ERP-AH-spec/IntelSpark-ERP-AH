import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbQuery, dbRun, dbTransaction } from './db.js';
import { VALID_ROLES } from './auth.js';
import { decryptSecret, encryptSecret, isEncryptedSecret, upgradeSecret } from './secrets.js';
import { mailboxBoundary } from './mail-connection.js';

export const EMAIL_ACCOUNT_TYPES = new Set(['personal', 'organization', 'shared']);
export const EMAIL_DOCUMENT_TYPES = new Set(['DEV', 'FACT', 'BL', 'BC', 'AVOIR', 'RELANCE', 'RH']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nowSql() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function normalizedEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new Error('Adresse Gmail invalide');
  return email;
}

function integerFlag(value, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

export function parseAllowedDocumentTypes(value) {
  let values = value;
  if (typeof value === 'string') {
    try { values = JSON.parse(value); } catch { values = value.split(','); }
  }
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map(item => String(item || '').trim().toUpperCase())
    .filter(item => EMAIL_DOCUMENT_TYPES.has(item)))];
}

function safeAccount(row, access = {}) {
  if (!row) return null;
  return {
    id: row.id,
    organization_id: row.organization_id,
    user_id: row.user_id || null,
    account_type: row.account_type,
    email_address: row.email_address,
    sender_name: row.sender_name || '',
    is_active: Boolean(row.is_active),
    is_default: Boolean(row.is_default),
    smtp_enabled: Boolean(row.smtp_enabled),
    imap_enabled: Boolean(row.imap_enabled),
    configured: Boolean(row.encrypted_app_password),
    mail_connected_at: row.mail_connected_at || null,
    mail_last_sync_at: row.mail_last_sync_at || null,
    last_test_status: row.last_test_status || null,
    last_test_at: row.last_test_at || null,
    can_send: Boolean(access.can_send),
    can_read: Boolean(access.can_read),
    allowed_document_types: access.allowed_document_types || [],
  };
}

function accountRow(accountId, organizationId) {
  return dbGet(
    'SELECT * FROM email_accounts WHERE id=? AND organization_id=?',
    [accountId, organizationId],
  );
}

function permissionsForAccount(accountId) {
  return dbQuery(
    `SELECT id,email_account_id,user_id,role_name,can_send,can_read,allowed_document_types
     FROM email_account_permissions WHERE email_account_id=?`,
    [accountId],
  ).map(row => ({
    ...row,
    can_send: Boolean(row.can_send),
    can_read: Boolean(row.can_read),
    allowed_document_types: parseAllowedDocumentTypes(row.allowed_document_types),
  }));
}

function accessForAccount(user, account) {
  if (!account || String(account.organization_id) !== String(user.organization_id)) {
    return { can_send: false, can_read: false, allowed_document_types: [] };
  }
  if (account.account_type === 'personal') {
    const owner = String(account.user_id) === String(user.id);
    return { can_send: owner, can_read: owner, allowed_document_types: [] };
  }
  if (user.role === 'admin') {
    return { can_send: true, can_read: true, allowed_document_types: [] };
  }
  const matching = permissionsForAccount(account.id).filter(permission => (
    (permission.user_id && String(permission.user_id) === String(user.id))
    || (permission.role_name && permission.role_name === user.role)
  ));
  const sendPermissions = matching.filter(permission => permission.can_send);
  const unrestrictedSend = sendPermissions.some(permission => permission.allowed_document_types.length === 0);
  return {
    can_send: sendPermissions.length > 0,
    can_read: matching.some(permission => permission.can_read),
    allowed_document_types: unrestrictedSend
      ? []
      : [...new Set(sendPermissions.flatMap(permission => permission.allowed_document_types))],
  };
}

function documentAllowed(access, documentType) {
  const normalized = String(documentType || '').trim().toUpperCase();
  if (!normalized) return true;
  if (!EMAIL_DOCUMENT_TYPES.has(normalized)) return false;
  return access.allowed_document_types.length === 0 || access.allowed_document_types.includes(normalized);
}

export function listAvailableEmailAccounts(user) {
  const rows = dbQuery(
    `SELECT * FROM email_accounts
     WHERE organization_id=? AND is_active=1
       AND (user_id=? OR account_type IN ('organization','shared'))
     ORDER BY CASE account_type WHEN 'personal' THEN 0 WHEN 'organization' THEN 1 ELSE 2 END,
       is_default DESC,email_address`,
    [user.organization_id, user.id],
  );
  const preference = dbGet(
    'SELECT default_account_id FROM email_account_preferences WHERE user_id=? AND organization_id=?',
    [user.id, user.organization_id],
  );
  return rows
    .map(row => {
      const access = accessForAccount(user, row);
      return safeAccount(row, access);
    })
    .filter(account => account.can_send || account.can_read)
    .map(account => ({
      ...account,
      selected_by_default: String(preference?.default_account_id || '') === String(account.id),
    }));
}

export function getPersonalEmailAccount(user) {
  const row = dbGet(
    `SELECT * FROM email_accounts
     WHERE organization_id=? AND user_id=? AND account_type='personal'`,
    [user.organization_id, user.id],
  );
  return safeAccount(row, row ? { can_send: true, can_read: true, allowed_document_types: [] } : {});
}

export function getOrganizationEmailAccounts(user) {
  if (user.role !== 'admin') throw Object.assign(new Error('Accès administrateur requis'), { status: 403 });
  return dbQuery(
    `SELECT * FROM email_accounts
     WHERE organization_id=? AND account_type IN ('organization','shared')
     ORDER BY is_default DESC,email_address`,
    [user.organization_id],
  ).map(row => ({
    ...safeAccount(row, { can_send: true, can_read: true, allowed_document_types: [] }),
    permissions: permissionsForAccount(row.id),
  }));
}

export function getOrganizationEmailAccountForAdmin(user, accountId) {
  if (user.role !== 'admin') {
    throw Object.assign(new Error('Accès administrateur requis'), { status: 403 });
  }
  const account = accountRow(accountId, user.organization_id);
  if (!account || account.account_type === 'personal') {
    throw Object.assign(new Error('Compte partagé introuvable'), { status: 404 });
  }
  return account;
}

export function decryptedPasswordForAccount(account) {
  if (!account?.encrypted_app_password) return '';
  if (!isEncryptedSecret(account.encrypted_app_password)) {
    const encrypted = upgradeSecret(account.encrypted_app_password);
    dbRun('UPDATE email_accounts SET encrypted_app_password=?,updated_at=? WHERE id=?', [
      encrypted,
      nowSql(),
      account.id,
    ]);
    account.encrypted_app_password = encrypted;
  }
  return decryptSecret(account.encrypted_app_password);
}

export function resolveAuthorizedEmailAccount(user, requestedAccountId, action = 'send', documentType = '') {
  const accounts = listAvailableEmailAccounts(user);
  const allowed = account => (
    account.is_active
    && (action === 'read' ? account.can_read : account.can_send)
    && documentAllowed(account, documentType)
  );

  if (requestedAccountId) {
    const selected = accounts.find(account => String(account.id) === String(requestedAccountId));
    if (!selected || !allowed(selected)) {
      throw Object.assign(new Error('Compte Gmail non autorisé'), { status: 403, code: 'EMAIL_ACCOUNT_FORBIDDEN' });
    }
    return accountRow(selected.id, user.organization_id);
  }

  const preferred = accounts.find(account => account.selected_by_default && allowed(account));
  const personal = accounts.find(account => account.account_type === 'personal' && allowed(account));
  const organizationDefault = accounts.find(account => account.account_type !== 'personal' && account.is_default && allowed(account));
  const fallback = accounts.find(allowed);
  const selected = preferred || personal || organizationDefault || fallback;
  if (!selected) {
    throw Object.assign(new Error('Aucun compte Gmail autorisé'), { status: 400, code: 'EMAIL_ACCOUNT_REQUIRED' });
  }
  return accountRow(selected.id, user.organization_id);
}

export async function testEmailCredentials({
  emailAddress,
  password,
  smtpEnabled = true,
  imapEnabled = true,
  smtpVerify = null,
  imapBoundary = mailboxBoundary,
}) {
  let normalized;
  const secret = String(password || '').replace(/\s+/g, '');
  try { normalized = normalizedEmail(emailAddress); } catch {
    return { status: 'configuration_incomplete' };
  }
  if (!secret || (!smtpEnabled && !imapEnabled)) return { status: 'configuration_incomplete' };

  let boundary = null;
  if (smtpEnabled) {
    if (smtpVerify) {
      try {
        await smtpVerify(normalized, secret);
      } catch (error) {
        const code = String(error?.code || '').toUpperCase();
        if (code === 'EAUTH' || Number(error?.responseCode) === 535) return { status: 'refused' };
        return { status: 'smtp_unavailable' };
      }
    } else {
      const port = Number.parseInt(process.env.SMTP_PORT || '465', 10);
      const transporter = nodemailer.createTransport({
        host: String(process.env.SMTP_HOST || 'smtp.gmail.com').trim(),
        port: Number.isInteger(port) ? port : 465,
        secure: port === 465,
        auth: { user: normalized, pass: secret },
        connectionTimeout: 20_000,
        greetingTimeout: 20_000,
        socketTimeout: 45_000,
      });
      try {
        await transporter.verify();
      } catch (error) {
        const code = String(error?.code || '').toUpperCase();
        if (code === 'EAUTH' || Number(error?.responseCode) === 535) return { status: 'refused' };
        return { status: 'smtp_unavailable' };
      } finally {
        transporter.close();
      }
    }
  }

  if (imapEnabled) {
    try {
      boundary = await imapBoundary(normalized, secret);
    } catch (error) {
      if (error?.authenticationFailed || error?.responseStatus === 'NO') return { status: 'refused' };
      return { status: 'imap_unavailable' };
    }
  }
  return { status: 'connected', boundary };
}

export async function savePersonalEmailAccount(user, input) {
  const existing = dbGet(
    `SELECT * FROM email_accounts
     WHERE organization_id=? AND user_id=? AND account_type='personal'`,
    [user.organization_id, user.id],
  );
  const emailAddress = normalizedEmail(input.email_address || input.smtp_user || existing?.email_address);
  const suppliedPassword = String(input.app_password || input.smtp_pass || '').replace(/\s+/g, '');
  const password = suppliedPassword || decryptedPasswordForAccount(existing);
  const smtpEnabled = integerFlag(input.smtp_enabled, existing?.smtp_enabled ?? 1);
  const imapEnabled = integerFlag(input.imap_enabled, existing?.imap_enabled ?? 1);
  const test = await testEmailCredentials({ emailAddress, password, smtpEnabled, imapEnabled });
  if (test.status !== 'connected') return test;

  const id = existing?.id || uuidv4();
  const encrypted = encryptSecret(password);
  const timestamp = nowSql();
  const senderName = String(input.sender_name ?? existing?.sender_name ?? user.full_name ?? user.username ?? '').trim().slice(0, 160);
  const isDefault = integerFlag(input.is_default, existing?.is_default ?? 1);
  dbTransaction(() => {
    if (existing) {
      dbRun(`UPDATE email_accounts SET email_address=?,encrypted_app_password=?,sender_name=?,
        is_active=1,is_default=?,smtp_enabled=?,imap_enabled=?,mail_connected_at=?,
        mail_last_uid=?,mail_uid_validity=?,last_test_status='connected',last_test_at=?,
        updated_by=?,updated_at=? WHERE id=? AND organization_id=? AND user_id=?`, [
        emailAddress,
        encrypted,
        senderName,
        isDefault,
        smtpEnabled,
        imapEnabled,
        test.boundary?.connected_at || existing.mail_connected_at || timestamp,
        test.boundary?.last_uid ?? existing.mail_last_uid ?? 0,
        test.boundary?.uid_validity || existing.mail_uid_validity || null,
        timestamp,
        user.id,
        timestamp,
        id,
        user.organization_id,
        user.id,
      ]);
    } else {
      dbRun(`INSERT INTO email_accounts
        (id,organization_id,user_id,account_type,email_address,encrypted_app_password,sender_name,
         is_active,is_default,smtp_enabled,imap_enabled,mail_connected_at,mail_last_uid,
         mail_uid_validity,last_test_status,last_test_at,created_by,updated_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        id,
        user.organization_id,
        user.id,
        'personal',
        emailAddress,
        encrypted,
        senderName,
        1,
        isDefault,
        smtpEnabled,
        imapEnabled,
        test.boundary?.connected_at || timestamp,
        test.boundary?.last_uid || 0,
        test.boundary?.uid_validity || null,
        'connected',
        timestamp,
        user.id,
        user.id,
        timestamp,
        timestamp,
      ]);
    }
    dbRun(`INSERT INTO email_account_preferences(user_id,organization_id,default_account_id,updated_at)
      VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET organization_id=excluded.organization_id,
        default_account_id=excluded.default_account_id,updated_at=excluded.updated_at`, [
      user.id,
      user.organization_id,
      isDefault ? id : null,
      timestamp,
    ]);
    dbRun(`UPDATE users SET smtp_user=?,smtp_pass=?,mail_connected_at=?,mail_last_uid=?,
      mail_uid_validity=?,mail_last_sync_at=NULL WHERE id=? AND organization_id=?`, [
      emailAddress,
      encrypted,
      test.boundary?.connected_at || timestamp,
      test.boundary?.last_uid || 0,
      test.boundary?.uid_validity || null,
      user.id,
      user.organization_id,
    ]);
  });
  return { status: 'connected', account: getPersonalEmailAccount(user) };
}

export function deletePersonalEmailAccount(user) {
  const account = dbGet(
    `SELECT id FROM email_accounts
     WHERE organization_id=? AND user_id=? AND account_type='personal'`,
    [user.organization_id, user.id],
  );
  dbTransaction(() => {
    if (account) dbRun('DELETE FROM email_accounts WHERE id=? AND organization_id=? AND user_id=?', [
      account.id,
      user.organization_id,
      user.id,
    ]);
    dbRun('DELETE FROM email_account_preferences WHERE user_id=? AND organization_id=?', [
      user.id,
      user.organization_id,
    ]);
    dbRun(`UPDATE users SET smtp_user='',smtp_pass='',mail_connected_at=NULL,mail_last_uid=0,
      mail_uid_validity=NULL,mail_last_sync_at=NULL WHERE id=? AND organization_id=?`, [
      user.id,
      user.organization_id,
    ]);
  });
  return Boolean(account);
}

export function setDefaultEmailAccount(user, accountId) {
  const account = resolveAuthorizedEmailAccount(user, accountId, 'send');
  const timestamp = nowSql();
  dbRun(`INSERT INTO email_account_preferences(user_id,organization_id,default_account_id,updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET organization_id=excluded.organization_id,
      default_account_id=excluded.default_account_id,updated_at=excluded.updated_at`, [
    user.id,
    user.organization_id,
    account.id,
    timestamp,
  ]);
  return account.id;
}

export async function saveOrganizationEmailAccount(user, input, accountId = null) {
  if (user.role !== 'admin') throw Object.assign(new Error('Accès administrateur requis'), { status: 403 });
  const existing = accountId ? accountRow(accountId, user.organization_id) : null;
  if (existing?.account_type === 'personal') {
    throw Object.assign(new Error('Compte personnel non modifiable ici'), { status: 403 });
  }
  const accountType = String(input.account_type || existing?.account_type || 'organization');
  if (!['organization', 'shared'].includes(accountType)) throw new Error('Type compte invalide');
  const emailAddress = normalizedEmail(input.email_address || existing?.email_address);
  const suppliedPassword = String(input.app_password || '').replace(/\s+/g, '');
  const password = suppliedPassword || decryptedPasswordForAccount(existing);
  if (!password) return { status: 'configuration_incomplete' };
  const smtpEnabled = integerFlag(input.smtp_enabled, existing?.smtp_enabled ?? 1);
  const imapEnabled = integerFlag(input.imap_enabled, existing?.imap_enabled ?? 1);
  const shouldTest = !existing || suppliedPassword || emailAddress !== existing.email_address;
  const test = shouldTest
    ? await testEmailCredentials({ emailAddress, password, smtpEnabled, imapEnabled })
    : { status: existing.last_test_status || 'connected', boundary: null };
  if (shouldTest && test.status !== 'connected') return test;

  const id = existing?.id || uuidv4();
  const timestamp = nowSql();
  const senderName = String(input.sender_name ?? existing?.sender_name ?? '').trim().slice(0, 160);
  const isActive = integerFlag(input.is_active, existing?.is_active ?? 1);
  const isDefault = integerFlag(input.is_default, existing?.is_default ?? 0);
  const encrypted = encryptSecret(password);

  dbTransaction(() => {
    if (isDefault) {
      dbRun(`UPDATE email_accounts SET is_default=0,updated_at=?
        WHERE organization_id=? AND account_type IN ('organization','shared') AND id!=?`, [
        timestamp,
        user.organization_id,
        id,
      ]);
    }
    if (existing) {
      dbRun(`UPDATE email_accounts SET account_type=?,email_address=?,encrypted_app_password=?,
        sender_name=?,is_active=?,is_default=?,smtp_enabled=?,imap_enabled=?,
        mail_connected_at=COALESCE(?,mail_connected_at),mail_last_uid=COALESCE(?,mail_last_uid),
        mail_uid_validity=COALESCE(?,mail_uid_validity),last_test_status=?,last_test_at=?,
        updated_by=?,updated_at=? WHERE id=? AND organization_id=?`, [
        accountType,
        emailAddress,
        encrypted,
        senderName,
        isActive,
        isDefault,
        smtpEnabled,
        imapEnabled,
        test.boundary?.connected_at || null,
        test.boundary?.last_uid ?? null,
        test.boundary?.uid_validity || null,
        test.status,
        shouldTest ? timestamp : existing.last_test_at,
        user.id,
        timestamp,
        id,
        user.organization_id,
      ]);
    } else {
      dbRun(`INSERT INTO email_accounts
        (id,organization_id,user_id,account_type,email_address,encrypted_app_password,sender_name,
         is_active,is_default,smtp_enabled,imap_enabled,mail_connected_at,mail_last_uid,
         mail_uid_validity,last_test_status,last_test_at,created_by,updated_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        id,
        user.organization_id,
        null,
        accountType,
        emailAddress,
        encrypted,
        senderName,
        isActive,
        isDefault,
        smtpEnabled,
        imapEnabled,
        test.boundary?.connected_at || timestamp,
        test.boundary?.last_uid || 0,
        test.boundary?.uid_validity || null,
        test.status,
        timestamp,
        user.id,
        user.id,
        timestamp,
        timestamp,
      ]);
    }
  });
  return { status: test.status, account: getOrganizationEmailAccounts(user).find(item => item.id === id) };
}

export function replaceEmailAccountPermissions(user, accountId, inputPermissions) {
  if (user.role !== 'admin') throw Object.assign(new Error('Accès administrateur requis'), { status: 403 });
  const account = accountRow(accountId, user.organization_id);
  if (!account || account.account_type === 'personal') throw Object.assign(new Error('Compte partagé introuvable'), { status: 404 });
  const permissions = Array.isArray(inputPermissions) ? inputPermissions : [];
  const normalized = permissions.map(permission => {
    const userId = permission.user_id ? String(permission.user_id) : null;
    const roleName = permission.role_name ? String(permission.role_name) : null;
    if ((userId && roleName) || (!userId && !roleName)) throw new Error('Permission utilisateur ou rôle requise');
    if (roleName && !VALID_ROLES.includes(roleName)) throw new Error('Rôle invalide');
    if (userId) {
      const target = dbGet('SELECT id FROM users WHERE id=? AND organization_id=? AND active=1', [
        userId,
        user.organization_id,
      ]);
      if (!target) throw new Error('Utilisateur autorisé introuvable');
    }
    return {
      id: uuidv4(),
      user_id: userId,
      role_name: roleName,
      can_send: integerFlag(permission.can_send),
      can_read: integerFlag(permission.can_read),
      allowed_document_types: JSON.stringify(parseAllowedDocumentTypes(permission.allowed_document_types)),
    };
  });
  const timestamp = nowSql();
  dbTransaction(() => {
    dbRun('DELETE FROM email_account_permissions WHERE email_account_id=?', [account.id]);
    for (const permission of normalized) {
      dbRun(`INSERT INTO email_account_permissions
        (id,email_account_id,user_id,role_name,can_send,can_read,allowed_document_types,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)`, [
        permission.id,
        account.id,
        permission.user_id,
        permission.role_name,
        permission.can_send,
        permission.can_read,
        permission.allowed_document_types,
        timestamp,
        timestamp,
      ]);
    }
  });
  return permissionsForAccount(account.id);
}

export function deleteOrganizationEmailAccount(user, accountId) {
  if (user.role !== 'admin') throw Object.assign(new Error('Accès administrateur requis'), { status: 403 });
  const result = dbRun(`DELETE FROM email_accounts
    WHERE id=? AND organization_id=? AND account_type IN ('organization','shared')`, [
    accountId,
    user.organization_id,
  ]);
  return Boolean(result.changes);
}

export function readersForAccount(account) {
  if (account.account_type === 'personal') {
    return account.user_id ? [String(account.user_id)] : [];
  }
  const permissions = permissionsForAccount(account.id).filter(permission => permission.can_read);
  const roleNames = permissions.filter(permission => permission.role_name).map(permission => permission.role_name);
  const userIds = permissions.filter(permission => permission.user_id).map(permission => String(permission.user_id));
  const rows = dbQuery(
    `SELECT id FROM users WHERE organization_id=? AND active=1
      AND (role='admin' OR role IN (${roleNames.length ? roleNames.map(() => '?').join(',') : "''"}))`,
    [account.organization_id, ...roleNames],
  );
  return [...new Set([...userIds, ...rows.map(row => String(row.id))])];
}

export function listSyncableEmailAccounts() {
  return dbQuery(`SELECT * FROM email_accounts
    WHERE is_active=1 AND imap_enabled=1 AND encrypted_app_password IS NOT NULL
      AND encrypted_app_password!='' AND mail_connected_at IS NOT NULL`);
}

export function accountForSync(accountId) {
  return dbGet(`SELECT * FROM email_accounts
    WHERE id=? AND is_active=1 AND imap_enabled=1`, [accountId]);
}
