import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { verifyToken, isTokenBlacklisted } from './auth.js';
import { dbGet, dbRun, dbTransaction } from './db.js';
import { getRuntimeConfig } from './runtime-config.js';
import { initRealtimeBus, publishRealtime, realtimeBusStatus, shutdownRealtimeBus } from './realtime-bus.js';

const clients = new Map();
const connectionsByIp = new Map();
const DOCUMENT_KEY_PATTERN = /^[a-zA-Z0-9_]{1,50}$/;
const MAX_DOCUMENT_BYTES = 48 * 1024;

function boundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

const MAX_CONNECTIONS_PER_IP = boundedInteger('WS_MAX_CONNECTIONS_PER_IP', 250, 20, 2000);
const MAX_CONNECTIONS_PER_USER = boundedInteger('WS_MAX_CONNECTIONS_PER_USER', 5, 1, 20);
const MAX_MESSAGES_PER_MINUTE = 60;
const AUTH_TIMEOUT_MS = 5000;

function connectionIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded.slice(0, 128);
  }
  return String(req.socket.remoteAddress || 'unknown');
}

function configuredOrigins() {
  return new Set((process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean));
}

function isAllowedOrigin(origin) {
  if (!origin) return process.env.NODE_ENV !== 'production';
  if (configuredOrigins().has(origin)) return true;
  if (process.env.NODE_ENV === 'production') return false;
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
      || url.hostname.endsWith('.trycloudflare.com');
  } catch {
    return false;
  }
}

function sendJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function removeClientSocket(userId, ws) {
  if (!userId || !clients.has(userId)) return;
  clients.get(userId).delete(ws);
  if (clients.get(userId).size === 0) clients.delete(userId);
}

function localBroadcast(message, excludeUserId = null) {
  for (const [userId, sockets] of clients.entries()) {
    if (excludeUserId && String(userId) === String(excludeUserId)) continue;
    for (const ws of sockets) sendJson(ws, message);
  }
}

function localSendToUser(userId, message) {
  const entry = [...clients.entries()].find(([id]) => String(id) === String(userId));
  for (const ws of entry?.[1] || []) sendJson(ws, message);
}

function localSendToRole(role, message) {
  for (const sockets of clients.values()) {
    for (const ws of sockets) {
      if (ws.role === role) sendJson(ws, message);
    }
  }
}

function localSendTeamDocument(teamKey, documentKey, message) {
  const subscription = `${teamKey}:${documentKey}`;
  for (const sockets of clients.values()) {
    for (const ws of sockets) {
      if (ws.documentSubscriptions?.has(subscription)) sendJson(ws, message);
    }
  }
}

function localDisconnectUser(userId, reason) {
  const entry = [...clients.entries()].find(([id]) => String(id) === String(userId));
  if (!entry) return false;
  for (const ws of [...entry[1]]) {
    sendJson(ws, { type: 'session_revoked', reason });
    ws.close(4001, reason);
  }
  return true;
}

function handleRemoteEvent(event) {
  if (event.type === 'broadcast') localBroadcast(event.message, event.target?.excludeUserId);
  if (event.type === 'user') localSendToUser(event.target?.userId, event.message);
  if (event.type === 'role') localSendToRole(event.target?.role, event.message);
  if (event.type === 'team_document') {
    localSendTeamDocument(event.target?.teamKey, event.target?.documentKey, event.message);
  }
  if (event.type === 'disconnect') localDisconnectUser(event.target?.userId, event.message?.reason || 'Session revoquee');
}

function teamKeyForSocket(ws) {
  return String(ws.department || ws.role || 'general').trim().toLowerCase();
}

function documentSnapshot(teamKey, documentKey) {
  const row = dbGet('SELECT value_json, version, updated_at, updated_by FROM team_documents WHERE team_key = ? AND key = ?', [teamKey, documentKey]);
  if (!row) return { value: null, version: 0, updated_at: null, updated_by: null };
  let value = null;
  try { value = JSON.parse(row.value_json); } catch {}
  return { value, version: Number(row.version || 1), updated_at: row.updated_at, updated_by: row.updated_by };
}

