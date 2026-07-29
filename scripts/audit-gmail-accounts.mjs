import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  const { rows: [tables] } = await client.query(`
    select
      to_regclass('public.email_accounts') is not null as accounts_table,
      to_regclass('public.email_account_permissions') is not null as permissions_table,
      to_regclass('public.email_account_preferences') is not null as preferences_table
  `);
  const { rows: [legacy] } = await client.query(`
    select
      count(*) filter (
        where coalesce(smtp_user, '') <> '' and coalesce(smtp_pass, '') <> ''
      )::integer as legacy_configured_users,
      count(*) filter (
        where coalesce(smtp_pass, '') <> '' and smtp_pass not like 'enc:v1:%'
      )::integer as legacy_plaintext_passwords
    from public.users
  `);
  const { rows: [history] } = await client.query(`
    select count(*)::integer as email_history_rows
    from public.email_history
  `);
  let accountCounts = { total_accounts: 0, personal_accounts: 0, shared_accounts: 0 };
  let security = {
    app_migration_applied: false,
    rls_enabled_tables: 0,
    exposed_table_grants: 0,
  };
  if (tables.accounts_table) {
    const { rows: [counts] } = await client.query(`
      select
        count(*)::integer as total_accounts,
        count(*) filter (where account_type = 'personal')::integer as personal_accounts,
        count(*) filter (where account_type in ('organization', 'shared'))::integer as shared_accounts
      from public.email_accounts
    `);
    accountCounts = counts;
    const { rows: [securityRows] } = await client.query(`
      select
        exists (
          select 1 from public.schema_migrations
          where version = '20260729_016_gmail_multi_accounts'
        ) as app_migration_applied,
        (
          select count(*)::integer
          from pg_class
          where oid in (
            'public.email_accounts'::regclass,
            'public.email_account_permissions'::regclass,
            'public.email_account_preferences'::regclass
          )
          and relrowsecurity
        ) as rls_enabled_tables,
        (
          select count(*)::integer
          from information_schema.table_privileges
          where table_schema = 'public'
            and table_name in (
              'email_accounts',
              'email_account_permissions',
              'email_account_preferences'
            )
            and grantee in ('anon', 'authenticated')
        ) as exposed_table_grants
    `);
    security = securityRows;
  }
  console.log(JSON.stringify({ ...tables, ...legacy, ...history, ...accountCounts, ...security }));
} catch (error) {
  console.error(JSON.stringify({ code: String(error?.code || 'GMAIL_AUDIT_ERROR') }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
