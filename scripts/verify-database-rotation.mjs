import 'dotenv/config';
import pg from 'pg';

const { Client } = pg;
const connectionString = String(process.env.DATABASE_URL || '').trim();

function failureCategory(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  if (!connectionString) return 'variable_non_chargee';
  if (code === '28P01' || code === '28000') return 'identifiants_refuses';
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(code)) {
    return 'hote_inaccessible';
  }
  if (message.includes('ssl') || message.includes('certificate') || code.startsWith('ERR_TLS')) {
    return 'erreur_ssl';
  }
  if (code === 'ERR_INVALID_URL' || message.includes('invalid url') || message.includes('invalid connection')) {
    return 'url_mal_formee';
  }
  return 'erreur_postgresql';
}

if (!connectionString) {
  console.log(JSON.stringify({ ok: false, error: 'variable_non_chargee' }));
  process.exit(1);
}

try {
  const parsed = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('invalid url');
} catch {
  console.log(JSON.stringify({ ok: false, error: 'url_mal_formee' }));
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  const selectResult = await client.query('SELECT 1 AS ok');
  const { rows: [existing] } = await client.query(`
    SELECT
      (SELECT count(*)::integer FROM public.users) AS users_count,
      (SELECT count(*)::integer FROM public.organizations) AS organizations_count
  `);

  console.log(JSON.stringify({
    ok: true,
    select_1: selectResult.rows?.[0]?.ok === 1,
    existing_data: Number(existing.users_count) > 0 && Number(existing.organizations_count) > 0,
  }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: failureCategory(error) }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