function updateDocument(ws, documentKey, value, expectedVersion) {
  const teamKey = teamKeyForSocket(ws);
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_DOCUMENT_BYTES) throw new Error('Document trop volumineux');

  return dbTransaction(() => {
    const current = dbGet('SELECT version FROM team_documents WHERE team_key = ? AND key = ?', [teamKey, documentKey]);
    const currentVersion = Number(current?.version || 0);
    if (currentVersion !== expectedVersion) return { conflict: true, snapshot: documentSnapshot(teamKey, documentKey) };
    const nextVersion = currentVersion + 1;
    if (!current) {
      dbRun(`INSERT INTO team_documents (team_key, key, value_json, updated_by, version, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))`, [teamKey, documentKey, json, ws.userId, nextVersion]);
    } else {
      dbRun(`UPDATE team_documents SET value_json = ?, updated_by = ?, version = ?, updated_at = datetime('now')
        WHERE team_key = ? AND key = ? AND version = ?`,
      [json, ws.userId, nextVersion, teamKey, documentKey, currentVersion]);
    }
    dbRun(`INSERT INTO collaboration_events (id, team_key, document_key, version, actor_id, change_json)
      VALUES (?, ?, ?, ?, ?, ?)`, [uuidv4(), teamKey, documentKey, nextVersion, ws.userId, json]);
    return { conflict: false, teamKey, version: nextVersion };
  });
}

export async function setupWebSocket(server) {
  if (!server) return null;
  await initRealtimeBus(handleRemoteEvent);

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
    verifyClient: ({ origin }) => isAllowedOrigin(origin),
  });

  wss.on('connection', (ws, req) => {
    const ip = connectionIp(req);
    const ipCount = connectionsByIp.get(ip) || 0;
    if (ipCount >= MAX_CONNECTIONS_PER_IP) {
      ws.close(1013, 'Trop de connexions');
      return;
    }
    connectionsByIp.set(ip, ipCount + 1);

    let userId = null;
    let username = 'anon';
    let authenticated = false;
    let rateWindowStarted = Date.now();
    let rateCount = 0;

    ws.isAlive = true;
    ws.documentSubscriptions = new Set();
    ws.on('pong', () => { ws.isAlive = true; });

    const authTimer = setTimeout(() => {
      if (!authenticated) ws.close(1008, 'Authentification requise');
    }, AUTH_TIMEOUT_MS);

    ws.on('message', async (data) => {
      const now = Date.now();
      if (now - rateWindowStarted >= 60_000) {
        rateWindowStarted = now;
        rateCount = 0;
      }
      rateCount += 1;
      if (rateCount > MAX_MESSAGES_PER_MINUTE) {
        ws.close(1008, 'Limite messages depassee');
        return;
      }

      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        ws.close(1007, 'JSON invalide');
        return;
      }
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        ws.close(1007, 'Message invalide');
        return;
      }

      if (message.type === 'auth') {
        if (authenticated) return sendJson(ws, { type: 'error', message: 'Session deja authentifiee' });
        try {
          const decoded = verifyToken(String(message.token || ''));
          if (isTokenBlacklisted(decoded.jti)) throw new Error('Token revoque');
          const currentUser = dbGet(
            'SELECT id, username, role, department, active, token_version FROM users WHERE id = ?',
            [decoded.id]
          );
          if (!currentUser?.active) throw new Error('Compte indisponible');
          if (Number(decoded.tokenVersion || 0) !== Number(currentUser.token_version || 0)) throw new Error('Session revoquee');
          if ((clients.get(currentUser.id)?.size || 0) >= MAX_CONNECTIONS_PER_USER) throw new Error('Trop de connexions utilisateur');

          authenticated = true;
          clearTimeout(authTimer);
          userId = currentUser.id;
          username = currentUser.username;
          ws.userId = userId;
          ws.username = username;
          ws.role = currentUser.role;
          ws.department = currentUser.department;

          if (!clients.has(userId)) clients.set(userId, new Set());
          clients.get(userId).add(ws);
          sendJson(ws, { type: 'auth_ok', userId, username, role: currentUser.role });
          broadcast({ type: 'user_online', userId, username, role: currentUser.role }, userId);
        } catch {
          sendJson(ws, { type: 'error', message: 'Authentification refusee' });
          ws.close(1008, 'Authentification refusee');
        }
        return;
      }

      if (!authenticated) {
        ws.close(1008, 'Authentification requise');
        return;
      }

      if (message.type === 'ping') {
        sendJson(ws, { type: 'pong' });
        return;
      }

      if (message.type === 'document_subscribe') {
        const documentKey = String(message.key || '');
        if (!DOCUMENT_KEY_PATTERN.test(documentKey)) return sendJson(ws, { type: 'error', message: 'Cle document invalide' });
        if (!getRuntimeConfig('document_collaboration', true)) return sendJson(ws, { type: 'error', message: 'Collaboration desactivee' });
        const teamKey = teamKeyForSocket(ws);
        ws.documentSubscriptions.add(`${teamKey}:${documentKey}`);
        sendJson(ws, { type: 'document_snapshot', key: documentKey, team: teamKey, ...documentSnapshot(teamKey, documentKey) });
        return;
      }

      if (message.type === 'document_unsubscribe') {
        const documentKey = String(message.key || '');
        ws.documentSubscriptions.delete(`${teamKeyForSocket(ws)}:${documentKey}`);
        return;
      }

      if (message.type === 'document_update') {
        try {
          const documentKey = String(message.key || '');
          const expectedVersion = Number(message.expected_version);
          if (!DOCUMENT_KEY_PATTERN.test(documentKey)) throw new Error('Cle document invalide');
          if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('Version attendue invalide');
          if (!Object.prototype.hasOwnProperty.call(message, 'value')) throw new Error('Valeur document requise');
          if (!getRuntimeConfig('document_collaboration', true)) throw new Error('Collaboration desactivee');

          const result = updateDocument(ws, documentKey, message.value, expectedVersion);
          if (result.conflict) {
            sendJson(ws, { type: 'document_conflict', key: documentKey, team: teamKeyForSocket(ws), ...result.snapshot });
            return;
          }
          const event = {
            type: 'document_updated',
            key: documentKey,
            team: result.teamKey,
            value: message.value,
            version: result.version,
            updated_by: ws.userId,
            updated_at: new Date().toISOString(),
          };
          localSendTeamDocument(result.teamKey, documentKey, event);
          publishRealtime('team_document', { teamKey: result.teamKey, documentKey }, event).catch(() => {});
        } catch (error) {
          sendJson(ws, { type: 'error', message: error.message });
        }
        return;
      }

      sendJson(ws, { type: 'error', message: 'Action WebSocket non autorisee' });
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      const remaining = Math.max(0, (connectionsByIp.get(ip) || 1) - 1);
      if (remaining) connectionsByIp.set(ip, remaining);
      else connectionsByIp.delete(ip);

      const wasLastSocket = userId && clients.get(userId)?.size === 1;
      removeClientSocket(userId, ws);
      if (wasLastSocket) broadcast({ type: 'user_offline', userId, username });
    });

    ws.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        removeClientSocket(ws.userId, ws);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30_000);

  wss.on('close', () => {
    clearInterval(heartbeat);
    shutdownRealtimeBus().catch(() => {});
  });
  console.log('WebSocket securise initialise');
  return wss;
}

