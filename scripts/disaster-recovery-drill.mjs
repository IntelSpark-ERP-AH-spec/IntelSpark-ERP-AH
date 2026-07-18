import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

function newestBackup(directory) {
  if (!fs.existsSync(directory)) throw new Error('Repertoire sauvegardes introuvable');
  const files = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.db'))
    .map((name) => ({ name, modified: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((a, b) => b.modified - a.modified);
  if (!files.length) throw new Error('Aucune sauvegarde disponible');
  return path.join(directory, files[0].name);
}

const backupDirectory = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'));
const source = path.resolve(process.env.BACKUP_FILE || newestBackup(backupDirectory));
if (!fs.existsSync(source)) throw new Error('Fichier sauvegarde introuvable');

const drillDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelsheets-recovery-'));
const restoredPath = path.join(drillDirectory, 'restored.db');
fs.copyFileSync(source, restoredPath);

try {
  const database = new Database(restoredPath, { fileMustExist: true });
  database.pragma('foreign_keys = ON');
  const quickCheck = database.pragma('quick_check', { simple: true });
  if (quickCheck !== 'ok') throw new Error('Integrite SQLite invalide');
  const foreignViolations = database.pragma('foreign_key_check');
  if (foreignViolations.length) throw new Error(`Violations relations: ${foreignViolations.length}`);

  const requiredTables = ['users', 'audit_log', 'user_documents', 'team_documents', 'schema_migrations'];
  const available = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  const missing = requiredTables.filter((table) => !available.has(table));
  if (missing.length) throw new Error(`Tables absentes: ${missing.join(', ')}`);

  const counts = {};
  for (const table of requiredTables) {
    counts[table] = database.prepare(`SELECT COUNT(*) AS total FROM "${table}"`).get().total;
  }
  database.pragma('wal_checkpoint(TRUNCATE)');
  database.close();

  process.stdout.write(`${JSON.stringify({
    success: true,
    source,
    source_size_bytes: fs.statSync(source).size,
    quick_check: quickCheck,
    foreign_key_violations: 0,
    required_tables: requiredTables,
    row_counts: counts,
  }, null, 2)}\n`);
} finally {
  fs.rmSync(drillDirectory, { recursive: true, force: true });
}
