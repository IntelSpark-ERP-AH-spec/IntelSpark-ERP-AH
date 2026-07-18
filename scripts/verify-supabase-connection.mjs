import 'dotenv/config';
import { createPostgresAdapter } from '../backend/postgres-compat.js';

let database;

try {
  database = createPostgresAdapter(process.env.DATABASE_URL);
  const result = database.prepare(
    'select current_database() as database, count(*)::int as users from public.users',
  ).get();
  console.log(JSON.stringify({
    connected: true,
    database: result.database,
    users: result.users,
  }));
} catch (error) {
  console.error(JSON.stringify({
    connected: false,
    code: error.code || 'ERROR',
    message: String(error.message || 'Connexion impossible').replace(/postgresql:\/\/\S+/gi, '[redacted]'),
  }));
  process.exitCode = 1;
} finally {
  database?.close();
}
