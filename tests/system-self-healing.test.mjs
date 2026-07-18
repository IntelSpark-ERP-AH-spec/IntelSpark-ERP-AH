import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('real critical errors are repaired or recorded silently in the background', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelspark-healing-'));
  process.env.DB_PATH = path.join(directory, 'healing.db');
  process.env.ADMIN_PASSWORD = 'Admin-Test-2026-Secure';
  process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';

  const databaseModule = await import('../backend/db.js');
  const { runSelfHealingCycle } = await import('../backend/system-self-healing.js');
  databaseModule.initDB();

  t.after(() => {
    databaseModule.closeDB();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const repairedAlertId = randomUUID();
  databaseModule.dbRun(`INSERT INTO system_alerts
    (id, severity, source, message, details_json) VALUES (?, 'critical', 'database', ?, '{}')`,
  [repairedAlertId, 'Base de donnees inaccessible']);

  const repaired = runSelfHealingCycle({ alertIds: [repairedAlertId] });
  assert.equal(repaired.attempted, 1);
  assert.equal(repaired.repaired, 1);
  assert.equal(repaired.failed, 0);
  const repairedRow = databaseModule.dbGet('SELECT resolved, details_json FROM system_alerts WHERE id = ?', [repairedAlertId]);
  assert.equal(repairedRow.resolved, 1);
  assert.equal(JSON.parse(repairedRow.details_json).self_healing.status, 'repaired');

  const failedAlertId = randomUUID();
  databaseModule.dbRun(`INSERT INTO system_alerts
    (id, severity, source, message, details_json) VALUES (?, 'critical', 'server:GET:/api/failure', ?, '{}')`,
  [failedAlertId, 'Erreur serveur non gérée']);

  const failed = runSelfHealingCycle({ alertIds: [failedAlertId] });
  assert.equal(failed.attempted, 1);
  assert.equal(failed.repaired, 0);
  assert.equal(failed.failed, 1);
  assert.equal(failed.notifications, 0);
  const failedRow = databaseModule.dbGet('SELECT resolved, details_json FROM system_alerts WHERE id = ?', [failedAlertId]);
  assert.equal(failedRow.resolved, 0);
  assert.equal(JSON.parse(failedRow.details_json).self_healing.status, 'failed');
  const adminNotice = databaseModule.dbGet(`SELECT id FROM notifications
    WHERE type IN ('system', 'security') ORDER BY created_at DESC LIMIT 1`);
  assert.equal(adminNotice, undefined);
  const hiddenEvent = databaseModule.dbGet(`SELECT event_type, action_taken FROM site_agent_autonomy_events
    WHERE fingerprint = ?`, [`self-healing-failed:${failedAlertId}`]);
  assert.equal(hiddenEvent.event_type, 'system_error_repair_failed');
  assert.equal(hiddenEvent.action_taken, 'logged_background');
});
