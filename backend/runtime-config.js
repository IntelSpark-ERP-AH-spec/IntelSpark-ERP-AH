import { dbGet, dbQuery, dbRun } from './db.js';

const definitions = {
  maintenance_mode: { type: 'boolean', public: true },
  document_collaboration: { type: 'boolean', public: true },
  max_online_users: { type: 'integer', minimum: 10, maximum: 1000, public: true },
  company_timezone: { type: 'string', minimumLength: 3, maximumLength: 100, public: true },
  alert_memory_rss_mb: { type: 'integer', minimum: 256, maximum: 32768, public: false },
  alert_event_loop_ms: { type: 'integer', minimum: 25, maximum: 5000, public: false },
  external_backup_enabled: { type: 'boolean', public: false },
  system_announcement: { type: 'string', minimumLength: 0, maximumLength: 500, public: true },
  disabled_pages: { type: 'stringArray', maximumItems: 50, maximumItemLength: 64, public: true },
  site_agent_autonomy_enabled: { type: 'boolean', public: false },
  site_agent_autonomy_interval_minutes: { type: 'integer', minimum: 1, maximum: 1440, public: false },
  site_agent_last_heartbeat: { type: 'string', minimumLength: 0, maximumLength: 100, public: false },
  site_agent_last_cycle_summary: { type: 'string', minimumLength: 0, maximumLength: 2000, public: false },
};

function parseValue(row) {
  if (!row) return undefined;
  try { return JSON.parse(row.value_json); }
  catch { throw new Error(`Configuration invalide: ${row.key}`); }
}

function validateValue(key, value) {
  const definition = definitions[key];
  if (!definition) throw new Error('Cle configuration inconnue');
  if (definition.type === 'boolean' && typeof value !== 'boolean') throw new Error('Valeur booleenne requise');
  if (definition.type === 'integer') {
    if (!Number.isInteger(value)) throw new Error('Valeur entiere requise');
    if (value < definition.minimum || value > definition.maximum) throw new Error('Valeur hors limites');
  }
  if (definition.type === 'string') {
    if (typeof value !== 'string') throw new Error('Valeur texte requise');
    if (value.length < definition.minimumLength || value.length > definition.maximumLength) throw new Error('Longueur configuration invalide');
  }
  if (definition.type === 'stringArray') {
    if (!Array.isArray(value)) throw new Error('Liste requise');
    if (value.length > definition.maximumItems) throw new Error('Liste trop longue');
    if (value.some((item) => typeof item !== 'string' || !item.trim() || item.length > definition.maximumItemLength)) {
      throw new Error('Élément de liste invalide');
    }
    value = [...new Set(value.map((item) => item.trim()))];
  }
  if (key === 'external_backup_enabled' && value === true && (!process.env.S3_BACKUP_BUCKET || !process.env.S3_BACKUP_REGION)) {
    throw new Error('Configuration S3 requise avant activation');
  }
  return value;
}

export function getRuntimeConfig(key, fallback = undefined) {
  const row = dbGet('SELECT key, value_json FROM runtime_config WHERE key = ?', [key]);
  const parsed = parseValue(row);
  return parsed === undefined ? fallback : parsed;
}

export function listRuntimeConfig({ publicOnly = false } = {}) {
  const rows = dbQuery('SELECT key, value_json, updated_by, updated_at FROM runtime_config ORDER BY key');
  return rows
    .filter((row) => definitions[row.key] && (!publicOnly || definitions[row.key].public))
    .map((row) => ({
      key: row.key,
      value: parseValue(row),
      updated_by: publicOnly ? undefined : row.updated_by,
      updated_at: row.updated_at,
      definition: publicOnly ? undefined : definitions[row.key],
    }));
}

export function setRuntimeConfig(key, value, userId) {
  const validated = validateValue(key, value);
  dbRun(`INSERT INTO runtime_config (key, value_json, updated_by, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,
      updated_by=excluded.updated_by, updated_at=datetime('now')`,
  [key, JSON.stringify(validated), userId || null]);
  return { key, value: validated };
}

export function runtimeConfigDefinitions() {
  return structuredClone(definitions);
}
