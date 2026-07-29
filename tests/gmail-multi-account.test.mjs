import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const databasePath = path.join(os.tmpdir(), `intelspark-gmail-${process.pid}-${Date.now()}.db`);
delete process.env.DATABASE_URL;
process.env.DB_PATH = databasePath;
process.env.JWT_SECRET = 'test-jwt-secret-with-more-than-thirty-two-characters';
process.env.DATA_ENCRYPTION_KEY = 'test-email-key-with-more-than-thirty-two-characters';
process.env.ADMIN_PASSWORD = 'Admin-Test-Only-2026!';

const database = await import('../backend/db.js');
const secrets = await import('../backend/secrets.js');
const service = await import('../backend/email-account-service.js');

database.initDB();

const orgA = 'gmail-org-a';
const orgB = 'gmail-org-b';
const admin = { id: 'gmail-admin', username: 'gmail_admin', full_name: 'Admin Gmail', role: 'admin', organization_id: orgA };
const commercial = { id: 'gmail-commercial', username: 'gmail_commercial', full_name: 'Commercial Gmail', role: 'commercial', organization_id: orgA };
const comptable = { id: 'gmail-comptable', username: 'gmail_comptable', full_name: 'Comptable Gmail', role: 'comptable', organization_id: orgA };
const outsider = { id: 'gmail-outsider', username: 'gmail_outsider', full_name: 'Autre entreprise', role: 'admin', organization_id: orgB };
const encrypted = secrets.encryptSecret('fake-google-app-password');
const now = '2026-07-29 19:00:00';

function insertAccount({
  id,
  organizationId = orgA,
  userId = null,
  type = 'shared',
  email,
  active = 1,
  defaultAccount = 0,
}) {
  database.dbRun(`INSERT INTO email_accounts
    (id,organization_id,user_id,account_type,email_address,encrypted_app_password,sender_name,
     is_active,is_default,smtp_enabled,imap_enabled,mail_connected_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,1,1,?,?,?)`, [
    id,
    organizationId,
    userId,
    type,
    email,
    encrypted,
    `Expéditeur ${id}`,
    active,
    defaultAccount,
    now,
    now,
    now,
  ]);
}

function insertPermission({
  id,
  accountId,
  userId = null,
  roleName = null,
  send = 0,
  read = 0,
  documents = [],
}) {
  database.dbRun(`INSERT INTO email_account_permissions
    (id,email_account_id,user_id,role_name,can_send,can_read,allowed_document_types,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`, [
    id,
    accountId,
    userId,
    roleName,
    send,
    read,
    JSON.stringify(documents),
    now,
    now,
  ]);
}

