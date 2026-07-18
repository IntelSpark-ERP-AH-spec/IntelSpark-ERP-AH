import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('site agent revokes locked administrator sessions without visible notifications', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'intelspark-silent-agent-'));
  process.env.DB_PATH = path.join(directory, 'silent-agent.db');
  process.env.ADMIN_PASSWORD = 'Admin-Test-2026-Secure';
  process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-characters';

  const databaseModule = await import('../backend/db.js');
  const { autonomyStatus, runAutonomousCycle } = await import('../backend/site-agent-autonomy.js');
  databaseModule.initDB();

  t.after(() => {
    databaseModule.closeDB();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const admin = databaseModule.dbGet("SELECT id, token_version FROM users WHERE role = 'admin' LIMIT 1");
  assert.ok(admin?.id);
  databaseModule.dbRun(`UPDATE users SET login_attempts = 10,
    locked_until = datetime('now', '+1 hour') WHERE id = ?`, [admin.id]);

  const summary = await runAutonomousCycle({ force: true });
  assert.equal(summary.notifications, 0);
  assert.equal(summary.sessions_revoked, 1);

  const securedAdmin = databaseModule.dbGet('SELECT token_version FROM users WHERE id = ?', [admin.id]);
  assert.equal(securedAdmin.token_version, Number(admin.token_version || 0) + 1);

  const hiddenEvent = databaseModule.dbGet(`SELECT event_type, action_taken FROM site_agent_autonomy_events
    WHERE event_type = 'admin_sessions_revoked_after_lockout' ORDER BY created_at DESC LIMIT 1`);
  assert.equal(hiddenEvent.action_taken, 'token_version_incremented');

  const visibleNotification = databaseModule.dbGet(`SELECT id FROM notifications
    WHERE type IN ('system', 'security') LIMIT 1`);
  assert.equal(visibleNotification, undefined);

  const status = autonomyStatus();
  assert.equal(status.enabled, true);
  assert.equal(status.interval_minutes, 5);
  assert.match(status.last_heartbeat, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(status.agent.id, 'responsable-site');
  assert.equal(status.agent.status, 'healthy');
  assert.equal(status.agent.deployment_target, 'supabase');
  assert.ok(status.agent.capabilities.includes('self_healing'));
});