export function broadcast(message, excludeUserId = null) {
  localBroadcast(message, excludeUserId);
  publishRealtime('broadcast', { excludeUserId }, message).catch(() => {});
}

export function sendToUser(userId, message) {
  localSendToUser(userId, message);
  publishRealtime('user', { userId }, message).catch(() => {});
}

export function disconnectUser(userId, reason = 'Compte desactive') {
  const disconnected = localDisconnectUser(userId, reason);
  publishRealtime('disconnect', { userId }, { reason }).catch(() => {});
  return disconnected;
}

export function sendToRole(role, message) {
  localSendToRole(role, message);
  publishRealtime('role', { role }, message).catch(() => {});
}

export function getOnlineUsers() {
  const users = [];
  for (const [userId, sockets] of clients.entries()) {
    const ws = [...sockets][0];
    if (ws) users.push({ userId, username: ws.username, role: ws.role });
  }
  return users;
}

export function getConnectionStats() {
  let sockets = 0;
  for (const userSockets of clients.values()) sockets += userSockets.size;
  return {
    authenticated_users: clients.size,
    authenticated_sockets: sockets,
    tracked_ips: connectionsByIp.size,
    max_connections_per_ip: MAX_CONNECTIONS_PER_IP,
    max_connections_per_user: MAX_CONNECTIONS_PER_USER,
    redis: realtimeBusStatus(),
  };
}
