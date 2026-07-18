import Database from 'better-sqlite3';
import pg from 'pg';

const { Client } = pg;
const sqlitePath = process.env.DB_PATH;
const databaseUrl = process.env.DATABASE_URL;
const confirmation = process.env.POSTGRES_MIGRATION_CONFIRM;

if (!sqlitePath) throw new Error('DB_PATH requis');
if (!databaseUrl) throw new Error('DATABASE_URL requis');
if (confirmation !== 'YES') throw new Error('POSTGRES_MIGRATION_CONFIRM=YES requis');

function identifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function postgresType(sqliteType) {
  const normalized = String(sqliteType || '').toUpperCase();
  if (normalized.includes('INT')) return 'BIGINT';
  if (normalized.includes('REAL') || normalized.includes('FLOA') || normalized.includes('DOUB')) return 'DOUBLE PRECISION';
  if (normalized.includes('BLOB')) return 'BYTEA';
  if (normalized.includes('BOOL')) return 'BOOLEAN';
  return 'TEXT';
}

function postgresDefault(value) {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim();
  if (/^\(?datetime\('now'\)\)?$/i.test(normalized) || /^CURRENT_TIMESTAMP$/i.test(normalized)) return ' DEFAULT CURRENT_TIMESTAMP';
  if (/^-?\d+(\.\d+)?$/.test(normalized)) return ` DEFAULT ${normalized}`;
  if (/^NULL$/i.test(normalized)) return ' DEFAULT NULL';
  if (/^'.*'$/.test(normalized)) return ` DEFAULT ${normalized}`;
  return '';
}

function foreignAction(value) {
  const allowed = new Set(['NO ACTION', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'CASCADE']);
  const normalized = String(value || 'NO ACTION').toUpperCase();
  return allowed.has(normalized) ? normalized : 'NO ACTION';
}

const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
sqlite.pragma('foreign_keys = ON');
const integrity = sqlite.pragma('quick_check', { simple: true });
if (integrity !== 'ok') throw new Error('Source SQLite invalide');
const sourceForeignViolations = sqlite.pragma('foreign_key_check');
if (sourceForeignViolations.length) {
  throw new Error(`Relations SQLite invalides: ${sourceForeignViolations.length}`);
}

const tables = sqlite.prepare(`SELECT name FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((row) => row.name);
const client = new Client({ connectionString: databaseUrl, ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
await client.connect();

try {
  const existing = await client.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
  if (existing.rows.length && process.env.POSTGRES_ALLOW_NONEMPTY !== 'true') {
    throw new Error('Base PostgreSQL non vide');
  }

  await client.query('BEGIN');
  const report = [];
  const constraints = [];

  for (const table of tables) {
    const columns = sqlite.prepare(`PRAGMA table_info(${identifier(table)})`).all();
    const primary = columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    const columnSql = columns.map((column) => {
      const primaryNotNull = primary.includes(column.name) ? ' NOT NULL' : '';
      const notNull = column.notnull ? ' NOT NULL' : primaryNotNull;
      return `${identifier(column.name)} ${postgresType(column.type)}${notNull}${postgresDefault(column.dflt_value)}`;
    });
    if (primary.length) columnSql.push(`PRIMARY KEY (${primary.map(identifier).join(', ')})`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${identifier(table)} (${columnSql.join(', ')})`);

    const rows = sqlite.prepare(`SELECT * FROM ${identifier(table)}`).all();
    for (const row of rows) {
      const names = Object.keys(row);
      const values = Object.values(row).map((value) => typeof value === 'bigint' ? value.toString() : value);
      const parameters = values.map((_, index) => `$${index + 1}`).join(', ');
      await client.query(`INSERT INTO ${identifier(table)} (${names.map(identifier).join(', ')}) VALUES (${parameters})`, values);
    }
    report.push({ table, rows: rows.length });
  }

  for (const table of tables) {
    const indexes = sqlite.prepare(`PRAGMA index_list(${identifier(table)})`).all();
    for (const index of indexes) {
      if (index.origin === 'pk') continue;
      const columns = sqlite.prepare(`PRAGMA index_info(${identifier(index.name)})`).all().sort((a, b) => a.seqno - b.seqno);
      if (!columns.length || columns.some((column) => !column.name)) continue;
      await client.query(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${identifier(index.name)}
        ON ${identifier(table)} (${columns.map((column) => identifier(column.name)).join(', ')})`);
    }
  }

  for (const table of tables) {
    const foreignKeys = sqlite.prepare(`PRAGMA foreign_key_list(${identifier(table)})`).all();
    const groups = new Map();
    for (const key of foreignKeys) {
      if (!groups.has(key.id)) groups.set(key.id, []);
      groups.get(key.id).push(key);
    }
    for (const [id, keys] of groups.entries()) {
      const ordered = keys.sort((a, b) => a.seq - b.seq);
      const constraint = `fk_${table}_${id}`.slice(0, 60);
      await client.query(`ALTER TABLE ${identifier(table)} ADD CONSTRAINT ${identifier(constraint)}
        FOREIGN KEY (${ordered.map((key) => identifier(key.from)).join(', ')})
        REFERENCES ${identifier(ordered[0].table)} (${ordered.map((key) => identifier(key.to)).join(', ')})
        ON UPDATE ${foreignAction(ordered[0].on_update)} ON DELETE ${foreignAction(ordered[0].on_delete)} NOT VALID`);
      constraints.push({ table, constraint });
    }
  }

  for (const { table, constraint } of constraints) {
    await client.query(`ALTER TABLE ${identifier(table)} VALIDATE CONSTRAINT ${identifier(constraint)}`);
  }

  for (const entry of report) {
    const result = await client.query(`SELECT COUNT(*)::bigint AS total FROM ${identifier(entry.table)}`);
    const targetCount = Number(result.rows[0].total);
    if (targetCount !== entry.rows) throw new Error(`Comptage divergent: ${entry.table}`);
  }

  await client.query('COMMIT');
  process.stdout.write(`${JSON.stringify({ success: true, tables: report, total_rows: report.reduce((sum, item) => sum + item.rows, 0) }, null, 2)}\n`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  sqlite.close();
  await client.end();
}
