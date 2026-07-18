import fs from 'fs';
import { Client } from 'pg';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  const envPath = new URL('../.env', import.meta.url);
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/^DATABASE_URL=(.*)$/m);
  if (!match) throw new Error('DATABASE_URL introuvable');
  return match[1].trim();
}

const connectionString = loadDatabaseUrl();
const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

const purgeTables = [
  'absences',
  'atelier_operations',
  'atelier_ordres',
  'clients',
  'commandes_achat_items',
  'commandes_achat',
  'comptabilite',
  'contrats',
  'document_items',
  'documents',
  'echeancier_acknowledgements',
  'echeancier_notification_acknowledgements',
  'echeancier',
  'email_history',
  'formation_participants',
  'fournisseurs',
  'maintenance_taches',
  'message_deletions',
  'messages',
  'notifications',
  'paies',
  'pneus',
  'preparations_achat_local',
  'preparations_importation',
  'produits',
  'rh_candidatures',
  'rh_formations',
  'stock_mouvements',
  'team_documents',
  'user_documents',
  'vehicules',
  'warehouse_expeditions',
  'warehouse_preparations',
  'warehouse_receptions',
];

const resettableUserDataKeys = [
  'is_catalog',
  'is_items',
  'is_leads',
  'is_clients',
  'is_saved_docs',
  'is_history_log',
  'is_doc_type',
  'is_doc_num',
  'is_doc_status',
  'is_doc_date',
  'is_validity_date',
  'is_client',
  'is_client_ice',
  'is_rep',
  'is_supplier',
  'is_order_ref',
  'is_source_devis',
  'is_payment',
  'is_due_date',
  'is_parent_fact',
  'is_counter_DEV',
  'is_counter_BL',
  'is_counter_BC',
  'is_counter_FACT',
  'is_counter_AVOIR',
];

function getUserRows(clientRows) {
  return clientRows.rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

async function main() {
  await client.connect();
  await client.query('BEGIN');

  const users = await client.query('SELECT id FROM users');
  const userIds = getUserRows(users);
  const resetVersion = new Date().toISOString();

  if (purgeTables.length > 0) {
    await client.query(`TRUNCATE TABLE ${purgeTables.map((table) => `"public"."${table}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }

  if (userIds.length > 0) {
    await client.query(
      `DELETE FROM user_data WHERE key = ANY($1::text[]) AND user_id = ANY($2::bigint[])`,
      [resettableUserDataKeys, userIds],
    );
    for (const userId of userIds) {
      const nextIdResult = await client.query('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM user_data');
      const nextId = Number(nextIdResult.rows[0]?.next_id || 1);
      await client.query(
        `INSERT INTO user_data (id, user_id, key, value, updated_at)
         VALUES ($1, $2, 'is_data_reset_version', $3, CURRENT_TIMESTAMP)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
        [nextId, userId, resetVersion],
      );
    }
  }

  await client.query('COMMIT');
  console.log(JSON.stringify({
    resetVersion,
    purgedTables: purgeTables.length,
    userCount: userIds.length,
  }, null, 2));
}

main().catch(async (error) => {
  try { await client.query('ROLLBACK'); } catch {}
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  try { await client.end(); } catch {}
});
