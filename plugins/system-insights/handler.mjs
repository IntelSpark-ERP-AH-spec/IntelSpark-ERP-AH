import { dbGet, getDB } from '../../backend/db.js';
import { getConnectionStats } from '../../backend/websocket.js';
import { migrationStatus } from '../../backend/migrations/index.js';

export async function execute({ action }) {
  if (action !== 'summary') throw Object.assign(new Error('Action inconnue'), { status: 404 });
  const migrations = migrationStatus(getDB());
  return {
    users: dbGet('SELECT COUNT(*) AS total FROM users WHERE active = 1')?.total || 0,
    unread_alerts: dbGet('SELECT COUNT(*) AS total FROM system_alerts WHERE resolved = 0')?.total || 0,
    migrations_applied: migrations.filter((migration) => migration.applied).length,
    migrations_total: migrations.length,
    realtime: getConnectionStats(),
    generated_at: new Date().toISOString(),
  };
}
