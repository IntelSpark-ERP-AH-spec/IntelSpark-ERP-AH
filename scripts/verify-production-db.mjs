import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const connectionString = String(process.env.DATABASE_URL || '').trim();
if (!connectionString) throw new Error('DATABASE_URL manquante');

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  const { rows: [result] } = await client.query(`
    select
      exists(
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'messages'
          and column_name = 'organization_id'
      ) as message_organization_column,
      exists(
        select 1
        from schema_migrations
        where version = '20260729_015_message_organization_scope'
      ) as migration_recorded,
      (
        select count(*)::integer
        from messages
        where organization_id is null or organization_id = ''
      ) as unscoped_messages
  `);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ code: String(error?.code || 'POSTGRES_ERROR') }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
