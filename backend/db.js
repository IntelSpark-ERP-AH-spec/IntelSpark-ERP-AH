import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { runMigrations } from './migrations/index.js';
import { createPostgresAdapter } from './postgres-compat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'intelsheets.db'));

let db = null;

export function getDB() {
  if (!db) initDB();
  return db;
}

export function initDB() {
  if (db) return db;
  if (process.env.DATABASE_URL) {
    db = createPostgresAdapter(process.env.DATABASE_URL);
    db.prepare('SELECT 1 AS ok').get();
    console.log('Base PostgreSQL Supabase connectee');
    return db;
  }
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 10000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('mmap_size = 134217728');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'employe',
      email TEXT,
      full_name TEXT,
      department TEXT,
      active INTEGER DEFAULT 1,
      twofa_secret TEXT,
      twofa_enabled INTEGER DEFAULT 0,
      token_version INTEGER DEFAULT 0,
      login_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

  db.exec(`CREATE TABLE IF NOT EXISTS user_data (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS user_documents (
    user_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_documents_updated ON user_documents(user_id, updated_at DESC)');

  db.exec(`CREATE TABLE IF NOT EXISTS team_documents (
    team_key TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_by TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (team_key, key),
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_team_documents_updated ON team_documents(team_key, updated_at DESC)');

  db.exec(`CREATE TABLE IF NOT EXISTS produits (
    id TEXT PRIMARY KEY,
    reference TEXT UNIQUE NOT NULL,
    designation TEXT NOT NULL,
    categorie TEXT,
    prix_ht REAL DEFAULT 0,
    tva_rate REAL DEFAULT 20,
    unite TEXT DEFAULT 'pièce',
    stock_min REAL DEFAULT 0,
    stock_max REAL DEFAULT 0,
    prix_vente REAL DEFAULT 0,
    emplacement TEXT,
    fournisseur TEXT,
    code_barre TEXT,
    actif INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS stock_mouvements (
    id TEXT PRIMARY KEY,
    produit_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('entree','sortie','inventaire')),
    quantite REAL NOT NULL,
    stock_avant REAL NOT NULL,
    stock_apres REAL NOT NULL,
    motif TEXT,
    user_id TEXT,
    document_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (produit_id) REFERENCES produits(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    numero TEXT NOT NULL,
    client_nom TEXT,
    client_adresse TEXT,
    date_creation TEXT DEFAULT (datetime('now')),
    date_echeance TEXT,
    status TEXT DEFAULT 'brouillon',
    total_ht REAL DEFAULT 0,
    total_ttc REAL DEFAULT 0,
    user_id TEXT,
    data_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS document_items (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    produit_id TEXT,
    designation TEXT NOT NULL,
    quantite REAL DEFAULT 1,
    prix_ht REAL DEFAULT 0,
    tva_rate REAL DEFAULT 20,
    FOREIGN KEY (document_id) REFERENCES documents(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS employes (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    email TEXT,
    telephone TEXT,
    date_naissance TEXT,
    adresse TEXT,
    poste TEXT,
    departement TEXT,
    date_arrivee TEXT,
    date_depart TEXT,
    salaire_base REAL DEFAULT 0,
    status TEXT DEFAULT 'actif',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS contrats (
    id TEXT PRIMARY KEY,
    employe_id TEXT NOT NULL,
    type TEXT NOT NULL,
    date_debut TEXT NOT NULL,
    date_fin TEXT,
    salaire REAL,
    poste TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (employe_id) REFERENCES employes(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS absences (
    id TEXT PRIMARY KEY,
    employe_id TEXT NOT NULL,
    type TEXT NOT NULL,
    date_debut TEXT NOT NULL,
    date_fin TEXT,
    motif TEXT,
    valide INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (employe_id) REFERENCES employes(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS paies (
    id TEXT PRIMARY KEY,
    employe_id TEXT NOT NULL,
    mois TEXT NOT NULL,
    salaire_brut REAL DEFAULT 0,
    retenues REAL DEFAULT 0,
    primes REAL DEFAULT 0,
    net_a_payer REAL DEFAULT 0,
    status TEXT DEFAULT 'brouillon',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (employe_id) REFERENCES employes(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS comptabilite (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('recette','depense','transfert')),
    categorie TEXT,
    montant REAL NOT NULL,
    description TEXT,
    date_operation TEXT DEFAULT (datetime('now')),
    document_id TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    adresse TEXT,
    email TEXT,
    telephone TEXT,
    siret TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS warehouse_receptions (
    id TEXT PRIMARY KEY,
    produit_id TEXT NOT NULL,
    quantite_recue REAL NOT NULL,
    fournisseur TEXT,
    emplacement TEXT,
    bon_livraison TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (produit_id) REFERENCES produits(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS warehouse_preparations (
    id TEXT PRIMARY KEY,
    reference TEXT,
    produit_id TEXT NOT NULL,
    quantite REAL NOT NULL,
    status TEXT DEFAULT 'en_attente',
    destination TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (produit_id) REFERENCES produits(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS warehouse_expeditions (
    id TEXT PRIMARY KEY,
    preparation_id TEXT,
    produit_id TEXT NOT NULL,
    quantite REAL NOT NULL,
    client_nom TEXT,
    adresse_livraison TEXT,
    transporteur TEXT,
    status TEXT DEFAULT 'preparation',
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (produit_id) REFERENCES produits(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS rh_candidatures (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    prenom TEXT NOT NULL,
    email TEXT,
    telephone TEXT,
    poste TEXT,
    departement TEXT,
    date_candidature TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'nouveau',
    cv_url TEXT,
    notes TEXT,
    date_dernier_contact TEXT,
    employee_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS rh_formations (
    id TEXT PRIMARY KEY,
    titre TEXT NOT NULL,
    description TEXT,
    formateur TEXT,
    date_debut TEXT,
    date_fin TEXT,
    cout REAL DEFAULT 0,
    status TEXT DEFAULT 'planifiee',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS formation_participants (
    id TEXT PRIMARY KEY,
    formation_id TEXT NOT NULL,
    employe_id TEXT NOT NULL,
    FOREIGN KEY (formation_id) REFERENCES rh_formations(id),
    FOREIGN KEY (employe_id) REFERENCES employes(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS vehicules (
    id TEXT PRIMARY KEY,
    immatriculation TEXT UNIQUE NOT NULL,
    marque TEXT NOT NULL,
    modele TEXT NOT NULL,
    annee INTEGER,
    type TEXT NOT NULL CHECK(type IN ('camion','remorque','semi-remorque','utilitaire','autre')),
    poids_plafond REAL,
    capacite_charge REAL,
    nb_essieux INTEGER,
    proprietaire TEXT DEFAULT 'entreprise',
    vignette_critair TEXT,
    date_achat TEXT,
    date_dernier_ct TEXT,
    date_prochain_ct TEXT,
    kilometrage INTEGER DEFAULT 0,
    status TEXT DEFAULT 'actif' CHECK(status IN ('actif','en_maintenance','hors_service','vendu')),
    notes TEXT,
    conducteur_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conducteur_id) REFERENCES employes(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS maintenance_taches (
    id TEXT PRIMARY KEY,
    vehicule_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('vidange','freins','pneus','embrayage','boite','direction','suspension','electricite','climatisation','carrosserie','autre')),
    description TEXT NOT NULL,
    priorite TEXT DEFAULT 'normale' CHECK(priorite IN ('basse','normale','haute','urgente')),
    status TEXT DEFAULT 'planifiee' CHECK(status IN ('planifiee','en_cours','terminee','annulee')),
    date_planification TEXT,
    date_debut TEXT,
    date_fin TEXT,
    cout_pieces REAL DEFAULT 0,
    cout_main_oeuvre REAL DEFAULT 0,
    cout_total REAL DEFAULT 0,
    fournisseur TEXT,
    pieces_utilisees TEXT,
    notes TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (vehicule_id) REFERENCES vehicules(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS atelier_ordres (
    id TEXT PRIMARY KEY,
    numero TEXT UNIQUE NOT NULL,
    vehicule_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('maintenance','reparation','controle','montage','autre')),
    description TEXT NOT NULL,
    priorite TEXT DEFAULT 'normale',
    status TEXT DEFAULT 'en_attente' CHECK(status IN ('en_attente','en_cours','termine','annule')),
    date_debut TEXT,
    date_fin_prevue TEXT,
    date_fin_reelle TEXT,
    technicien_id TEXT,
    client_nom TEXT,
    client_vehicule_immat TEXT,
    notes TEXT,
    diagnostic TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (vehicule_id) REFERENCES vehicules(id),
    FOREIGN KEY (technicien_id) REFERENCES employes(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS atelier_operations (
    id TEXT PRIMARY KEY,
    ordre_id TEXT NOT NULL,
    description TEXT NOT NULL,
    duree_estimee REAL,
    duree_reelle REAL,
    main_oeuvre REAL DEFAULT 0,
    pieces_json TEXT,
    status TEXT DEFAULT 'en_attente',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (ordre_id) REFERENCES atelier_ordres(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS fournisseurs (
    id TEXT PRIMARY KEY,
    nom TEXT NOT NULL,
    contact TEXT,
    email TEXT,
    telephone TEXT,
    adresse TEXT,
    siret TEXT,
    ice TEXT,
    categorie TEXT,
    notes TEXT,
    actif INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS commandes_achat (
    id TEXT PRIMARY KEY,
    numero TEXT UNIQUE NOT NULL,
    fournisseur_id TEXT NOT NULL,
    date_commande TEXT DEFAULT (datetime('now')),
    date_livraison_prevue TEXT,
    status TEXT DEFAULT 'en_attente' CHECK(status IN ('en_attente','validee','livree_partielle','livree','annulee')),
    total_ht REAL DEFAULT 0,
    total_ttc REAL DEFAULT 0,
    notes TEXT,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (fournisseur_id) REFERENCES fournisseurs(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS commandes_achat_items (
    id TEXT PRIMARY KEY,
    commande_id TEXT NOT NULL,
    produit_id TEXT,
    designation TEXT NOT NULL,
    quantite_commandee REAL NOT NULL,
    quantite_recue REAL DEFAULT 0,
    prix_unitaire_ht REAL DEFAULT 0,
    tva_rate REAL DEFAULT 20,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (commande_id) REFERENCES commandes_achat(id),
    FOREIGN KEY (produit_id) REFERENCES produits(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS preparations_achat_local (
    id TEXT PRIMARY KEY,
    commande_id TEXT NOT NULL,
    fournisseur_nom TEXT NOT NULL,
    date_demande TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'en_projet' CHECK(status IN ('en_projet','envoye_fournisseur','annulee')),
    reception_status TEXT NOT NULL DEFAULT 'en_attente',
    total_ht REAL NOT NULL DEFAULT 0,
    items_json TEXT NOT NULL,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (commande_id) REFERENCES commandes_achat(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS preparations_importation (
    id TEXT PRIMARY KEY,
    numero TEXT,
    fournisseur_nom TEXT NOT NULL,
    eta TEXT,
    type_transport TEXT,
    status TEXT NOT NULL DEFAULT 'en_transit_international' CHECK(status IN ('en_transit_international','pret_reception','recu','annulee')),
    poids_total REAL NOT NULL DEFAULT 0,
    volume_total REAL NOT NULL DEFAULT 0,
    items_json TEXT NOT NULL,
    user_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    resource TEXT,
    resource_id TEXT,
    details TEXT,
    ip TEXT,
    user_agent TEXT,
    severity TEXT DEFAULT 'info' CHECK(severity IN ('info','warning','error','critical')),
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS sessions_blacklist (
    jti TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS echeancier (
    id TEXT PRIMARY KEY,
    document_number TEXT NOT NULL UNIQUE,
    source_devis_number TEXT,
    party_type TEXT NOT NULL DEFAULT 'client' CHECK(party_type IN ('client','fournisseur')),
    party_name TEXT NOT NULL,
    party_ice TEXT,
    invoice_date TEXT,
    due_date TEXT,
    amount REAL NOT NULL DEFAULT 0 CHECK(amount >= 0),
    currency TEXT NOT NULL DEFAULT 'MAD',
    status TEXT NOT NULL DEFAULT 'unpaid' CHECK(status IN ('unpaid','paid')),
    paid_at TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS echeancier_acknowledgements (
    id TEXT PRIMARY KEY,
    echeance_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    acknowledged_at TEXT DEFAULT (datetime('now')),
    UNIQUE(echeance_id, user_id),
    FOREIGN KEY (echeance_id) REFERENCES echeancier(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS echeancier_notification_acknowledgements (
    id TEXT PRIMARY KEY,
    echeance_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    phase TEXT NOT NULL CHECK(phase IN ('scheduled','due')),
    acknowledged_at TEXT DEFAULT (datetime('now')),
    UNIQUE(echeance_id, user_id, phase),
    FOREIGN KEY (echeance_id) REFERENCES echeancier(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT,
    recipient_role TEXT,
    content TEXT NOT NULL,
    doc_type TEXT,
    doc_id TEXT,
    doc_payload TEXT,
    read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS message_deletions (
    message_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS email_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'sent',
    correspondent TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS email_deletions (
    email_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (email_id, user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_email_history_user_date ON email_history(user_id, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_email_deletions_user ON email_deletions(user_id, created_at DESC)');

  db.exec(`CREATE TABLE IF NOT EXISTS backups_log (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    size_bytes INTEGER,
    status TEXT DEFAULT 'success',
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS pneus (
    id TEXT PRIMARY KEY,
    vehicule_id TEXT NOT NULL,
    position TEXT NOT NULL,
    marque TEXT,
    dimension TEXT,
    indice_vitesse TEXT,
    date_montage TEXT,
    kilometrage_montage INTEGER DEFAULT 0,
    pression_recommandee REAL,
    usure_percent REAL DEFAULT 0,
    status TEXT DEFAULT 'actif' CHECK(status IN ('actif','a_remplacer','remplace')),
    date_remplacement TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (vehicule_id) REFERENCES vehicules(id)
  )`);

  migrateSchema();
  runMigrations(db);
  createPerformanceIndexes();
  db.pragma('optimize');

  if (process.env.RESET_ADMIN_PASSWORD_ON_START === 'true' && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)) {
    throw new Error('ADMIN_PASSWORD fort requis pour reinitialisation');
  }
  seedInitialAdmin();
  if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get('admin')) {
    throw new Error('Creation administrateur impossible');
  }

  return db;
}

function migrateSchema() {
  try {
    const existingCols = db.prepare("SELECT name FROM pragma_table_info('users')").all().map(r => r.name);
    const userAdditions = {
      'email': 'TEXT',
      'full_name': 'TEXT',
      'department': 'TEXT',
      'active': 'INTEGER DEFAULT 1',
      'login_attempts': 'INTEGER DEFAULT 0',
      'locked_until': 'TEXT',
      'last_login': 'TEXT',
      'smtp_user': 'TEXT',
      'smtp_pass': 'TEXT',
      'token_version': 'INTEGER DEFAULT 0',
    };
    for (const [col, type] of Object.entries(userAdditions)) {
      if (!existingCols.includes(col)) {
        db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
      }
    }
    if (existingCols.includes('id') && !existingCols.includes('full_name')) {
      console.log('✓ Schéma users migré');
    }

    const existingComptaCols = db.prepare("SELECT name FROM pragma_table_info('comptabilite')").all().map(r => r.name);
    if (!existingComptaCols.includes('compte')) {
      db.exec("ALTER TABLE comptabilite ADD COLUMN compte TEXT");
    }
    if (!existingComptaCols.includes('rapproche')) {
      db.exec("ALTER TABLE comptabilite ADD COLUMN rapproche INTEGER DEFAULT 0");
    }

    const existingPaiesCols = db.prepare("SELECT name FROM pragma_table_info('paies')").all().map(r => r.name);
    if (!existingPaiesCols.includes('heures')) {
      db.exec("ALTER TABLE paies ADD COLUMN heures TEXT DEFAULT '151.67'");
    }

    const existingCandidatureCols = db.prepare("SELECT name FROM pragma_table_info('rh_candidatures')").all().map(r => r.name);
    if (!existingCandidatureCols.includes('date_dernier_contact')) {
      db.exec("ALTER TABLE rh_candidatures ADD COLUMN date_dernier_contact TEXT");
    }
    if (!existingCandidatureCols.includes('employee_id')) {
      db.exec('ALTER TABLE rh_candidatures ADD COLUMN employee_id TEXT');
    }
    if (!existingCandidatureCols.includes('description_ia')) {
      db.exec('ALTER TABLE rh_candidatures ADD COLUMN description_ia TEXT');
    }

    const existingProduitCols = db.prepare("SELECT name FROM pragma_table_info('produits')").all().map(r => r.name);
    if (!existingProduitCols.includes('poids_unitaire')) {
      db.exec('ALTER TABLE produits ADD COLUMN poids_unitaire REAL');
    }
    if (!existingProduitCols.includes('volume_unitaire')) {
      db.exec('ALTER TABLE produits ADD COLUMN volume_unitaire REAL');
    }

    const existingLocalPurchaseCols = db.prepare("SELECT name FROM pragma_table_info('preparations_achat_local')").all().map(r => r.name);
    if (!existingLocalPurchaseCols.includes('reception_status')) {
      db.exec("ALTER TABLE preparations_achat_local ADD COLUMN reception_status TEXT NOT NULL DEFAULT 'en_attente'");
    }

    const existingImportCols = db.prepare("SELECT name FROM pragma_table_info('preparations_importation')").all().map(r => r.name);
    if (!existingImportCols.includes('numero')) {
      db.exec('ALTER TABLE preparations_importation ADD COLUMN numero TEXT');
    }

    const existingTeamDocCols = db.prepare("SELECT name FROM pragma_table_info('team_documents')").all().map(r => r.name);
    if (!existingTeamDocCols.includes('version')) {
      db.exec('ALTER TABLE team_documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    }

    const existingMessageCols = db.prepare("SELECT name FROM pragma_table_info('messages')").all().map(r => r.name);
    if (!existingMessageCols.includes('doc_payload')) {
      db.exec('ALTER TABLE messages ADD COLUMN doc_payload TEXT');
    }
  } catch (err) {
    console.error('Erreur migration schéma:', err.message);
  }
}

function createPerformanceIndexes() {
  const definitions = [
    ['idx_users_active_role', 'users', ['active', 'role'], 'CREATE INDEX IF NOT EXISTS idx_users_active_role ON users(active, role)'],
    ['idx_users_active_department', 'users', ['active', 'department'], 'CREATE INDEX IF NOT EXISTS idx_users_active_department ON users(active, department)'],
    ['idx_users_email_active', 'users', ['email', 'active'], 'CREATE INDEX IF NOT EXISTS idx_users_email_active ON users(email, active)'],
    ['idx_audit_created', 'audit_log', ['created_at'], 'CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)'],
    ['idx_audit_user_created', 'audit_log', ['user_id', 'created_at'], 'CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_log(user_id, created_at DESC)'],
    ['idx_sessions_expiry', 'sessions_blacklist', ['expires_at'], 'CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions_blacklist(expires_at)'],
    ['idx_notifications_user_read_date', 'notifications', ['user_id', 'read', 'created_at'], 'CREATE INDEX IF NOT EXISTS idx_notifications_user_read_date ON notifications(user_id, read, created_at DESC)'],
    ['idx_echeancier_status_due', 'echeancier', ['status', 'due_date'], 'CREATE INDEX IF NOT EXISTS idx_echeancier_status_due ON echeancier(status, due_date)'],
    ['idx_echeancier_ack_user', 'echeancier_acknowledgements', ['user_id', 'echeance_id'], 'CREATE INDEX IF NOT EXISTS idx_echeancier_ack_user ON echeancier_acknowledgements(user_id, echeance_id)'],
    ['idx_echeancier_notification_ack_user', 'echeancier_notification_acknowledgements', ['user_id', 'echeance_id', 'phase'], 'CREATE INDEX IF NOT EXISTS idx_echeancier_notification_ack_user ON echeancier_notification_acknowledgements(user_id, echeance_id, phase)'],
    ['idx_messages_recipient_read_date', 'messages', ['recipient_id', 'read', 'created_at'], 'CREATE INDEX IF NOT EXISTS idx_messages_recipient_read_date ON messages(recipient_id, read, created_at DESC)'],
    ['idx_messages_role_read_date', 'messages', ['recipient_role', 'read', 'created_at'], 'CREATE INDEX IF NOT EXISTS idx_messages_role_read_date ON messages(recipient_role, read, created_at DESC)'],
    ['idx_messages_conversation_date', 'messages', ['sender_id', 'recipient_id', 'created_at'], 'CREATE INDEX IF NOT EXISTS idx_messages_conversation_date ON messages(sender_id, recipient_id, created_at DESC)'],
    ['idx_stock_product_date', 'stock_mouvements', ['produit_id', 'created_at'], 'CREATE INDEX IF NOT EXISTS idx_stock_product_date ON stock_mouvements(produit_id, created_at DESC)'],
    ['idx_document_items_document', 'document_items', ['document_id'], 'CREATE INDEX IF NOT EXISTS idx_document_items_document ON document_items(document_id)'],
    ['idx_backups_created', 'backups_log', ['created_at'], 'CREATE INDEX IF NOT EXISTS idx_backups_created ON backups_log(created_at DESC)'],
  ];

  for (const [, table, columns, statement] of definitions) {
    const existing = new Set(db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all().map((row) => row.name));
    if (columns.every((column) => existing.has(column))) db.exec(statement);
  }
}

function seedInitialAdmin() {
  try {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (existing) {
      if (process.env.RESET_ADMIN_PASSWORD_ON_START === 'true') {
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminPassword || adminPassword.length < 12) throw new Error('ADMIN_PASSWORD fort requis pour reinitialisation');
        const hash = bcrypt.hashSync(adminPassword, 12);
        db.prepare('UPDATE users SET password = ?, active = 1, role = ?, token_version = token_version + 1 WHERE username = ?').run(hash, 'admin', 'admin');
        console.log('Compte admin reinitialise explicitement');
      }
      return;
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || adminPassword.length < 12) {
      throw new Error('ADMIN_PASSWORD fort requis pour creer le premier administrateur');
    }
    const hash = bcrypt.hashSync(adminPassword, 12);
    const idColumn = db.prepare("SELECT type FROM pragma_table_info('users') WHERE name='id'").get();
    if (/INT/i.test(String(idColumn?.type || ''))) {
      db.prepare('INSERT INTO users (username, password, role, full_name, email, department, active) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('admin', hash, 'admin', 'Administrateur', 'admin@intelsheets.com', 'direction', 1);
    } else {
      db.prepare('INSERT INTO users (id, username, password, role, full_name, email, department, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), 'admin', hash, 'admin', 'Administrateur', 'admin@intelsheets.com', 'direction', 1);
    }
    console.log('Compte admin cree');
  } catch (err) {
    console.error('Erreur création admin:', err.message, err.stack);
  }
}

export function dbQuery(sql, params = []) {
  const d = getDB();
  const stmt = d.prepare(sql);
  if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('WITH')) {
    return stmt.all(...params);
  } else {
    return stmt.run(...params);
  }
}

export function dbRun(sql, params = []) {
  const d = getDB();
  return d.prepare(sql).run(...params);
}

export function dbGet(sql, params = []) {
  const d = getDB();
  return d.prepare(sql).get(...params);
}

export function dbTransaction(fn) {
  const d = getDB();
  const tx = d.transaction(fn);
  return tx();
}

export function closeDB() {
  if (db) {
    db.close();
    db = null;
  }
}

export function backupDB(destPath) {
  const d = getDB();
  if (d.engine === 'postgres') {
    throw new Error('Sauvegardes gerees automatiquement par Supabase');
  }
  return d.backup(destPath);
}

export function optimizeDB() {
  const d = getDB();
  if (d.engine === 'postgres') return [];
  d.pragma('optimize');
  return d.pragma('wal_checkpoint(PASSIVE)');
}

export function restoreDB(sourcePath) {
  if (getDB().engine === 'postgres') {
    throw new Error('Restauration SQLite indisponible avec Supabase');
  }
  const candidate = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const integrity = candidate.pragma('quick_check', { simple: true });
  candidate.close();
  if (integrity !== 'ok') throw new Error('Sauvegarde SQLite invalide');

  closeDB();
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${DB_PATH}${suffix}`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
  const staged = `${DB_PATH}.restore-${Date.now()}`;
  fs.copyFileSync(sourcePath, staged);
  fs.copyFileSync(staged, DB_PATH);
  fs.unlinkSync(staged);
  return initDB();
}
