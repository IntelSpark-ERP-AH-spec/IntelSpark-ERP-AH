import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function availablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForReady(baseUrl, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Serveur termine: ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/ready`);
      if (response.status === 200) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Readiness indisponible');
}

function websocketAuthenticate(url, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin: 'https://erp.test' });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket timeout'));
    }, 5000);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'auth_ok') {
        clearTimeout(timer);
        socket.close();
        resolve(message);
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function openAuthenticatedSocket(url, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin: 'https://erp.test' });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket capacity timeout'));
    }, 10_000);
    socket.once('open', () => socket.send(JSON.stringify({ type: 'auth', token })));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'auth_ok') {
        clearTimeout(timer);
        resolve(socket);
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForSocketMessage(socket, type, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`WebSocket event timeout: ${type}`));
    }, 5000);
    function onMessage(raw) {
      const message = JSON.parse(raw.toString());
      if (message.type !== type || !predicate(message)) return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(message);
    }
    socket.on('message', onMessage);
  });
}

test('production server supports one hundred authenticated users', { timeout: 60_000 }, async () => {
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intelsheets-runtime-'));
  const databasePath = path.join(runtimeDir, 'data', 'intelsheets.db');
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      JWT_SECRET: 'integration-jwt-secret-with-more-than-thirty-two-characters',
      DATA_ENCRYPTION_KEY: 'integration-data-key-with-more-than-thirty-two-characters',
      ADMIN_PASSWORD: 'Integration!Password2026',
      RESET_ADMIN_PASSWORD_ON_START: 'false',
      ALLOWED_ORIGINS: 'https://erp.test',
      FORCE_HTTPS: 'false',
      DB_PATH: databasePath,
      BACKUP_DIR: path.join(runtimeDir, 'backups'),
      MESSAGE_PDF_DIR: path.join(runtimeDir, 'message-pdfs'),
      METRICS_TOKEN: 'integration-metrics-token',
      GROQ_API_KEY: '',
    },
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    const readiness = await waitForReady(baseUrl, child);
    assert.equal(readiness.status, 'ready');

    const homepage = await fetch(`${baseUrl}/`);
    assert.equal(homepage.status, 200);
    const homepageHtml = await homepage.text();
    const csp = homepage.headers.get('content-security-policy') || '';
    const connectSrc = csp.match(/connect-src ([^;]+)/)?.[1] || '';
    const scriptNonce = csp.match(/nonce-([^' ;]+)/)?.[1] || '';
    assert.equal(homepage.headers.get('strict-transport-security'), 'max-age=63072000; includeSubDomains; preload');
    assert.equal(homepage.headers.get('x-powered-by'), null);
    assert.equal(homepage.headers.get('server'), null);
    assert.match(homepage.headers.get('permissions-policy') || '', /camera=\(\)/);
    assert.equal(connectSrc, "'self'");
    assert.doesNotMatch(connectSrc, /http:/);
    assert.doesNotMatch(csp.match(/script-src ([^;]+)/)?.[1] || '', /'self'/);
    assert.equal(scriptNonce.length > 0, true);
    assert.equal(homepageHtml.includes(`<script nonce="${scriptNonce}"`), true);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://erp.test' },
      body: JSON.stringify({ username: 'admin', password: 'Integration!Password2026' }),
    });
    assert.equal(login.status, 200, output);
    const session = await login.json();
    assert.equal(typeof session.token, 'string');
    const csrfToken = login.headers.get('set-cookie')?.match(/XSRF-TOKEN=([^;,]+)/)?.[1];
    assert.equal(typeof csrfToken, 'string');

    const profileHeaders = { authorization: `Bearer ${session.token}`, origin: 'https://erp.test' };
    const profiles = await Promise.all(Array.from({ length: 25 }, () => fetch(`${baseUrl}/api/auth/me`, { headers: profileHeaders })));
    assert.equal(profiles.every((response) => response.status === 200), true);
    assert.equal((await profiles[0].json()).username, 'admin');

    const writeHeaders = {
      ...profileHeaders,
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
      cookie: `XSRF-TOKEN=${csrfToken}`,
    };
    const createUser = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        username: 'provisioned.user',
        password: 'Provision!User2026',
        role: 'employe',
        department: 'operations',
        full_name: 'Utilisateur Provisionne',
      }),
    });
    assert.equal(createUser.status, 201);
    const provisionedUser = await createUser.json();
    assert.match(provisionedUser.id, /^[0-9a-f-]{36}$/i);

    const migrations = await fetch(`${baseUrl}/api/system/migrations`, { headers: profileHeaders });
    assert.equal(migrations.status, 200);
    const migrationRows = await migrations.json();
    assert.equal(migrationRows.length >= 4, true);
    assert.equal(migrationRows.every((migration) => migration.applied), true);
    const schemaProbe = new Database(databasePath, { readonly: true });
    const userColumns = schemaProbe.pragma('table_info(users)').map((column) => column.name);
    schemaProbe.close();
    assert.equal(userColumns.includes('twofa_secret'), false);
    assert.equal(userColumns.includes('twofa_enabled'), false);

    const siteAgentState = await fetch(`${baseUrl}/api/site-agent`, { headers: profileHeaders });
    assert.equal(siteAgentState.status, 200, output);
    const siteAgentStateBody = await siteAgentState.json();
    assert.equal(siteAgentStateBody.configured, false);
    assert.equal(typeof siteAgentStateBody.snapshot.users.active, 'number');
    assert.deepEqual(siteAgentStateBody.memory, []);
    assert.equal(siteAgentStateBody.autonomy.enabled, true);
    assert.equal(siteAgentStateBody.autonomy.interval_minutes, 5);
    assert.match(siteAgentStateBody.autonomy.last_heartbeat, /^\d{4}-\d{2}-\d{2}T/);

    const runAutonomy = await fetch(`${baseUrl}/api/site-agent/autonomy/run`, {
      method: 'POST', headers: writeHeaders, body: JSON.stringify({}),
    });
    assert.equal(runAutonomy.status, 200, output);
    const runAutonomyBody = await runAutonomy.json();
    assert.equal(runAutonomyBody.summary.enabled, true);
    assert.equal(typeof runAutonomyBody.summary.notifications, 'number');

    const pauseAutonomy = await fetch(`${baseUrl}/api/site-agent/autonomy`, {
      method: 'PUT', headers: writeHeaders, body: JSON.stringify({ enabled: false }),
    });
    assert.equal(pauseAutonomy.status, 200, output);
    assert.equal((await pauseAutonomy.json()).enabled, false);
    const pausedCycle = await fetch(`${baseUrl}/api/site-agent/autonomy/run`, {
      method: 'POST', headers: writeHeaders, body: JSON.stringify({}),
    });
    assert.equal((await pausedCycle.json()).summary.reason, 'disabled');
    const resumeAutonomy = await fetch(`${baseUrl}/api/site-agent/autonomy`, {
      method: 'PUT', headers: writeHeaders, body: JSON.stringify({ enabled: true }),
    });
    assert.equal(resumeAutonomy.status, 200, output);
    assert.equal((await resumeAutonomy.json()).enabled, true);

    const mailId = `test-mail-${randomUUID()}`;
    const mailProbe = new Database(databasePath);
    mailProbe.prepare(`UPDATE users SET smtp_user = ?, mail_connected_at = datetime('now') WHERE id = ?`)
      .run('admin@gmail.com', session.user.id);
    mailProbe.prepare(`INSERT INTO email_history
      (id, user_id, direction, correspondent, subject, body, sender_name, sender_email, account_email, is_read)
      VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?, 0)`)
      .run(mailId, session.user.id, 'expediteur@gmail.com', 'Sujet integration', 'Contenu complet integration',
        'Expediteur Test', 'expediteur@gmail.com', 'admin@gmail.com');
    mailProbe.close();

    const inbox = await fetch(`${baseUrl}/api/mail/history`, { headers: profileHeaders });
    assert.equal(inbox.status, 200, output);
    const inboxRows = await inbox.json();
    const receivedMail = inboxRows.find(mail => mail.id === mailId);
    assert.equal(receivedMail.sender_name, 'Expediteur Test');
    assert.equal(receivedMail.sender_email, 'expediteur@gmail.com');
    assert.equal(receivedMail.body, 'Contenu complet integration');
    assert.equal(receivedMail.is_read, 0);
    const readMail = await fetch(`${baseUrl}/api/mail/${mailId}/read`, {
      method: 'PUT', headers: writeHeaders, body: JSON.stringify({}),
    });
    assert.equal(readMail.status, 200, output);
    const inboxAfterRead = await fetch(`${baseUrl}/api/mail/history`, { headers: profileHeaders });
    assert.equal((await inboxAfterRead.json()).find(mail => mail.id === mailId).is_read, 1);

    const createAgentMemory = await fetch(`${baseUrl}/api/site-agent/memory`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ title: 'Règle test', content: 'Toujours vérifier les permissions côté API.' }),
    });
    assert.equal(createAgentMemory.status, 201, output);
    const agentMemory = await createAgentMemory.json();
    assert.equal(agentMemory.title, 'Règle test');

    const updateAgentMemory = await fetch(`${baseUrl}/api/site-agent/memory/${agentMemory.id}`, {
      method: 'PUT',
      headers: writeHeaders,
      body: JSON.stringify({ title: 'Règle test vérifiée', content: 'Toujours vérifier les permissions frontend et API.' }),
    });
    assert.equal(updateAgentMemory.status, 200, output);
    assert.equal((await updateAgentMemory.json()).title, 'Règle test vérifiée');

    const unconfiguredAgent = await fetch(`${baseUrl}/api/site-agent/message`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ prompt: 'Résume état du site.' }),
    });
    assert.equal(unconfiguredAgent.status, 503, output);

    const createPageAction = await fetch(`${baseUrl}/api/site-agent/actions`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        type: 'set_page_availability',
        payload: { page_id: 'stock', enabled: false },
        reason: 'Test désactivation supervisée.',
      }),
    });
    assert.equal(createPageAction.status, 201, output);
    const pageAction = await createPageAction.json();
    assert.equal(pageAction.status, 'proposed');
    assert.equal(pageAction.risk, 'high');

    const approvePageWithoutConfirmation = await fetch(`${baseUrl}/api/site-agent/actions/${pageAction.id}/approve`, {
      method: 'POST', headers: writeHeaders, body: JSON.stringify({}),
    });
    assert.equal(approvePageWithoutConfirmation.status, 400, output);

    const approvePageAction = await fetch(`${baseUrl}/api/site-agent/actions/${pageAction.id}/approve`, {
      method: 'POST', headers: writeHeaders, body: JSON.stringify({ confirmation: 'CONFIRMER' }),
    });
    assert.equal(approvePageAction.status, 200, output);
    const approvedPage = await approvePageAction.json();
    assert.equal(approvedPage.action.status, 'executed');
    assert.equal(approvedPage.result.disabled_pages.includes('stock'), true);

    const restorePageAction = await fetch(`${baseUrl}/api/site-agent/actions`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        type: 'set_page_availability',
        payload: { page_id: 'stock', enabled: true },
        reason: 'Restauration après test.',
      }),
    });
    const restorePage = await restorePageAction.json();
    const approveRestorePage = await fetch(`${baseUrl}/api/site-agent/actions/${restorePage.id}/approve`, {
      method: 'POST', headers: writeHeaders, body: JSON.stringify({ confirmation: 'CONFIRMER' }),
    });
    assert.equal(approveRestorePage.status, 200, output);
    assert.equal((await approveRestorePage.json()).result.disabled_pages.includes('stock'), false);

    const updateAnnouncement = await fetch(`${baseUrl}/api/system/config/system_announcement`, {
      method: 'PUT',
      headers: writeHeaders,
      body: JSON.stringify({ value: 'Maintenance planifiee vendredi' }),
    });
    assert.equal(updateAnnouncement.status, 200);
    const publicConfig = await fetch(`${baseUrl}/api/system/config/public`, { headers: profileHeaders });
    assert.equal(publicConfig.status, 200);
    assert.equal((await publicConfig.json()).some((item) => item.key === 'system_announcement' && item.value.includes('vendredi')), true);

    const createSchedule = await fetch(`${baseUrl}/api/echeancier`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        document_number: 'FACT-TEST-2026-001',
        source_devis_number: 'DEV-TEST-2026-001',
        party_type: 'client',
        party_name: 'Client échéancier',
        party_ice: '001122334455667',
        invoice_date: '2026-07-15',
        due_date: '2026-07-31',
        amount: 774,
        currency: 'MAD',
        paid: false,
      }),
    });
    assert.equal(createSchedule.status, 201, output);
    const scheduleRow = await createSchedule.json();
    assert.equal(scheduleRow.status, 'unpaid');
    assert.equal(scheduleRow.source_devis_number, 'DEV-TEST-2026-001');

    const scheduleList = await fetch(`${baseUrl}/api/echeancier`, { headers: profileHeaders });
    assert.equal(scheduleList.status, 200);
    assert.equal((await scheduleList.json()).some(row => row.document_number === 'FACT-TEST-2026-001'), true);

    const acknowledgeSchedule = await fetch(`${baseUrl}/api/echeancier/${scheduleRow.id}/acknowledge`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ phase: 'scheduled' }),
    });
    assert.equal(acknowledgeSchedule.status, 200, output);
    const acknowledgeScheduleBody = await acknowledgeSchedule.json();
    assert.equal(acknowledgeScheduleBody.acknowledged, true);
    assert.equal(acknowledgeScheduleBody.phase, 'scheduled');
    const acknowledgedScheduleList = await fetch(`${baseUrl}/api/echeancier`, { headers: profileHeaders });
    const acknowledgedScheduleRows = await acknowledgedScheduleList.json();
    assert.equal(acknowledgedScheduleRows.find(row => row.id === scheduleRow.id)?.scheduled_acknowledged, 1);
    assert.equal(acknowledgedScheduleRows.find(row => row.id === scheduleRow.id)?.due_acknowledged, 0);

    const paySchedule = await fetch(`${baseUrl}/api/echeancier/${scheduleRow.id}`, {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ paid: true }),
    });
    assert.equal(paySchedule.status, 200, output);
    assert.equal((await paySchedule.json()).status, 'paid');

    const plugins = await fetch(`${baseUrl}/api/plugins`, { headers: profileHeaders });
    assert.equal(plugins.status, 200);
    assert.equal((await plugins.json()).some((plugin) => plugin.id === 'system-insights'), true);
    const pluginSummary = await fetch(`${baseUrl}/api/plugins/system-insights/summary`, { headers: profileHeaders });
    assert.equal(pluginSummary.status, 200);
    assert.equal((await pluginSummary.json()).migrations_applied >= 4, true);

    const writes = await Promise.all(['premier', 'second'].map((writer) => fetch(`${baseUrl}/api/data/team/concurrency_probe`, {
      method: 'PUT',
      headers: writeHeaders,
      body: JSON.stringify({ value: { writer }, expected_version: 0 }),
    })));
    assert.deepEqual(writes.map((response) => response.status).sort(), [200, 409]);

    const websocket = await websocketAuthenticate(`ws://127.0.0.1:${port}/ws`, session.token);
    assert.equal(websocket.type, 'auth_ok');

    const capacityUsers = Array.from({ length: 100 }, (_, index) => ({
      id: randomUUID(),
      username: `capacity_user_${String(index + 1).padStart(3, '0')}`,
      role: 'employe',
    }));
    const stockRoleUsers = [
      { id: randomUUID(), username: 'shared_stock_commercial', role: 'commercial' },
      { id: randomUUID(), username: 'shared_stock_magasinier', role: 'magasinier' },
      { id: randomUUID(), username: 'schedule_accountant', role: 'comptable' },
      { id: randomUUID(), username: 'supervised_session_target', role: 'employe' },
    ];
    const database = new Database(databasePath);
    database.pragma('busy_timeout = 10000');
    const insertUser = database.prepare(
      'INSERT INTO users (id, username, password, role, department, full_name, active, token_version) VALUES (?, ?, ?, ?, ?, ?, 1, 0)'
    );
    database.transaction(() => {
      for (const user of [...capacityUsers, ...stockRoleUsers]) {
        insertUser.run(user.id, user.username, 'integration-password-unused', user.role, 'operations', user.username);
      }
      const productId = randomUUID();
      database.prepare(`INSERT INTO produits
        (id, reference, designation, categorie, prix_ht, prix_vente, stock_min, actif)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(productId, 'SYNC-STOCK-001', 'Produit stock partage', 'Test', 100, 130, 5);
      database.prepare(`INSERT INTO stock_mouvements
        (id, produit_id, type, quantite, stock_avant, stock_apres, motif)
        VALUES (?, ?, 'entree', 37, 0, 37, 'Validation stock partage')`)
        .run(randomUUID(), productId);
    })();
    database.close();

    const signUserToken = (user) => jwt.sign({
      jti: randomUUID(),
      id: user.id,
      username: user.username,
      role: user.role,
      department: 'operations',
      tokenVersion: 0,
    }, 'integration-jwt-secret-with-more-than-thirty-two-characters', {
      expiresIn: '15m',
      issuer: 'intelsheets',
      audience: 'intelsheets-web',
      algorithm: 'HS256',
    });
    const capacityTokens = capacityUsers.map(signUserToken);
    const [commercialToken, magasinierToken, accountantToken, supervisedTargetToken] = stockRoleUsers.map(signUserToken);

    const commercialSiteAgent = await fetch(`${baseUrl}/api/site-agent`, {
      headers: { authorization: `Bearer ${commercialToken}`, origin: 'https://erp.test' },
    });
    assert.equal(commercialSiteAgent.status, 403, output);

    const revokeSessionsAction = await fetch(`${baseUrl}/api/site-agent/actions`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        type: 'revoke_user_sessions',
        payload: { username: 'supervised_session_target' },
        reason: 'Test révocation supervisée.',
      }),
    });
    assert.equal(revokeSessionsAction.status, 201, output);
    const revokeAction = await revokeSessionsAction.json();
    const approveRevoke = await fetch(`${baseUrl}/api/site-agent/actions/${revokeAction.id}/approve`, {
      method: 'POST', headers: writeHeaders, body: JSON.stringify({}),
    });
    assert.equal(approveRevoke.status, 200, output);
    const revokedSession = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${supervisedTargetToken}`, origin: 'https://erp.test' },
    });
    assert.equal(revokedSession.status, 401, output);

    const accountantSchedule = await fetch(`${baseUrl}/api/echeancier`, {
      headers: { authorization: `Bearer ${accountantToken}`, origin: 'https://erp.test' },
    });
    assert.equal(accountantSchedule.status, 200, output);
    const accountantEditSchedule = await fetch(`${baseUrl}/api/echeancier/${scheduleRow.id}`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${accountantToken}`,
        origin: 'https://erp.test',
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        cookie: `XSRF-TOKEN=${csrfToken}`,
      },
      body: JSON.stringify({ paid: false }),
    });
    assert.equal(accountantEditSchedule.status, 403, output);

    const roleSystemStatus = await fetch(`${baseUrl}/api/system/status`, {
      headers: { authorization: `Bearer ${magasinierToken}`, origin: 'https://erp.test' },
    });
    assert.equal(roleSystemStatus.status, 200, output);
    const roleSystemStatusBody = await roleSystemStatus.json();
    assert.equal(['operational', 'degraded', 'critical'].includes(roleSystemStatusBody.status), true);
    assert.equal(roleSystemStatusBody.services.database, 'operational');
    assert.equal(Array.isArray(roleSystemStatusBody.issues), true);

    const commercialMessageSocket = await openAuthenticatedSocket(`ws://127.0.0.1:${port}/ws`, commercialToken);
    const realtimeMessagePromise = waitForSocketMessage(
      commercialMessageSocket,
      'chat_message',
      (message) => message.message?.doc_id === 'DEV-TEST-2026-001'
    );
    const messageResponse = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${magasinierToken}`,
        origin: 'https://erp.test',
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        cookie: `XSRF-TOKEN=${csrfToken}`,
      },
      body: JSON.stringify({
        recipient_role: 'commercial',
        content: 'Merci de verifier ce devis.',
        doc_type: 'DEV',
        doc_id: 'DEV-TEST-2026-001',
        document: {
          id: 'DEV-TEST-2026-001',
          number: 'DEV-TEST-2026-001',
          type: 'DEV',
          status: 'validated',
          client: 'Client integration',
          items: [{ ref: 'SYNC-STOCK-001', name: 'Produit stock partage', qty: 2, priceHT: 100 }],
          totals: { ht: 200, tva: 40, ttc: 240 },
          currency: 'MAD',
        },
      }),
    });
    assert.equal(messageResponse.status, 200, output);
    const sentMessage = await messageResponse.json();
    assert.equal(sentMessage.document.number, 'DEV-TEST-2026-001');
    assert.equal(Object.hasOwn(sentMessage, 'doc_payload'), false);

    const realtimeMessage = await realtimeMessagePromise;
    assert.equal(realtimeMessage.message.document.totals.ttc, 240);

    const roleConversation = await fetch(`${baseUrl}/api/messages?with_role=commercial`, {
      headers: { authorization: `Bearer ${magasinierToken}`, origin: 'https://erp.test' },
    });
    assert.equal(roleConversation.status, 200, output);
    assert.equal((await roleConversation.json()).some(message => message.doc_id === 'DEV-TEST-2026-001'), true);

    const senderConversations = await fetch(`${baseUrl}/api/messages/conversations`, {
      headers: { authorization: `Bearer ${magasinierToken}`, origin: 'https://erp.test' },
    });
    assert.equal(senderConversations.status, 200, output);
    assert.equal((await senderConversations.json()).some(conversation => conversation.other_id === 'role:commercial'), true);

    const commercialInbox = await fetch(`${baseUrl}/api/messages`, {
      headers: { authorization: `Bearer ${commercialToken}`, origin: 'https://erp.test' },
    });
    assert.equal(commercialInbox.status, 200, output);
    assert.equal((await commercialInbox.json()).some(message => message.document?.number === 'DEV-TEST-2026-001'), true);

    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
    const pdfMessageResponse = await fetch(`${baseUrl}/api/messages/pdf`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${magasinierToken}`,
        origin: 'https://erp.test',
        'content-type': 'application/pdf',
        'x-file-name': encodeURIComponent('facture intégration.pdf'),
        'x-recipient-role': 'commercial',
        'x-message-content': encodeURIComponent('PDF à vérifier.'),
        'x-csrf-token': csrfToken,
        cookie: `XSRF-TOKEN=${csrfToken}`,
      },
      body: pdfBytes,
    });
    assert.equal(pdfMessageResponse.status, 200, output);
    const pdfMessage = await pdfMessageResponse.json();
    assert.equal(pdfMessage.doc_type, 'PDF');
    assert.equal(pdfMessage.document.name, 'facture intégration.pdf');
    assert.equal(pdfMessage.document.size, pdfBytes.length);

    const pdfDownload = await fetch(`${baseUrl}/api/messages/${pdfMessage.id}/pdf`, {
      headers: { authorization: `Bearer ${commercialToken}`, origin: 'https://erp.test' },
    });
    assert.equal(pdfDownload.status, 200, output);
    assert.match(pdfDownload.headers.get('content-type') || '', /application\/pdf/);
    assert.equal(Buffer.compare(Buffer.from(await pdfDownload.arrayBuffer()), pdfBytes), 0);

    const directMessageResponse = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        recipient_id: stockRoleUsers[0].id,
        content: 'Message direct pour suppression multiple.',
      }),
    });
    assert.equal(directMessageResponse.status, 200, output);
    const directMessage = await directMessageResponse.json();

    const hideSelectedMessage = await fetch(`${baseUrl}/api/messages/delete-selection`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${commercialToken}`,
        origin: 'https://erp.test',
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        cookie: `XSRF-TOKEN=${csrfToken}`,
      },
      body: JSON.stringify({ ids: [pdfMessage.id, directMessage.id] }),
    });
    assert.equal(hideSelectedMessage.status, 200, output);
    const deletionResult = await hideSelectedMessage.json();
    assert.equal(deletionResult.permanent, true);
    assert.deepEqual(new Set(deletionResult.ids), new Set([pdfMessage.id, directMessage.id]));

    const commercialInboxAfterDelete = await fetch(`${baseUrl}/api/messages`, {
      headers: { authorization: `Bearer ${commercialToken}`, origin: 'https://erp.test' },
    });
    const visibleCommercialMessages = await commercialInboxAfterDelete.json();
    assert.equal(visibleCommercialMessages.some(message => message.id === pdfMessage.id), false);
    assert.equal(visibleCommercialMessages.some(message => message.id === directMessage.id), false);
    const commercialConversationsAfterDelete = await fetch(`${baseUrl}/api/messages/conversations`, {
      headers: { authorization: `Bearer ${commercialToken}`, origin: 'https://erp.test' },
    });
    const visibleCommercialConversations = await commercialConversationsAfterDelete.json();
    assert.equal(visibleCommercialConversations.some(conversation => conversation.id === pdfMessage.id), false);
    assert.equal(visibleCommercialConversations.some(conversation => conversation.id === directMessage.id), false);
    assert.equal(visibleCommercialConversations.some(conversation => conversation.id === sentMessage.id), true);
    const senderInboxAfterRecipientDelete = await fetch(`${baseUrl}/api/messages?with_role=commercial`, {
      headers: { authorization: `Bearer ${magasinierToken}`, origin: 'https://erp.test' },
    });
    assert.equal((await senderInboxAfterRecipientDelete.json()).some(message => message.id === pdfMessage.id), false);

    const deletedPdfDownload = await fetch(`${baseUrl}/api/messages/${pdfMessage.id}/pdf`, {
      headers: { authorization: `Bearer ${commercialToken}`, origin: 'https://erp.test' },
    });
    assert.equal(deletedPdfDownload.status, 404, output);

    const incomingDocumentResponse = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${commercialToken}`,
        origin: 'https://erp.test',
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        cookie: `XSRF-TOKEN=${csrfToken}`,
      },
      body: JSON.stringify({
        recipient_role: 'magasinier',
        content: 'Bon de livraison a traiter.',
        doc_type: 'BL',
        doc_id: 'BL-TEST-2026-001',
        document: {
          id: 'BL-TEST-2026-001',
          number: 'BL-TEST-2026-001',
          type: 'BL',
          status: 'validated',
          client: 'Client reception',
          items: [{ ref: 'SYNC-STOCK-001', name: 'Produit stock partage', qty: 1, priceHT: 100 }],
          totals: { ht: 100, tva: 20, ttc: 120 },
          currency: 'MAD',
        },
      }),
    });
    assert.equal(incomingDocumentResponse.status, 200, output);

    const receivedDocuments = await fetch(`${baseUrl}/api/messages/received-documents`, {
      headers: { authorization: `Bearer ${magasinierToken}`, origin: 'https://erp.test' },
    });
    assert.equal(receivedDocuments.status, 200, output);
    const receivedDocumentRows = await receivedDocuments.json();
    assert.equal(receivedDocumentRows[0].document.number, 'BL-TEST-2026-001');
    assert.equal(receivedDocumentRows[0].sender_role, 'commercial');

    const commercialReceivedDocuments = await fetch(`${baseUrl}/api/messages/received-documents`, {
      headers: { authorization: `Bearer ${commercialToken}`, origin: 'https://erp.test' },
    });
    assert.equal(commercialReceivedDocuments.status, 200);

    const accountantReceivedDocuments = await fetch(`${baseUrl}/api/messages/received-documents`, {
      headers: { authorization: `Bearer ${accountantToken}`, origin: 'https://erp.test' },
    });
    assert.equal(accountantReceivedDocuments.status, 200);

    const adminReceivedDocuments = await fetch(`${baseUrl}/api/messages/received-documents`, {
      headers: profileHeaders,
    });
    assert.equal(adminReceivedDocuments.status, 200);
    commercialMessageSocket.close();

    const [commercialStockResponse, magasinierStockResponse] = await Promise.all([
      fetch(`${baseUrl}/api/stock`, { headers: { authorization: `Bearer ${commercialToken}`, origin: 'https://erp.test' } }),
      fetch(`${baseUrl}/api/stock`, { headers: { authorization: `Bearer ${magasinierToken}`, origin: 'https://erp.test' } }),
    ]);
    assert.equal(commercialStockResponse.status, 200);
    assert.equal(magasinierStockResponse.status, 200);
    const commercialStock = await commercialStockResponse.json();
    const magasinierStock = await magasinierStockResponse.json();
    assert.deepEqual(commercialStock, magasinierStock);
    assert.equal(commercialStock.find((product) => product.reference === 'SYNC-STOCK-001')?.stock_actuel, 37);

    const capacityResponses = await Promise.all(capacityTokens.map((token) => fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}`, origin: 'https://erp.test' },
    })));
    assert.equal(capacityResponses.length, 100);
    assert.equal(capacityResponses.every((response) => response.status === 200), true);

    const capacityWrites = await Promise.all(capacityTokens.map((token, index) => fetch(`${baseUrl}/api/data/doc/capacity_probe`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        origin: 'https://erp.test',
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
        cookie: `XSRF-TOKEN=${csrfToken}`,
      },
      body: JSON.stringify({ sequence: index + 1 }),
    })));
    assert.equal(capacityWrites.length, 100);
    assert.equal(capacityWrites.every((response) => response.status === 200), true);

    const capacitySockets = await Promise.all(capacityTokens.map((token) => openAuthenticatedSocket(
      `ws://127.0.0.1:${port}/ws`,
      token
    )));
    assert.equal(capacitySockets.length, 100);

    const collaborativeSocket = capacitySockets[0];
    const snapshotPromise = waitForSocketMessage(collaborativeSocket, 'document_snapshot', (message) => message.key === 'shared_capacity_document');
    collaborativeSocket.send(JSON.stringify({ type: 'document_subscribe', key: 'shared_capacity_document' }));
    const snapshot = await snapshotPromise;
    assert.equal(snapshot.version, 0);
    const updatePromise = waitForSocketMessage(collaborativeSocket, 'document_updated', (message) => message.key === 'shared_capacity_document');
    collaborativeSocket.send(JSON.stringify({
      type: 'document_update',
      key: 'shared_capacity_document',
      value: { status: 'collaborative' },
      expected_version: snapshot.version,
    }));
    const documentUpdate = await updatePromise;
    assert.equal(documentUpdate.version, 1);
    assert.equal(documentUpdate.value.status, 'collaborative');

    const health = await fetch(`${baseUrl}/api/health`);
    const healthBody = await health.json();
    assert.equal(healthBody.target_concurrent_users, 100);
    assert.equal(healthBody.websocket_connections >= 100, true);

    const metrics = await fetch(`${baseUrl}/api/metrics`, { headers: { authorization: 'Bearer integration-metrics-token' } });
    assert.equal(metrics.status, 200);
    assert.match(await metrics.text(), /intelsheets_http_requests_total/);

    for (const socket of capacitySockets) socket.close();
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 6000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }
});
