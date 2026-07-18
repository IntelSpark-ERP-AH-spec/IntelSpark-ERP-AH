import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { backupDB, dbRun, initDB, optimizeDB } from './db.js';
import { backupRetentionCount, ensureBackupDir, getBackupDir } from './backup-path.js';
import { getRuntimeConfig } from './runtime-config.js';
import { uploadOffsiteBackup } from './offsite-backup.js';

export async function doBackup() {
  try {
    const database = initDB();
    if (database.engine === 'postgres') {
      return { managed_by: 'supabase', skipped: true };
    }
    const backupDir = ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `intelsheets-auto-backup-${timestamp}.db`;
    const destPath = path.join(backupDir, filename);

    await backupDB(destPath);

    const stats = fs.statSync(destPath);
    const id = uuidv4();
    dbRun('INSERT INTO backups_log (id, filename, size_bytes) VALUES (?,?,?)', [id, filename, stats.size]);

    cleanupOldBackups();
    optimizeDB();
    if (getRuntimeConfig('external_backup_enabled', false)) {
      await uploadOffsiteBackup(destPath, filename);
    }
    return { id, filename, size_bytes: stats.size, path: destPath };
  } catch (err) {
    const id = uuidv4();
    dbRun('INSERT INTO backups_log (id, filename, status, error) VALUES (?,?,?,?)',
      [id, 'auto-backup-error', 'error', err.message]);
    throw err;
  }
}

function cleanupOldBackups() {
  try {
    const backupDir = getBackupDir();
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('intelsheets-auto-backup-'))
      .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);

    const MAX_BACKUPS = backupRetentionCount();
    if (files.length > MAX_BACKUPS) {
      for (const file of files.slice(MAX_BACKUPS)) {
        fs.unlinkSync(path.join(backupDir, file.name));
        dbRun('DELETE FROM backups_log WHERE filename = ?', [file.name]);
      }
    }
  } catch {}
}

export function scheduleBackup() {
  if (initDB().engine === 'postgres') {
    console.log('Sauvegardes PostgreSQL gerees par Supabase');
    return null;
  }
  doBackup().catch(() => {});
  const timer = setInterval(() => doBackup().catch(() => {}), 6 * 60 * 60 * 1000);
  console.log('Auto-backup toutes les 6 heures');
  return timer;
}
