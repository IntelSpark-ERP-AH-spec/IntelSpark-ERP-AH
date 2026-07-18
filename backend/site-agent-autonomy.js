import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbRun, dbTransaction } from './db.js';
import { getRuntimeConfig, setRuntimeConfig } from './runtime-config.js';
import { recordSystemError } from './monitoring.js';
import { runSelfHealingCycle } from './system-self-healing.js';

const MAX_EVENT_AGE_DAYS = 90;
const ACTION_EXPIRY_DAYS = 7;
const SITE_AGENT_ID = 'responsable-site';
const SITE_AGENT_CAPABILITIES = ['monitoring', 'self_healing', 'security', 'supervised_actions', 'memory'];
let cycleRunning = false;

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

function timeBucket(hours) {
  return Math.floor(Date.now() / (hours * 60 * 60 * 1000));
}

function recordEvent({ fingerprint, eventType, severity = 'info', details = {}, actionTaken = '' }) {
  const result = dbRun(`INSERT OR IGNORE INTO site_agent_autonomy_events
    (id, fingerprint, event_type, severity, details_json, action_taken)
    VALUES (?, ?, ?, ?, ?, ?)`,
  [uuidv4(), fingerprint, eventType, severity, JSON.stringify(details), actionTaken || null]);
  return result.changes > 0;
}

function syncAgentRegistry(status, heartbeat, cycle = {}) {
  dbRun(`INSERT INTO site_agent_registry
    (id, name, agent_type, status, model, runtime, deployment_target, capabilities_json,
      last_heartbeat, last_cycle_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, agent_type=excluded.agent_type, status=excluded.status,
      model=excluded.model, runtime=excluded.runtime, deployment_target=excluded.deployment_target,
      capabilities_json=excluded.capabilities_json, last_heartbeat=excluded.last_heartbeat,
      last_cycle_json=excluded.last_cycle_json, updated_at=datetime('now')`,
  [SITE_AGENT_ID, 'Responsable IA IntelSpark', 'site_responsible', status,
    process.env.SITE_AGENT_MODEL || 'llama-3.3-70b-versatile', 'node', 'supabase',
    JSON.stringify(SITE_AGENT_CAPABILITIES), heartbeat, JSON.stringify(cycle).slice(0, 2000)]);
}

function handleLockedAccounts(summary) {
  const lockedUsers = dbQuery(`SELECT id, username, role, locked_until FROM users
    WHERE active = 1 AND login_attempts >= 10 AND locked_until IS NOT NULL
      AND datetime(locked_until) > datetime('now')`);

  for (const user of lockedUsers) {
    const fingerprint = `locked-account:${user.id}:${user.locked_until}`;
    dbTransaction(() => {
      if (!recordEvent({
        fingerprint,
        eventType: user.role === 'admin' ? 'admin_sessions_revoked_after_lockout' : 'sessions_revoked_after_lockout',
        severity: 'critical',
        details: { user_id: user.id, username: user.username, role: user.role, locked_until: user.locked_until },
        actionTaken: 'token_version_incremented',
      })) return;
      dbRun('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?', [user.id]);
      summary.events += 1;
      summary.sessions_revoked += 1;
    });
  }
}

export function autonomyStatus() {
  const summaryValue = getRuntimeConfig('site_agent_last_cycle_summary', '{}');
  const registry = dbQuery('SELECT * FROM site_agent_registry WHERE id = ?', [SITE_AGENT_ID])[0];
  return {
    enabled: getRuntimeConfig('site_agent_autonomy_enabled', true),
    interval_minutes: getRuntimeConfig('site_agent_autonomy_interval_minutes', 5),
    last_heartbeat: getRuntimeConfig('site_agent_last_heartbeat', ''),
    last_cycle: parseJson(summaryValue, {}),
    running: cycleRunning,
    agent: registry ? {
      ...registry,
      capabilities: parseJson(registry.capabilities_json, []),
      last_cycle: parseJson(registry.last_cycle_json, {}),
      capabilities_json: undefined,
      last_cycle_json: undefined,
    } : null,
    events: dbQuery(`SELECT id, event_type, severity, details_json, action_taken, created_at
      FROM site_agent_autonomy_events ORDER BY created_at DESC LIMIT 20`).map((event) => ({
      ...event,
      details: parseJson(event.details_json, {}),
      details_json: undefined,
    })),
  };
}

