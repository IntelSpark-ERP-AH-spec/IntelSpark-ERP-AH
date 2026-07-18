import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbQuery, dbRun } from './db.js';
import { decryptSecret, isEncryptedSecret, upgradeSecret } from './secrets.js';
import { sendToUser } from './websocket.js';

const syncingUsers = new Set();

function intervalMs() {
  const parsed = Number.parseInt(process.env.MAIL_SYNC_INTERVAL_MS || '60000', 10);
  return Number.isInteger(parsed) && parsed >= 30_000 && parsed <= 900_000 ? parsed : 60_000;
}

function imapClient(email, password) {
  const host = String(process.env.IMAP_HOST || process.env.SMTP_HOST || 'imap.gmail.com').trim();
  const port = Number.parseInt(process.env.IMAP_PORT || '993', 10);
  return new ImapFlow({
    host,
    port: Number.isInteger(port) ? port : 993,
    secure: true,
    auth: { user: email, pass: password }, logger: false,
    connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 45_000,
  });
}

function credentialsForUser(userId) {
  const row = dbGet(`SELECT id, smtp_user, smtp_pass, mail_connected_at, mail_last_uid,
    mail_uid_validity, mail_last_sync_at FROM users WHERE id = ? AND active = 1`, [userId]);
  if (!row?.smtp_user || !row?.smtp_pass || !row?.mail_connected_at) return null;
  if (!isEncryptedSecret(row.smtp_pass)) {
    const encrypted = upgradeSecret(row.smtp_pass);
    dbRun('UPDATE users SET smtp_pass = ? WHERE id = ?', [encrypted, userId]);
    row.smtp_pass = encrypted;
  }
  return { ...row, password: decryptSecret(row.smtp_pass) };
}

function readableHtml(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function senderDetails(parsed, envelope) {
  const parsedSender = parsed?.from?.value?.[0];
  const envelopeSender = envelope?.from?.[0];
  const email = String(parsedSender?.address || envelopeSender?.address || '').trim().toLowerCase();
  const name = String(parsedSender?.name || envelopeSender?.name || email || 'Expediteur inconnu').trim();
  return { name, email };
}

function createEmailNotification(userId, mail) {
  const notification = {
    id: uuidv4(), user_id: userId, type: 'email', title: 'Nouvel email reçu',
    message: `${mail.sender_name || mail.sender_email || 'Expéditeur inconnu'} — ${mail.subject || 'Sans sujet'}`.slice(0, 500),
    read: 0, created_at: new Date().toISOString(), email_id: mail.id,
  };
  dbRun(`INSERT INTO notifications (id, user_id, type, title, message, read, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)`,
  [notification.id, userId, notification.type, notification.title, notification.message, notification.created_at]);
  sendToUser(userId, { type: 'notification', notification });
}

function isDeletedEmail(userId, emailId) {
  const row = dbGet('SELECT 1 AS found FROM email_deletions WHERE user_id = ? AND email_id = ?', [userId, emailId]);
  return Boolean(row);
}

export async function mailboxBoundary(email, password) {
  const client = imapClient(email, password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      return {
        uid_validity: String(client.mailbox.uidValidity || ''),
        last_uid: Math.max(0, Number(client.mailbox.uidNext || 1) - 1),
        connected_at: new Date().toISOString(),
      };
    } finally { lock.release(); }
  } finally {
    try { await client.logout(); } catch {}
  }
}

export async function syncMailboxForUser(userId) {
  if (syncingUsers.has(String(userId))) return { imported: 0, skipped: 'already_syncing' };
  const account = credentialsForUser(userId);
  if (!account) return { imported: 0, skipped: 'not_configured' };
  syncingUsers.add(String(userId));
  const client = imapClient(account.smtp_user, account.password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let imported = 0;
    let lastUid = Number(account.mail_last_uid || 0);
    try {
      const uidValidity = String(client.mailbox.uidValidity || '');
      const highestUid = Math.max(0, Number(client.mailbox.uidNext || 1) - 1);
      if (lastUid < 0 || (account.mail_uid_validity && String(account.mail_uid_validity) !== uidValidity)) {
        dbRun(`UPDATE users SET mail_last_uid = ?, mail_uid_validity = ?, mail_last_sync_at = datetime('now')
          WHERE id = ?`, [highestUid, uidValidity, userId]);
        return { imported: 0, initialized: true };
      }
      if (highestUid <= lastUid) {
        dbRun("UPDATE users SET mail_last_sync_at = datetime('now'), mail_uid_validity = ? WHERE id = ?", [uidValidity, userId]);
        return { imported: 0 };
      }

      const connectedAt = new Date(account.mail_connected_at).getTime();
      for await (const message of client.fetch(`${lastUid + 1}:${highestUid}`,
        { uid: true, envelope: true, internalDate: true, source: true }, { uid: true })) {
        lastUid = Math.max(lastUid, Number(message.uid || 0));
        const receivedAt = message.internalDate || new Date();
        if (receivedAt.getTime() < connectedAt) continue;
        const parsed = await simpleParser(message.source || Buffer.from(''));
        const sender = senderDetails(parsed, message.envelope);
        const subject = String(parsed.subject || message.envelope?.subject || '').trim().slice(0, 500);
        const body = String(parsed.text || readableHtml(parsed.html) || '').trim().slice(0, 50_000);
        const id = `imap-${userId}-${uidValidity}-${message.uid}`;
        if (isDeletedEmail(userId, id)) continue;
        const result = dbRun(`INSERT OR IGNORE INTO email_history
          (id, user_id, direction, correspondent, subject, body, created_at, sender_name, sender_email, account_email, is_read)
          VALUES (?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, 0)`,
        [id, userId, sender.email || sender.name, subject, body, receivedAt.toISOString(), sender.name, sender.email, account.smtp_user]);
        if (!result.changes) continue;
        imported += 1;
        createEmailNotification(userId, { id, sender_name: sender.name, sender_email: sender.email, subject });
      }
      dbRun(`UPDATE users SET mail_last_uid = ?, mail_uid_validity = ?, mail_last_sync_at = datetime('now')
        WHERE id = ?`, [Math.max(lastUid, highestUid), uidValidity, userId]);
    } finally { lock.release(); }
    return { imported };
  } finally {
    try { await client.logout(); } catch {}
    syncingUsers.delete(String(userId));
  }
}

export function startMailSyncService() {
  let stopped = false;
  let timer;
  let running = false;
  const cycle = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const users = dbQuery(`SELECT id FROM users WHERE active = 1 AND smtp_user IS NOT NULL AND smtp_user != ''
        AND smtp_pass IS NOT NULL AND smtp_pass != '' AND mail_connected_at IS NOT NULL`);
      for (const user of users) {
        if (stopped) break;
    try { await syncMailboxForUser(user.id); }
        catch (error) { console.error(`Synchronisation mail ${user.id}:`, error?.message || error); }
      }
    } finally {
      running = false;
      if (!stopped) {
        timer = setTimeout(cycle, intervalMs());
        timer.unref();
      }
    }
  };
  timer = setTimeout(cycle, 10_000);
  timer.unref();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
