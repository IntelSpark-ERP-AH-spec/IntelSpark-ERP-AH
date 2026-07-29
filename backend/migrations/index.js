import crypto from 'crypto';
import { upgradeSecret } from '../secrets.js';

function getTableColumns(db, table) {
  if (db.engine === 'postgres') {
    return new Set(
      db.prepare(`
        SELECT column_name AS name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?
      `).all(table).map((entry) => entry.name),
    );
  }
  return new Set(db.prepare(`PRAGMA table_info('${table}')`).all().map((entry) => entry.name));
}

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
      const columns = getTableColumns(db, 'users');
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
      const addColumn = (table, column, definition) => {
        const columns = getTableColumns(db, table);
        if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      };
      addColumn('users', 'mail_connected_at', 'TEXT');
      addColumn('users', 'mail_last_uid', 'INTEGER NOT NULL DEFAULT 0');
      addColumn('users', 'mail_uid_validity', 'TEXT');
      addColumn('users', 'mail_last_sync_at', 'TEXT');
      addColumn('email_history', 'sender_name', 'TEXT');
      addColumn('email_history', 'sender_email', 'TEXT');
      addColumn('email_history', 'account_email', 'TEXT');
      addColumn('email_history', 'is_read', 'INTEGER NOT NULL DEFAULT 1');
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
  {
    version: '20260718_013_organization_sync',
    description: 'Organisation, donnees partagees et parametres entreprise',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        realtime_topic TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`);
      db.prepare(`INSERT OR IGNORE INTO organizations (id, name, realtime_topic)
        VALUES (?, ?, ?)`)
        .run('org_default', 'IntelSpark ERP-AH', crypto.randomBytes(32).toString('hex'));

      const addColumn = (table, column, definition) => {
        const columns = getTableColumns(db, table);
        if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      };
      addColumn('users', 'organization_id', "TEXT DEFAULT 'org_default'");
      addColumn('produits', 'organization_id', "TEXT DEFAULT 'org_default'");
      addColumn('stock_mouvements', 'organization_id', "TEXT DEFAULT 'org_default'");
      db.exec("UPDATE users SET organization_id='org_default' WHERE organization_id IS NULL OR organization_id=''");
      db.exec("UPDATE produits SET organization_id='org_default' WHERE organization_id IS NULL OR organization_id=''");
      db.exec(`UPDATE stock_mouvements SET organization_id = COALESCE(
        (SELECT organization_id FROM produits WHERE produits.id = stock_mouvements.produit_id),
        'org_default'
      ) WHERE organization_id IS NULL OR organization_id=''`);

      db.exec(`CREATE TABLE IF NOT EXISTS organization_documents (
        organization_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_by TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (organization_id, key),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS company_settings (
        organization_id TEXT PRIMARY KEY,
        company_name TEXT NOT NULL DEFAULT '',
        company_address TEXT NOT NULL DEFAULT '',
        company_phone TEXT NOT NULL DEFAULT '',
        company_email TEXT NOT NULL DEFAULT '',
        legal_mentions TEXT NOT NULL DEFAULT '',
        logo_url TEXT,
        brands_json TEXT NOT NULL DEFAULT '[]',
        updated_by TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )`);
      db.prepare('INSERT OR IGNORE INTO company_settings (organization_id) VALUES (?)').run('org_default');
      db.exec('CREATE INDEX IF NOT EXISTS idx_organization_documents_updated ON organization_documents(organization_id, updated_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_produits_organization_active ON produits(organization_id, actif, designation)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_stock_mouvements_organization_date ON stock_mouvements(organization_id, created_at DESC)');

      const admin = db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY CASE WHEN lower(username)='admin' THEN 0 ELSE 1 END, created_at, id LIMIT 1").get();
      if (admin) {
        const privateKeys = new Set([
          'ui_session_state', 'user_preferences', 'is_theme', 'is_lang', 'is_currency',
          'is_font_size', 'is_font_family', 'is_font_color', 'is_active_page',
        ]);
        const rows = db.prepare('SELECT key, value_json, updated_at FROM user_documents WHERE user_id=?').all(admin.id);
        const insertDocument = db.prepare(`INSERT OR IGNORE INTO organization_documents
          (organization_id, key, value_json, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)`);
        for (const row of rows) {
          if (!privateKeys.has(row.key)) insertDocument.run('org_default', row.key, row.value_json, admin.id, row.updated_at);
        }
      }
    },
  },
  {
    version: '20260729_014_company_activity',
    description: 'Activite entreprise modifiable et partagee',
    up(db) {
      const columns = getTableColumns(db, 'company_settings');
      if (!columns.has('company_activity')) {
        db.exec(`ALTER TABLE company_settings ADD COLUMN company_activity TEXT NOT NULL
          DEFAULT 'Importateur et Distributeur de Piece de Rechange de Poids Lourd'`);
      }
      db.exec(`UPDATE company_settings
        SET company_activity = 'Importateur et Distributeur de Piece de Rechange de Poids Lourd'
        WHERE company_activity IS NULL OR trim(company_activity) = ''`);
    },
  },
  {
    version: '20260729_015_message_organization_scope',
    description: 'Isolation organisationnelle des messages',
    up(db) {
      const columns = getTableColumns(db, 'messages');
      if (!columns.has('organization_id')) {
        db.exec("ALTER TABLE messages ADD COLUMN organization_id TEXT DEFAULT 'org_default'");
      }
      db.exec(`UPDATE messages
        SET organization_id = COALESCE(
          (SELECT users.organization_id FROM users WHERE users.id = messages.sender_id),
          'org_default'
        )
        WHERE organization_id IS NULL OR organization_id = ''`);
      db.exec('CREATE INDEX IF NOT EXISTS idx_messages_organization_created ON messages(organization_id, created_at DESC)');
    },
  },
  {
    version: '20260729_016_gmail_multi_accounts',
    description: 'Comptes Gmail personnels et partages avec permissions',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS email_accounts (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        user_id TEXT,
        account_type TEXT NOT NULL CHECK(account_type IN ('personal','organization','shared')),
        email_address TEXT NOT NULL,
        encrypted_app_password TEXT NOT NULL,
        sender_name TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
        is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
        smtp_enabled INTEGER NOT NULL DEFAULT 1 CHECK(smtp_enabled IN (0,1)),
        imap_enabled INTEGER NOT NULL DEFAULT 1 CHECK(imap_enabled IN (0,1)),
        mail_connected_at TEXT,
        mail_last_uid INTEGER NOT NULL DEFAULT 0,
        mail_uid_validity TEXT,
        mail_last_sync_at TEXT,
        last_test_status TEXT,
        last_test_at TEXT,
        created_by TEXT,
        updated_by TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK(
          (account_type='personal' AND user_id IS NOT NULL)
          OR (account_type IN ('organization','shared') AND user_id IS NULL)
        ),
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS email_account_permissions (
        id TEXT PRIMARY KEY,
        email_account_id TEXT NOT NULL,
        user_id TEXT,
        role_name TEXT,
        can_send INTEGER NOT NULL DEFAULT 0 CHECK(can_send IN (0,1)),
        can_read INTEGER NOT NULL DEFAULT 0 CHECK(can_read IN (0,1)),
        allowed_document_types TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK(
          (user_id IS NOT NULL AND role_name IS NULL)
          OR (user_id IS NULL AND role_name IS NOT NULL)
        ),
        FOREIGN KEY (email_account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);
      db.exec(`CREATE TABLE IF NOT EXISTS email_account_preferences (
        user_id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        default_account_id TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
        FOREIGN KEY (default_account_id) REFERENCES email_accounts(id) ON DELETE SET NULL
      )`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS email_accounts_personal_user_unique
        ON email_accounts(organization_id,user_id) WHERE account_type='personal'`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS email_accounts_organization_email_unique
        ON email_accounts(organization_id,lower(email_address)) WHERE account_type IN ('organization','shared')`);
      db.exec('CREATE INDEX IF NOT EXISTS email_accounts_organization_active ON email_accounts(organization_id,is_active,account_type)');
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS email_permissions_account_user_unique
        ON email_account_permissions(email_account_id,user_id) WHERE user_id IS NOT NULL`);
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS email_permissions_account_role_unique
        ON email_account_permissions(email_account_id,role_name) WHERE role_name IS NOT NULL`);

      const addColumn = (table, column, definition) => {
        const columns = getTableColumns(db, table);
        if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      };
      addColumn('email_history', 'organization_id', 'TEXT');
      addColumn('email_history', 'email_account_id', 'TEXT');
      addColumn('email_history', 'sender_user_id', 'TEXT');
      addColumn('email_history', 'document_type', 'TEXT');
      addColumn('email_history', 'document_id', 'TEXT');
      addColumn('email_history', 'status', "TEXT NOT NULL DEFAULT 'sent'");
      addColumn('email_history', 'error_code', 'TEXT');

      db.exec(`UPDATE email_history
        SET organization_id = COALESCE(
          (SELECT users.organization_id FROM users WHERE users.id = email_history.user_id),
          'org_default'
        ),
        sender_user_id = COALESCE(sender_user_id, user_id)
        WHERE organization_id IS NULL OR sender_user_id IS NULL`);

      const legacyUsers = db.prepare(`SELECT id, organization_id, username, full_name, smtp_user, smtp_pass,
        mail_connected_at, mail_last_uid, mail_uid_validity, mail_last_sync_at
        FROM users
        WHERE smtp_user IS NOT NULL AND trim(smtp_user) != ''
          AND smtp_pass IS NOT NULL AND smtp_pass != ''`).all();
      for (const user of legacyUsers) {
        const existing = db.prepare(`SELECT id FROM email_accounts
          WHERE organization_id=? AND user_id=? AND account_type='personal'`).get(user.organization_id, user.id);
        const encrypted = upgradeSecret(user.smtp_pass);
        if (encrypted !== user.smtp_pass) {
          db.prepare('UPDATE users SET smtp_pass=? WHERE id=?').run(encrypted, user.id);
        }
        let accountId = existing?.id;
        if (!accountId) {
          accountId = crypto.randomUUID();
          db.prepare(`INSERT INTO email_accounts
            (id,organization_id,user_id,account_type,email_address,encrypted_app_password,sender_name,
             is_active,is_default,smtp_enabled,imap_enabled,mail_connected_at,mail_last_uid,
             mail_uid_validity,mail_last_sync_at,created_by,updated_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            accountId,
            user.organization_id || 'org_default',
            user.id,
            'personal',
            String(user.smtp_user).trim().toLowerCase(),
            encrypted,
            user.full_name || user.username || '',
            1,
            1,
            1,
            1,
            user.mail_connected_at,
            Number(user.mail_last_uid || 0),
            user.mail_uid_validity,
            user.mail_last_sync_at,
            user.id,
            user.id,
          );
        }
        db.prepare(`INSERT OR IGNORE INTO email_account_preferences
          (user_id,organization_id,default_account_id,updated_at)
          VALUES (?,?,?,datetime('now'))`).run(
          user.id,
          user.organization_id || 'org_default',
          accountId,
        );
      }

      db.exec(`UPDATE email_history
        SET email_account_id = (
          SELECT accounts.id
          FROM email_accounts accounts
          WHERE accounts.organization_id = email_history.organization_id
            AND lower(accounts.email_address) = lower(email_history.account_email)
            AND (accounts.user_id = email_history.user_id OR accounts.user_id IS NULL)
          LIMIT 1
        )
        WHERE email_account_id IS NULL AND account_email IS NOT NULL`);
      db.exec('CREATE INDEX IF NOT EXISTS email_history_organization_date ON email_history(organization_id,created_at DESC)');
      db.exec('CREATE INDEX IF NOT EXISTS email_history_account_date ON email_history(email_account_id,created_at DESC)');

      if (db.engine === 'postgres') {
        db.exec('ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY');
        db.exec('ALTER TABLE email_account_permissions ENABLE ROW LEVEL SECURITY');
        db.exec('ALTER TABLE email_account_preferences ENABLE ROW LEVEL SECURITY');
        db.exec('REVOKE ALL ON TABLE email_accounts FROM anon, authenticated');
        db.exec('REVOKE ALL ON TABLE email_account_permissions FROM anon, authenticated');
        db.exec('REVOKE ALL ON TABLE email_account_preferences FROM anon, authenticated');
      }
    },
  },
];

const LEGACY_MIGRATION_CHECKSUMS = new Map([
  ['20260713_006_drop_twofa_columns', new Set([
    '44f3192708f2b78a0870cb98c440c132acb186560099db87e46f3496473d248a',
  ])],
  ['20260716_010_gmail_inbox', new Set([
    '6ff7cb5df1c583a6362b27e36595ecd02948812c0feb94e0aeddea22510dbd06',
  ])],
  ['20260718_013_organization_sync', new Set([
    'b9f21617e784e637cf8c19e863627519d74be8de245a7622b5be4d5f8e227df0',
  ])],
]);

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
      const appliedChecksum = applied.get(migration.version);
      const acceptedLegacyChecksums = LEGACY_MIGRATION_CHECKSUMS.get(migration.version);
      if (appliedChecksum !== migrationChecksum && !acceptedLegacyChecksums?.has(appliedChecksum)) {
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
