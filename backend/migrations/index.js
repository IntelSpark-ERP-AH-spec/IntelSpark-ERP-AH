import crypto from 'crypto';

const migrations = [
  {
    version: '20260713_001_enterprise_core',
    description: 'Configuration dynamique et collaboration',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS runtime_config (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_by TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS collaboration_events (
        id TEXT PRIMARY KEY,
        team_key TEXT NOT NULL,
        document_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        actor_id TEXT,
        change_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS system_alerts (
        id TEXT PRIMARY KEY,
        severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        resolved_by TEXT,
        resolved_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS offsite_backups (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        provider TEXT NOT NULL,
        remote_key TEXT NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'success',
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
    },
  },
  {
    version: '20260713_002_enterprise_indexes',
    description: 'Index collaboration, alertes et sauvegardes',
    up(db) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_collaboration_document_version ON collaboration_events(team_key, document_key, version DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_collaboration_created ON collaboration_events(created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_system_alerts_open ON system_alerts(resolved, severity, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_offsite_backups_created ON offsite_backups(created_at DESC)');
    },
  },
  {
    version: '20260713_003_runtime_defaults',
    description: 'Valeurs dynamiques initiales',
    up(db) {
      const insert = db.prepare(`INSERT OR IGNORE INTO runtime_config (key, value_json)
        VALUES (?, ?)`);
      insert.run('maintenance_mode', JSON.stringify(false));
      insert.run('document_collaboration', JSON.stringify(true));
      insert.run('max_online_users', JSON.stringify(100));
      insert.run('company_timezone', JSON.stringify('Africa/Casablanca'));
      insert.run('alert_memory_rss_mb', JSON.stringify(1024));
      insert.run('alert_event_loop_ms', JSON.stringify(250));
    },
  },
  {
    version: '20260713_004_external_defaults',
    description: 'Activation sauvegardes externes et annonces',
    up(db) {
      const insert = db.prepare('INSERT OR IGNORE INTO runtime_config (key, value_json) VALUES (?, ?)');
      insert.run('external_backup_enabled', JSON.stringify(false));
      insert.run('system_announcement', JSON.stringify(''));
    },
  },
  {
    version: '20260713_005_remove_twofa',
    description: 'Suppression authentification double',
    up(db) {
      db.exec('UPDATE users SET twofa_secret = NULL, twofa_enabled = 0');
    },
  },
  {
    version: '20260713_006_drop_twofa_columns',
    description: 'Suppression colonnes authentification double',
    up(db) {
      const columns = new Set(db.prepare("PRAGMA table_info('users')").all().map((column) => column.name));
      if (columns.has('twofa_secret')) db.exec('ALTER TABLE users DROP COLUMN twofa_secret');
      if (columns.has('twofa_enabled')) db.exec('ALTER TABLE users DROP COLUMN twofa_enabled');
    },
  },
  {
    version: '20260715_007_site_agent',
    description: 'Agent responsable du site avec historique et memoire',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS site_agent_messages (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS site_agent_memory (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT,
        updated_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_site_agent_messages_user_date ON site_agent_messages(user_id, created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_site_agent_memory_updated ON site_agent_memory(updated_at DESC)');
    },
  },
  {
    version: '20260716_008_supervised_site_agent',
    description: 'Actions supervisees avec approbation administrateur',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS site_agent_actions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label TEXT NOT NULL,
        reason TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        risk TEXT NOT NULL CHECK(risk IN ('low','medium','high')),
        status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','executed','rejected','failed','expired')),
        source TEXT NOT NULL DEFAULT 'ai' CHECK(source IN ('ai','manual')),
        created_by TEXT,
        approved_by TEXT,
        result_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        approved_at TEXT,
        executed_at TEXT,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_site_agent_actions_status_date ON site_agent_actions(status, created_at DESC)');
      db.prepare(`INSERT OR IGNORE INTO runtime_config (key, value_json) VALUES (?, ?)`)
        .run('disabled_pages', JSON.stringify([]));
    },
  },
  {
    version: '20260716_009_site_agent_autonomy',
    description: 'Autonomie continue bornee, heartbeat et journal evenementiel',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS site_agent_autonomy_events (
        id TEXT PRIMARY KEY,
        fingerprint TEXT UNIQUE NOT NULL,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
        details_json TEXT,
        action_taken TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_site_agent_autonomy_events_date ON site_agent_autonomy_events(created_at DESC)');
      const insertConfig = db.prepare('INSERT OR IGNORE INTO runtime_config (key, value_json) VALUES (?, ?)');
      insertConfig.run('site_agent_autonomy_enabled', JSON.stringify(true));
      insertConfig.run('site_agent_autonomy_interval_minutes', JSON.stringify(5));
      insertConfig.run('site_agent_last_heartbeat', JSON.stringify(''));
      insertConfig.run('site_agent_last_cycle_summary', JSON.stringify('{}'));
    },
  },
  {
    version: '20260716_010_gmail_inbox',
    description: 'Boite Gmail continue, limite post-connexion, lecture et notifications',
    up(db) {
      db.exec('ALTER TABLE users ADD COLUMN mail_connected_at TEXT');
      db.exec('ALTER TABLE users ADD COLUMN mail_last_uid INTEGER NOT NULL DEFAULT 0');
      db.exec('ALTER TABLE users ADD COLUMN mail_uid_validity TEXT');
      db.exec('ALTER TABLE users ADD COLUMN mail_last_sync_at TEXT');
      db.exec('ALTER TABLE email_history ADD COLUMN sender_name TEXT');
      db.exec('ALTER TABLE email_history ADD COLUMN sender_email TEXT');
      db.exec('ALTER TABLE email_history ADD COLUMN account_email TEXT');
      db.exec('ALTER TABLE email_history ADD COLUMN is_read INTEGER NOT NULL DEFAULT 1');
      db.exec(`UPDATE users SET mail_connected_at = datetime('now'), mail_last_uid = -1
        WHERE smtp_user IS NOT NULL AND smtp_user != '' AND smtp_pass IS NOT NULL AND smtp_pass != ''
          AND mail_connected_at IS NULL`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_email_history_inbox ON email_history(user_id, direction, is_read, created_at DESC)');
    },
  },
  {
    version: '20260716_011_silent_site_agent',
    description: 'Agent de securite invisible avec suppression des alertes techniques visibles',
    up(db) {
      db.exec("DELETE FROM notifications WHERE type IN ('system', 'security')");
    },
  },
  {
    version: '20260717_012_site_agent_registry',
    description: 'Registre Supabase des agents, etat, modele et capacites',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS site_agent_registry (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'starting' CHECK(status IN ('starting','healthy','degraded','disabled')),
        model TEXT,
        runtime TEXT NOT NULL DEFAULT 'node',
        deployment_target TEXT NOT NULL DEFAULT 'supabase',
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        last_heartbeat TEXT,
        last_cycle_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_site_agent_registry_status_heartbeat ON site_agent_registry(status, last_heartbeat DESC)');
      db.prepare(`INSERT OR IGNORE INTO site_agent_registry
        (id, name, agent_type, status, model, runtime, deployment_target, capabilities_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('responsable-site', 'Responsable IA IntelSpark', 'site_responsible', 'starting',
          'llama-3.3-70b-versatile', 'node', 'supabase',
          JSON.stringify(['monitoring', 'self_healing', 'security', 'supervised_actions', 'memory']));
    },
  },
];

function checksum(migration) {
  return crypto.createHash('sha256')
    .update(`${migration.version}\n${migration.description}\n${migration.up.toString()}`)
    .digest('hex');
}

export function runMigrations(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  const appliedRows = db.prepare('SELECT version, checksum FROM schema_migrations').all();
  const applied = new Map(appliedRows.map((row) => [row.version, row.checksum]));
  const applyOne = db.transaction((migration, migrationChecksum) => {
    migration.up(db);
    db.prepare('INSERT INTO schema_migrations (version, description, checksum) VALUES (?, ?, ?)')
      .run(migration.version, migration.description, migrationChecksum);
  });

  for (const migration of migrations) {
    const migrationChecksum = checksum(migration);
    if (applied.has(migration.version)) {
      if (applied.get(migration.version) !== migrationChecksum) {
        throw new Error(`Migration modifiee apres application: ${migration.version}`);
      }
      continue;
    }
    applyOne(migration, migrationChecksum);
  }
}

export function migrationStatus(db) {
  const applied = new Map(db.prepare('SELECT version, applied_at FROM schema_migrations').all()
    .map((row) => [row.version, row.applied_at]));
  return migrations.map((migration) => ({
    version: migration.version,
    description: migration.description,
    applied: applied.has(migration.version),
    applied_at: applied.get(migration.version) || null,
    checksum: checksum(migration),
  }));
}
