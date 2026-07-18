import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbQuery, dbRun, getDB } from './db.js';
import { getRuntimeConfig } from './runtime-config.js';

let cycleRunning = false;

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || '{}'); }
  catch { return fallback; }
}

function eventOnce(fingerprint, eventType, severity, details, actionTaken) {
  return dbRun(`INSERT OR IGNORE INTO site_agent_autonomy_events
    (id, fingerprint, event_type, severity, details_json, action_taken)
    VALUES (?, ?, ?, ?, ?, ?)`,
  [uuidv4(), fingerprint, eventType, severity, JSON.stringify(details), actionTaken]).changes > 0;
}

function updateRecovery(alert, patch) {
  const details = parseJson(alert.details_json);
  const selfHealing = { ...(details.self_healing || {}), ...patch };
  dbRun('UPDATE system_alerts SET details_json = ? WHERE id = ? AND resolved = 0',
    [JSON.stringify({ ...details, self_healing: selfHealing }), alert.id]);
  alert.details_json = JSON.stringify({ ...details, self_healing: selfHealing });
}

function resolveAlert(alert, result) {
  updateRecovery(alert, {
    status: 'repaired',
    completed_at: new Date().toISOString(),
    action: result.action,
    result: result.details || null,
    error: null,
  });
  dbRun(`UPDATE system_alerts SET resolved = 1, resolved_at = datetime('now')
    WHERE id = ? AND resolved = 0`, [alert.id]);
  return eventOnce(`self-healing-repaired:${alert.id}`, 'system_error_repaired', 'info', {
    alert_id: alert.id, source: alert.source, message: alert.message, result,
  }, result.action);
}

function recordFailedRepair(alert, error) {
  if (!eventOnce(`self-healing-failed:${alert.id}`, 'system_error_repair_failed', 'critical', {
    alert_id: alert.id, source: alert.source, message: alert.message, error,
  }, 'logged_background')) return { events: 0, notifications: 0 };
  return { events: 1, notifications: 0 };
}

export function repairStrategyForAlert(alert) {
  const source = String(alert?.source || '').toLowerCase();
  const message = String(alert?.message || '');
  if (source === 'database' || message === 'Base de donnees inaccessible') return 'database_recovery';
  if (source === 'runtime' && message === 'Memoire processus elevee') return 'memory_recovery';
  if (source === 'http' && message === 'Taux erreurs serveur eleve') return 'http_diagnostic';
  return 'diagnostic_only';
}

export function attemptAlertRepair(alert) {
  const strategy = repairStrategyForAlert(alert);
  if (strategy === 'database_recovery') {
    const database = getDB();
    const integrity = database.pragma('quick_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`Intégrité SQLite invalide: ${integrity}`);
    const checkpoint = database.pragma('wal_checkpoint(PASSIVE)');
    database.pragma('optimize');
    return { repaired: true, action: 'sqlite_check_checkpoint_optimize', details: { integrity, checkpoint } };
  }

  if (strategy === 'memory_recovery') {
    if (typeof global.gc !== 'function') {
      throw new Error('Collecteur mémoire automatique indisponible; redémarrage contrôlé requis');
    }
    global.gc();
    const memoryRssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const thresholdMb = Number(getRuntimeConfig('alert_memory_rss_mb', 1024));
    if (memoryRssMb > thresholdMb) {
      throw new Error(`Mémoire toujours élevée: ${memoryRssMb} MB sur seuil ${thresholdMb} MB`);
    }
    return { repaired: true, action: 'forced_garbage_collection', details: { memory_rss_mb: memoryRssMb, threshold_mb: thresholdMb } };
  }

  if (strategy === 'http_diagnostic') {
    const integrity = getDB().pragma('quick_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`Diagnostic SQLite échoué: ${integrity}`);
    throw new Error('Origine HTTP non réparable automatiquement; diagnostic base réussi');
  }

  const databaseReady = dbGet('SELECT 1 AS ok')?.ok === 1;
  throw new Error(databaseReady
    ? 'Aucune correction sûre disponible; diagnostic base réussi'
    : 'Diagnostic base indisponible');
}

export function runSelfHealingCycle({ alertIds = null } = {}) {
  if (cycleRunning) return { skipped: true, reason: 'cycle_running' };
  cycleRunning = true;
  const summary = { checked: 0, attempted: 0, repaired: 0, failed: 0, notifications: 0, events: 0 };
  try {
    const params = [];
    let sql = `SELECT id, severity, source, message, details_json, created_at FROM system_alerts
      WHERE resolved = 0 AND severity = 'critical'`;
    if (Array.isArray(alertIds) && alertIds.length) {
      sql += ` AND id IN (${alertIds.map(() => '?').join(',')})`;
      params.push(...alertIds);
    }
    sql += ' ORDER BY created_at';
    const alerts = dbQuery(sql, params);
    summary.checked = alerts.length;

    for (const alert of alerts) {
      const previous = parseJson(alert.details_json)?.self_healing;
      if (['repaired', 'failed'].includes(previous?.status)) continue;
      summary.attempted += 1;
      updateRecovery(alert, { status: 'attempting', started_at: new Date().toISOString(), strategy: repairStrategyForAlert(alert) });
      try {
        const result = attemptAlertRepair(alert);
        if (!result?.repaired) throw new Error('Correction automatique non confirmée');
        summary.repaired += 1;
        if (resolveAlert(alert, result)) summary.events += 1;
      } catch (error) {
        const message = String(error?.message || 'Correction automatique échouée').slice(0, 500);
        updateRecovery(alert, { status: 'failed', completed_at: new Date().toISOString(), error: message });
        summary.failed += 1;
        const recorded = recordFailedRepair(alert, message);
        summary.notifications += recorded.notifications;
        summary.events += recorded.events;
      }
    }
    return summary;
  } finally {
    cycleRunning = false;
  }
}
