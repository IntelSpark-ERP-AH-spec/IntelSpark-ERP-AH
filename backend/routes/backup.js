import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { dbQuery, dbRun, backupDB, restoreDB } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';
import { doBackup } from '../backup-service.js';
import { ensureBackupDir, safeBackupPath } from '../backup-path.js';
import { uploadOffsiteBackup } from '../offsite-backup.js';

const router = Router();
router.use(authMiddleware);
router.use(requireRole('admin'));

router.post('/', async (req, res) => {
  try {
    const backupDir = ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `intelsheets-backup-${timestamp}.db`;
    const destPath = path.join(backupDir, filename);

    await backupDB(destPath);
    const stats = fs.statSync(destPath);
    const id = uuidv4();
    dbRun('INSERT INTO backups_log (id, filename, size_bytes) VALUES (?,?,?)', [id, filename, stats.size]);
    res.json({ id, filename, size_bytes: stats.size, created_at: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: `Erreur sauvegarde: ${error.message}` });
  }
});

router.get('/', (req, res) => {
  res.json(dbQuery('SELECT * FROM backups_log ORDER BY created_at DESC LIMIT 50'));
});

router.get('/offsite', (req, res) => {
  res.json(dbQuery('SELECT * FROM offsite_backups ORDER BY created_at DESC LIMIT 100'));
});

router.post('/offsite/:filename', async (req, res) => {
  try {
    const filepath = safeBackupPath(req.params.filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Sauvegarde introuvable' });
    return res.json(await uploadOffsiteBackup(filepath, req.params.filename));
  } catch (error) {
    return res.status(502).json({ error: `Transfert externe impossible: ${error.message}` });
  }
});

router.post('/restore/:filename', async (req, res) => {
  try {
    const filepath = safeBackupPath(req.params.filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Sauvegarde introuvable' });
    await doBackup();
    restoreDB(filepath);
    res.json({ success: true, message: `Base restaurée depuis ${req.params.filename}` });
  } catch (error) {
    res.status(500).json({ error: `Erreur restauration: ${error.message}` });
  }
});

router.delete('/:filename', (req, res) => {
  try {
    const filepath = safeBackupPath(req.params.filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    dbRun('DELETE FROM backups_log WHERE filename = ?', [req.params.filename]);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
