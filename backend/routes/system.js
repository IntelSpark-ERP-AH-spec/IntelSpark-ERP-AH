import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware, requireRole } from '../auth.js';
import { getDB, dbQuery, dbRun } from '../db.js';
import { migrationStatus } from '../migrations/index.js';
import { getRuntimeConfig, listRuntimeConfig, setRuntimeConfig } from '../runtime-config.js';

const router = Router();
router.use(authMiddleware);

function issueDetails(row) {
  try { return { ...row, details: JSON.parse(row.details_json || '{}'), details_json: undefined }; }
  catch { return { ...row, details: {}, details_json: undefined }; }
}

router.get('/config/public', (req, res) => {
  res.json(listRuntimeConfig({ publicOnly: true }));
});

router.get('/status', (req, res) => {
  try {
    getDB().prepare('SELECT 1 AS ok').get();
    const alerts = dbQuery(`SELECT id, severity, source, message, details_json, created_at
      FROM system_alerts WHERE resolved = 0 ORDER BY created_at DESC LIMIT 50`).map(issueDetails);
    const maintenance = Boolean(getRuntimeConfig('maintenance_mode', false));
    const issues = maintenance
      ? [{ id: 'maintenance', severity: 'warning', source: 'system', message: 'Mode maintenance actif', created_at: new Date().toISOString() }, ...alerts]
      : alerts;
    const critical = issues.some(issue => ['critical', 'error'].includes(issue.severity));
    return res.json({
      status: critical ? 'critical' : issues.length ? 'degraded' : 'operational',
      checked_at: new Date().toISOString(),
      services: { api: 'operational', database: 'operational' },
      issues,
    });
  } catch {
    return res.status(503).json({
      status: 'critical',
      checked_at: new Date().toISOString(),
      services: { api: 'operational', database: 'down' },
      issues: [{ severity: 'critical', source: 'database', message: 'Base de donnees inaccessible' }],
    });
  }
});

router.get('/config', requireRole('admin'), (req, res) => {
  res.json(listRuntimeConfig());
});

router.put('/config/:key', requireRole('admin'), (req, res) => {
  try {
    const result = setRuntimeConfig(req.params.key, req.body?.value, req.user.id);
    dbRun(`INSERT INTO audit_log (id, user_id, username, action, resource, resource_id, details, ip, user_agent, severity)
      VALUES (?, ?, ?, 'CONFIG_UPDATE', 'runtime_config', ?, ?, ?, ?, 'warning')`,
    [uuidv4(), req.user.id, req.user.username, req.params.key, JSON.stringify({ value: result.value }), req.ip, req.headers['user-agent'] || '']);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/migrations', requireRole('admin'), (req, res) => {
  res.json(migrationStatus(getDB()));
});

router.get('/alerts', requireRole('admin'), (req, res) => {
  const unresolvedOnly = req.query.resolved !== 'true';
  const sql = unresolvedOnly
    ? 'SELECT * FROM system_alerts WHERE resolved = 0 ORDER BY created_at DESC LIMIT 500'
    : 'SELECT * FROM system_alerts ORDER BY created_at DESC LIMIT 500';
  res.json(dbQuery(sql).map(issueDetails));
});

router.put('/alerts/:id/resolve', requireRole('admin'), (req, res) => {
  const result = dbRun(`UPDATE system_alerts SET resolved = 1, resolved_by = ?, resolved_at = datetime('now')
    WHERE id = ? AND resolved = 0`, [req.user.id, req.params.id]);
  if (!result.changes) return res.status(404).json({ error: 'Alerte introuvable' });
  return res.json({ success: true });
});

export default router;
