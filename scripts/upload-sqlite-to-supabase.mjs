import Database from 'better-sqlite3';
import path from 'node:path';

const dbPath = path.resolve(process.env.DB_PATH || 'data/intelsheets-supabase-export.db');
const endpoint = String(process.env.SUPABASE_MIGRATION_URL || '').trim();
const token = String(process.env.SUPABASE_MIGRATION_TOKEN || '').trim();
if (!endpoint) throw new Error('SUPABASE_MIGRATION_URL requis');
if (!token) throw new Error('SUPABASE_MIGRATION_TOKEN requis');

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('foreign_keys = ON');
if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Source SQLite invalide');

const quoteIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;
const tables = db.prepare(`SELECT name FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(row => row.name);

function jsonValue(value) {
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`;
  if (typeof value === 'bigint') return value.toString();
  return value;
}

async function request(body, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-migration-token': token,
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 300 * (2 ** (attempt - 1))));
    }
  }
  throw lastError;
}

let migrated = 0;
try {
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
    const primaryKeys = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
    if (!primaryKeys.length) throw new Error(`Clé primaire absente: ${table}`);
    const expected = db.prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(table)}`).get().total;
    const before = await request({ action: 'count', table });
    const existing = Number(before.count) || 0;
    if (existing > expected) throw new Error(`Données distantes inattendues ${table}: ${existing}/${expected}`);
    if (existing === expected) {
      process.stdout.write(`${table}: ${expected} déjà vérifiées\n`);
      continue;
    }
    const statement = db.prepare(`SELECT * FROM ${quoteIdentifier(table)} LIMIT -1 OFFSET ?`);
    let batch = [];
    let batchBytes = 0;

    const flush = async () => {
      if (!batch.length) return;
      await request({ table, conflict: primaryKeys.join(','), rows: batch });
      migrated += batch.length;
      batch = [];
      batchBytes = 0;
    };

    for (const sourceRow of statement.iterate(existing)) {
      const row = Object.fromEntries(Object.entries(sourceRow).map(([key, value]) => [key, jsonValue(value)]));
      const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
      if (batch.length && (batch.length >= 400 || batchBytes + rowBytes > 350000)) await flush();
      batch.push(row);
      batchBytes += rowBytes;
    }
    await flush();

    const remote = await request({ action: 'count', table });
    if (Number(remote.count) !== Number(expected)) {
      throw new Error(`Comptage divergent ${table}: ${remote.count}/${expected}`);
    }
    process.stdout.write(`${table}: ${expected}\n`);
  }
  process.stdout.write(`MIGRATION_OK ${migrated}\n`);
} finally {
  db.close();
}