test('architecture Gmail multi-utilisateur sécurisée', async t => {
  database.dbRun('INSERT OR IGNORE INTO organizations(id,name,realtime_topic) VALUES (?,?,?)', [orgA, 'Gmail A', 'gmail-a']);
  database.dbRun('INSERT OR IGNORE INTO organizations(id,name,realtime_topic) VALUES (?,?,?)', [orgB, 'Gmail B', 'gmail-b']);
  for (const user of [admin, commercial, comptable, outsider]) {
    database.dbRun(`INSERT INTO users
      (id,username,password,role,email,full_name,active,organization_id)
      VALUES (?,?,?,?,?,?,1,?)`, [
      user.id,
      user.username,
      'not-used-in-service-tests',
      user.role,
      `${user.username}@example.com`,
      user.full_name,
      user.organization_id,
    ]);
  }

  insertAccount({
    id: 'personal-commercial',
    userId: commercial.id,
    type: 'personal',
    email: 'commercial@gmail.com',
    defaultAccount: 1,
  });
  insertAccount({
    id: 'personal-comptable',
    userId: comptable.id,
    type: 'personal',
    email: 'comptable@gmail.com',
  });
  insertAccount({
    id: 'shared-company',
    type: 'organization',
    email: 'contact@gmail.com',
    defaultAccount: 1,
  });
  insertAccount({
    id: 'shared-disabled',
    type: 'shared',
    email: 'disabled@gmail.com',
    active: 0,
  });
  insertAccount({
    id: 'shared-other-org',
    organizationId: orgB,
    type: 'organization',
    email: 'other@gmail.com',
  });
  insertPermission({
    id: 'perm-commercial',
    accountId: 'shared-company',
    roleName: 'commercial',
    send: 1,
    read: 1,
    documents: ['DEV', 'FACT'],
  });
  insertPermission({
    id: 'perm-comptable-user',
    accountId: 'shared-company',
    userId: comptable.id,
    send: 1,
    documents: [],
  });
  database.dbRun(`INSERT INTO email_account_preferences
    (user_id,organization_id,default_account_id,updated_at) VALUES (?,?,?,?)`, [
    commercial.id,
    orgA,
    'personal-commercial',
    now,
  ]);

  await t.test('01 tables dédiées présentes', () => {
    for (const table of ['email_accounts', 'email_account_permissions', 'email_account_preferences']) {
      assert.ok(database.dbGet(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [table]));
    }
  });

  await t.test('02 secret chiffré', () => {
    const row = database.dbGet('SELECT encrypted_app_password FROM email_accounts WHERE id=?', ['personal-commercial']);
    assert.equal(secrets.isEncryptedSecret(row.encrypted_app_password), true);
    assert.equal(row.encrypted_app_password.includes('fake-google-app-password'), false);
  });

  await t.test('03 secret jamais retourné', () => {
    const account = service.getPersonalEmailAccount(commercial);
    assert.equal(account.configured, true);
    assert.equal('encrypted_app_password' in account, false);
    assert.equal('app_password' in account, false);
  });

  await t.test('04 propriétaire accède Gmail personnel', () => {
    const account = service.resolveAuthorizedEmailAccount(commercial, 'personal-commercial', 'send');
    assert.equal(account.email_address, 'commercial@gmail.com');
  });

  await t.test('05 autre utilisateur refusé', () => {
    assert.throws(
      () => service.resolveAuthorizedEmailAccount(comptable, 'personal-commercial', 'send'),
      /non autorisé/,
    );
  });

  await t.test('06 deux Gmail personnels isolés', () => {
    assert.equal(service.getPersonalEmailAccount(commercial).email_address, 'commercial@gmail.com');
    assert.equal(service.getPersonalEmailAccount(comptable).email_address, 'comptable@gmail.com');
  });

  await t.test('07 rôle autorisé utilise Gmail commun', () => {
    const accounts = service.listAvailableEmailAccounts(commercial);
    assert.ok(accounts.some(account => account.id === 'shared-company' && account.can_send));
  });

  await t.test('08 utilisateur non autorisé refusé', () => {
    const unauthorized = { ...comptable, id: admin.id, role: 'comptable' };
    assert.throws(
      () => service.resolveAuthorizedEmailAccount(unauthorized, 'shared-company', 'send'),
      /non autorisé/,
    );
  });

  await t.test('09 administrateur gère Gmail commun', () => {
    const accounts = service.getOrganizationEmailAccounts(admin);
    assert.ok(accounts.some(account => account.id === 'shared-company'));
  });

  await t.test('10 devis autorisé', () => {
    assert.equal(
      service.resolveAuthorizedEmailAccount(commercial, 'shared-company', 'send', 'DEV').id,
      'shared-company',
    );
  });

  await t.test('11 document RH refusé', () => {
    assert.throws(
      () => service.resolveAuthorizedEmailAccount(commercial, 'shared-company', 'send', 'RH'),
      /non autorisé/,
    );
  });

  await t.test('12 permission vide autorise tous documents', () => {
    assert.equal(
      service.resolveAuthorizedEmailAccount(comptable, 'shared-company', 'send', 'RH').id,
      'shared-company',
    );
  });

  await t.test('13 permission utilisateur fonctionne', () => {
    const account = service.listAvailableEmailAccounts(comptable).find(item => item.id === 'shared-company');
    assert.equal(account.can_send, true);
  });

  await t.test('14 organisations strictement isolées', () => {
    assert.equal(service.listAvailableEmailAccounts(commercial).some(account => account.organization_id === orgB), false);
    assert.equal(service.getOrganizationEmailAccounts(outsider).some(account => account.organization_id === orgA), false);
  });

  await t.test('15 Gmail personnel choisi par défaut', () => {
    assert.equal(service.resolveAuthorizedEmailAccount(commercial, null, 'send', 'DEV').id, 'personal-commercial');
  });

  await t.test('16 préférence Gmail commun enregistrée', () => {
    service.setDefaultEmailAccount(commercial, 'shared-company');
    assert.equal(service.resolveAuthorizedEmailAccount(commercial, null, 'send', 'DEV').id, 'shared-company');
  });

  await t.test('17 Gmail désactivé masqué', () => {
    assert.equal(service.listAvailableEmailAccounts(admin).some(account => account.id === 'shared-disabled'), false);
  });

  await t.test('18 suppression personnelle ciblée', () => {
    assert.equal(service.deletePersonalEmailAccount(commercial), true);
    assert.equal(service.getPersonalEmailAccount(commercial), null);
    assert.equal(service.getPersonalEmailAccount(comptable).email_address, 'comptable@gmail.com');
  });

  await t.test('19 configuration incomplète sécurisée', async () => {
    const result = await service.testEmailCredentials({ emailAddress: '', password: '' });
    assert.equal(result.status, 'configuration_incomplete');
  });

  await t.test('20 identifiants refusés simplifiés', async () => {
    const result = await service.testEmailCredentials({
      emailAddress: 'test@gmail.com',
      password: 'fake',
      imapEnabled: false,
      smtpVerify: async () => { throw Object.assign(new Error('private technical detail'), { code: 'EAUTH' }); },
    });
    assert.deepEqual(result, { status: 'refused' });
  });

  await t.test('21 SMTP indisponible simplifié', async () => {
    const result = await service.testEmailCredentials({
      emailAddress: 'test@gmail.com',
      password: 'fake',
      imapEnabled: false,
      smtpVerify: async () => { throw Object.assign(new Error('network'), { code: 'ETIMEDOUT' }); },
    });
    assert.deepEqual(result, { status: 'smtp_unavailable' });
  });

  await t.test('22 IMAP indisponible simplifié', async () => {
    const result = await service.testEmailCredentials({
      emailAddress: 'test@gmail.com',
      password: 'fake',
      smtpEnabled: false,
      imapBoundary: async () => { throw Object.assign(new Error('network'), { code: 'ETIMEDOUT' }); },
    });
    assert.deepEqual(result, { status: 'imap_unavailable' });
  });

  await t.test('23 SMTP et IMAP validés', async () => {
    const boundary = { uid_validity: '1', last_uid: 10, connected_at: now };
    const result = await service.testEmailCredentials({
      emailAddress: 'test@gmail.com',
      password: 'fake',
      smtpVerify: async () => true,
      imapBoundary: async () => boundary,
    });
    assert.deepEqual(result, { status: 'connected', boundary });
  });

  await t.test('24 mot passe absent historique API', () => {
    const exposed = JSON.stringify(service.listAvailableEmailAccounts(comptable));
    assert.equal(exposed.includes('fake-google-app-password'), false);
    assert.equal(exposed.includes('encrypted_app_password'), false);
  });
});

test.after(() => {
  database.closeDB();
  for (const suffix of ['', '-wal', '-shm']) {
    const target = `${databasePath}${suffix}`;
    if (fs.existsSync(target)) fs.rmSync(target, { force: true });
  }
});
