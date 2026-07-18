import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', 'backups');

export function getBackupDir() {
  return path.resolve(process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR);
}

export function ensureBackupDir() {
  const directory = getBackupDir();
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function safeBackupPath(filename) {
  if (!/^[a-zA-Z0-9._-]+\.db$/.test(String(filename || ''))) {
    throw new Error('Nom sauvegarde invalide');
  }
  const directory = ensureBackupDir();
  const resolved = path.resolve(directory, filename);
  if (path.dirname(resolved) !== directory) throw new Error('Chemin sauvegarde invalide');
  return resolved;
}

export function backupRetentionCount() {
  const parsed = Number.parseInt(process.env.BACKUP_RETENTION || '50', 10);
  return Number.isInteger(parsed) && parsed >= 5 && parsed <= 500 ? parsed : 50;
}
