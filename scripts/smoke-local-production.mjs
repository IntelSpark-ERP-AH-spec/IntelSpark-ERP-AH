import 'dotenv/config';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const baseUrl = String(process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const websocketOrigin = String(process.env.SMOKE_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');
const adminUsername = String(process.env.SMOKE_ADMIN_USERNAME || 'admin');
const adminPassword = String(process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '');
if (!adminPassword) throw new Error('Mot de passe administrateur absent');
let csrfToken = '';

async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body && !Buffer.isBuffer(options.body) ? { 'content-type': 'application/json' } : {}),
      ...(csrfToken ? {
        cookie: `XSRF-TOKEN=${encodeURIComponent(csrfToken)}`,
        ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'x-csrf-token': csrfToken } : {}),
      } : {}),
      ...(options.headers || {}),
    },
  });
  const csrfCookie = String(response.headers.get('set-cookie') || '').match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/i);
  if (csrfCookie?.[1]) csrfToken = decodeURIComponent(csrfCookie[1]);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { response, body };
}

async function login(username, password) {
  const { response, body } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (response.status !== 200 || !body?.token) throw new Error(`Connexion refusée (${response.status})`);
  return body;
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

function waitForSocketMessage(socket, predicate, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener('message', onMessage);
      reject(new Error('WebSocket sans réponse'));
    }, timeoutMs);
    const onMessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (!predicate(message)) return;
        clearTimeout(timer);
        socket.removeEventListener('message', onMessage);
        resolve(message);
      } catch {}
    };
    socket.addEventListener('message', onMessage);
  });
}

async function authenticatedSocket(token) {
  const socketUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
  const socket = new WebSocket(socketUrl, { origin: websocketOrigin });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  const authenticated = waitForSocketMessage(socket, message => message.type === 'auth_ok');
  socket.send(JSON.stringify({ type: 'auth', token }));
  await authenticated;
  return socket;
}

let adminToken = '';
let temporaryUserId = '';
let temporaryToken = '';
let socket;
const checks = {};
const diagnostics = {};

try {
  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: adminUsername, password: `${adminPassword}-incorrect` }),
  });
  checks.bad_password_rejected = badLogin.response.status === 401;

  const admin = await login(adminUsername, adminPassword);
  adminToken = admin.token;
  checks.admin_login = admin.user?.role === 'admin';

  const me = await request('/api/auth/me', { headers: authHeaders(adminToken) });
  checks.admin_profile = me.response.status === 200 && Boolean(me.body?.organization_id);

  const suffix = crypto.randomBytes(5).toString('hex');
  const temporaryUsername = `smoke_${suffix}`;
  const temporaryPassword = `Tmp-${crypto.randomBytes(12).toString('base64url')}!9`;
  const created = await request('/api/users', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({
      username: temporaryUsername,
      password: temporaryPassword,
      role: 'employe',
      full_name: 'Compte test temporaire',
    }),
  });
  if (created.response.status !== 201) throw new Error(`Création utilisateur refusée (${created.response.status})`);
  temporaryUserId = String(created.body.id);
  checks.organization_inherited = created.body.organization_id === me.body.organization_id;

  const temporary = await login(temporaryUsername, temporaryPassword);
  temporaryToken = temporary.token;
  checks.user_login = temporary.user?.role === 'employe';
  checks.same_organization = temporary.user?.organization_id === me.body.organization_id;

  const forbiddenUsers = await request('/api/users', { headers: authHeaders(temporaryToken) });
  checks.admin_route_forbidden = forbiddenUsers.response.status === 403;

  socket = await authenticatedSocket(adminToken);
  const realtimeMessage = waitForSocketMessage(
    socket,
    message => message.type === 'chat_message' && String(message.message?.sender_id) === temporaryUserId,
  );
  const sent = await request('/api/messages', {
    method: 'POST',
    headers: authHeaders(temporaryToken),
    body: JSON.stringify({ recipient_id: admin.user.id, content: 'Test temps réel temporaire' }),
  });
  if (sent.response.status !== 200) throw new Error(`Message refusé (${sent.response.status})`);
  await realtimeMessage;
  checks.realtime_message = true;

  socket.close();
  socket = await authenticatedSocket(adminToken);
  checks.websocket_reconnect = socket.readyState === WebSocket.OPEN;

  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF');
  const pdf = await request('/api/messages/pdf', {
    method: 'POST',
    headers: {
      ...authHeaders(temporaryToken),
      'content-type': 'application/pdf',
      'x-file-name': encodeURIComponent('smoke-temporaire.pdf'),
      'x-recipient-id': String(admin.user.id),
      'x-message-content': encodeURIComponent('PDF temporaire'),
    },
    body: pdfBytes,
  });
  if (pdf.response.status !== 200) throw new Error(`PDF refusé (${pdf.response.status})`);
  const downloaded = await request(`/api/messages/${pdf.body.id}/pdf`, { headers: authHeaders(adminToken) });
  const downloadedPdf = Buffer.from(downloaded.body);
  checks.pdf_roundtrip = downloaded.response.status === 200
    && Buffer.compare(downloadedPdf, pdfBytes) === 0;
  if (!checks.pdf_roundtrip) {
    diagnostics.pdf_status = downloaded.response.status;
    diagnostics.pdf_expected_bytes = pdfBytes.length;
    diagnostics.pdf_received_bytes = downloadedPdf.length;
    diagnostics.pdf_received_prefix = downloadedPdf.subarray(0, 5).toString('ascii');
    diagnostics.pdf_record_has_file_id = Boolean(pdf.body?.doc_id);
    diagnostics.pdf_configured_file_exists = Boolean(
      process.env.MESSAGE_PDF_DIR
      && pdf.body?.doc_id
      && existsSync(path.join(process.env.MESSAGE_PDF_DIR, `${pdf.body.doc_id}.pdf`)),
    );
  }
  const deletedPdf = await request(`/api/messages/${pdf.body.id}`, {
    method: 'DELETE',
    headers: authHeaders(temporaryToken),
  });
  const missingPdf = await request(`/api/messages/${pdf.body.id}/pdf`, { headers: authHeaders(adminToken) });
  checks.pdf_cleanup = deletedPdf.response.status === 200 && missingPdf.response.status === 404;

  const gmailStatus = await request('/api/auth/me/smtp/test', {
    method: 'POST',
    headers: authHeaders(adminToken),
    body: JSON.stringify({}),
  });
  checks.gmail_safe_unconfigured = gmailStatus.response.status === 200
    && gmailStatus.body?.status === 'configuration_incomplete';

  const logout = await request('/api/auth/logout', {
    method: 'POST',
    headers: authHeaders(temporaryToken),
  });
  checks.logout = logout.response.status === 200;
  const expired = await request('/api/auth/me', { headers: authHeaders(temporaryToken) });
  checks.revoked_session_rejected = expired.response.status === 401;
} finally {
  socket?.close();
  if (temporaryUserId && adminToken) {
    await request(`/api/users/${temporaryUserId}`, {
      method: 'DELETE',
      headers: authHeaders(adminToken),
    }).catch(() => {});
  }
}

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
console.log(JSON.stringify({ checks, diagnostics, failed }));
if (failed.length) process.exitCode = 1;
