import { simpleParser } from 'mailparser';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun } from './db.js';
import { createImapClient, mailboxBoundary } from './mail-connection.js';
import {
  accountForSync,
  decryptedPasswordForAccount,
  listAvailableEmailAccounts,
  listSyncableEmailAccounts,
  readersForAccount,
} from './email-account-service.js';
import { sendToUser } from './websocket.js';

const syncingAccounts = new Set();

function intervalMs() {
  const parsed = Number.parseInt(process.env.MAIL_SYNC_INTERVAL_MS || '60000', 10);
  return Number.isInteger(parsed) && parsed >= 30_000 && parsed <= 900_000 ? parsed : 60_000;
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
  const name = String(parsedSender?.name || envelopeSender?.name || email || 'Expéditeur inconnu').trim();
  return { name, email };
}

function createEmailNotification(userId, mail) {
  const notification = {
    id: uuidv4(),
    user_id: userId,
    type: 'email',
    title: 'Nouvel email reçu',
    message: `${mail.sender_name || mail.sender_email || 'Expéditeur inconnu'} — ${mail.subject || 'Sans sujet'}`.slice(0, 500),
    read: 0,
    created_at: new Date().toISOString(),
    email_id: mail.id,
  };
  dbRun(`INSERT INTO notifications (id,user_id,type,title,message,read,created_at)
    VALUES (?,?,?,?,?,0,?)`, [
    notification.id,
    userId,
    notification.type,
    notification.title,
    notification.message,
    notification.created_at,
  ]);
  sendToUser(userId, { type: 'notification', notification });
}

function isDeletedEmail(userId, emailId) {
  return Boolean(dbGet(
    'SELECT 1 AS found FROM email_deletions WHERE user_id=? AND email_id=?',
    [userId, emailId],
  ));
}

export { mailboxBoundary };

export async function syncMailboxForAccount(accountId) {
  const key = String(accountId);
  if (syncingAccounts.has(key)) return { imported: 0, skipped: 'already_syncing' };
  const account = accountForSync(accountId);
  if (!account?.encrypted_app_password || !account.mail_connected_at) {
    return { imported: 0, skipped: 'not_configured' };
  }

  syncingAccounts.add(key);
  let password = decryptedPasswordForAccount(account);
  const client = createImapClient(account.email_address, password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let imported = 0;
    let lastUid = Number(account.mail_last_uid || 0);
    try {
      const uidValidity = String(client.mailbox.uidValidity || '');
      const highestUid = Math.max(0, Number(client.mailbox.uidNext || 1) - 1);
      if (lastUid < 0 || (account.mail_uid_validity && String(account.mail_uid_validity) !== uidValidity)) {
        dbRun(`UPDATE email_accounts SET mail_last_uid=?,mail_uid_validity=?,
          mail_last_sync_at=datetime('now'),updated_at=datetime('now') WHERE id=?`, [
          highestUid,
          uidValidity,
          account.id,
        ]);
        return { imported: 0, initialized: true };
      }
      if (highestUid <= lastUid) {
        dbRun(`UPDATE email_accounts SET mail_last_sync_at=datetime('now'),
          mail_uid_validity=?,updated_at=datetime('now') WHERE id=?`, [uidValidity, account.id]);
        return { imported: 0 };
      }

      const connectedAt = new Date(account.mail_connected_at).getTime();
      const readers = readersForAccount(account);
      for await (const message of client.fetch(
        `${lastUid + 1}:${highestUid}`,
        { uid: true, envelope: true, internalDate: true, source: true },
        { uid: true },
      )) {
        lastUid = Math.max(lastUid, Number(message.uid || 0));
        const receivedAt = message.internalDate || new Date();
        if (receivedAt.getTime() < connectedAt) continue;
        const parsed = await simpleParser(message.source || Buffer.from(''));
        const sender = senderDetails(parsed, message.envelope);
        const subject = String(parsed.subject || message.envelope?.subject || '').trim().slice(0, 500);
        const body = String(parsed.text || readableHtml(parsed.html) || '').trim().slice(0, 50_000);

        for (const userId of readers) {
          const id = `imap-${account.id}-${userId}-${uidValidity}-${message.uid}`;
          if (isDeletedEmail(userId, id)) continue;
          const result = dbRun(`INSERT OR IGNORE INTO email_history
            (id,user_id,organization_id,email_account_id,sender_user_id,direction,correspondent,
             subject,body,created_at,sender_name,sender_email,account_email,is_read,status)
            VALUES (?,?,?,?,NULL,'received',?,?,?,?,?,?,?,0,'received')`, [
            id,
            userId,
            account.organization_id,
            account.id,
            sender.email || sender.name,
            subject,
            body,
            receivedAt.toISOString(),
            sender.name,
            sender.email,
            account.email_address,
          ]);
          if (!result.changes) continue;
          imported += 1;
          createEmailNotification(userId, {
            id,
            sender_name: sender.name,
            sender_email: sender.email,
            subject,
          });
        }
      }
      dbRun(`UPDATE email_accounts SET mail_last_uid=?,mail_uid_validity=?,
        mail_last_sync_at=datetime('now'),updated_at=datetime('now') WHERE id=?`, [
        Math.max(lastUid, highestUid),
        uidValidity,
        account.id,
      ]);
      if (account.account_type === 'personal' && account.user_id) {
        dbRun(`UPDATE users SET mail_last_uid=?,mail_uid_validity=?,
          mail_last_sync_at=datetime('now') WHERE id=? AND organization_id=?`, [
          Math.max(lastUid, highestUid),
          uidValidity,
          account.user_id,
          account.organization_id,
        ]);
      }
    } finally {
      lock.release();
    }
    return { imported };
  } finally {
    password = '';
    try { await client.logout(); } catch {}
    syncingAccounts.delete(key);
  }
}

export async function syncMailboxForUser(user) {
  const accounts = listAvailableEmailAccounts(user)
    .filter(account => account.can_read && account.imap_enabled && account.configured);
  if (!accounts.length) return { imported: 0, skipped: 'not_configured' };
  let imported = 0;
  for (const account of accounts) {
    const result = await syncMailboxForAccount(account.id);
    imported += Number(result.imported || 0);
  }
  return { imported, accounts: accounts.length };
}

export function startMailSyncService() {
  let stopped = false;
  let timer;
  let running = false;
  const cycle = async () => {
    if (stopped || running) return;
    running = true;
    try {
      for (const account of listSyncableEmailAccounts()) {
        if (stopped) break;
        try {
          await syncMailboxForAccount(account.id);
        } catch (error) {
          console.error('Synchronisation mail impossible:', {
            accountId: String(account.id).slice(0, 80),
            code: String(error?.code || 'UNKNOWN').slice(0, 40),
            responseStatus: String(error?.responseStatus || '').slice(0, 20) || undefined,
          });
        }
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
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