export async function runAutonomousCycle({ force = false } = {}) {
  if (cycleRunning) return { skipped: true, reason: 'cycle_running', ...autonomyStatus() };
  if (!force && !getRuntimeConfig('site_agent_autonomy_enabled', true)) {
    return { enabled: false, skipped: true, reason: 'disabled' };
  }

  cycleRunning = true;
  const heartbeat = new Date().toISOString();
  const summary = {
    enabled: true,
    heartbeat,
    events: 0,
    notifications: 0,
    sessions_revoked: 0,
    expired_actions: 0,
    repair_attempts: 0,
    repairs_succeeded: 0,
    repair_failures: 0,
  };

  try {
    syncAgentRegistry('starting', heartbeat, summary);
    summary.expired_actions = dbRun(`UPDATE site_agent_actions SET status = 'expired'
      WHERE status = 'proposed' AND datetime(created_at) < datetime('now', ?)`, [`-${ACTION_EXPIRY_DAYS} days`]).changes;
    handleLockedAccounts(summary);
    const healing = runSelfHealingCycle();
    summary.repair_attempts = healing.attempted || 0;
    summary.repairs_succeeded = healing.repaired || 0;
    summary.repair_failures = healing.failed || 0;
    summary.notifications += healing.notifications || 0;
    summary.events += healing.events || 0;
    dbRun('DELETE FROM site_agent_autonomy_events WHERE datetime(created_at) < datetime(\'now\', ?)', [`-${MAX_EVENT_AGE_DAYS} days`]);
    setRuntimeConfig('site_agent_last_heartbeat', heartbeat, null);
    setRuntimeConfig('site_agent_last_cycle_summary', JSON.stringify(summary).slice(0, 2000), null);
    syncAgentRegistry('healthy', heartbeat, summary);
    return summary;
  } catch (error) {
    const failed = { ...summary, enabled: true, error: String(error?.message || 'Erreur autonomie').slice(0, 500) };
    setRuntimeConfig('site_agent_last_heartbeat', heartbeat, null);
    setRuntimeConfig('site_agent_last_cycle_summary', JSON.stringify(failed).slice(0, 2000), null);
    try { syncAgentRegistry('degraded', heartbeat, failed); } catch {}
    recordEvent({
      fingerprint: `cycle-error:${timeBucket(1)}`,
      eventType: 'autonomy_cycle_failed',
      severity: 'critical',
      details: { error: failed.error },
      actionTaken: 'logged',
    });
    try {
      const alert = recordSystemError(error, { operation: 'site-agent-autonomy', status: 500 });
      if (alert?.id) runSelfHealingCycle({ alertIds: [alert.id] });
    } catch {}
    return failed;
  } finally {
    cycleRunning = false;
  }
}

export function startSiteAgentAutonomy() {
  let stopped = false;
  let timer;
  const schedule = async () => {
    if (stopped) return;
    try {
      await runAutonomousCycle();
    } catch (error) {
      console.error('Cycle autonomie interrompu:', error?.message || error);
    } finally {
      if (!stopped) {
        let intervalMinutes = 5;
        try { intervalMinutes = getRuntimeConfig('site_agent_autonomy_interval_minutes', 5); }
        catch {}
        timer = setTimeout(schedule, Math.max(1, intervalMinutes) * 60 * 1000);
        timer.unref();
      }
    }
  };
  queueMicrotask(schedule);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
