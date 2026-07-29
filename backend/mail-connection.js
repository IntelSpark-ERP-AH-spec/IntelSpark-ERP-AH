import { ImapFlow } from 'imapflow';

export function createImapClient(email, password) {
  const host = String(process.env.IMAP_HOST || 'imap.gmail.com').trim();
  const port = Number.parseInt(process.env.IMAP_PORT || '993', 10);
  return new ImapFlow({
    host,
    port: Number.isInteger(port) ? port : 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 45_000,
  });
}

export async function mailboxBoundary(email, password) {
  const client = createImapClient(email, password);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      return {
        uid_validity: String(client.mailbox.uidValidity || ''),
        last_uid: Math.max(0, Number(client.mailbox.uidNext || 1) - 1),
        connected_at: new Date().toISOString(),
      };
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch {}
  }
}
