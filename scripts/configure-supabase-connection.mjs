import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function configureSupabaseConnection(connectionString, workspacePath) {
  const value = String(connectionString || '').trim();
  if (!value.startsWith('postgresql://')) throw new Error('Connexion PostgreSQL absente');
  if (value.includes('[YOUR-PASSWORD]')) throw new Error('Mot de passe Supabase absent');

  const connectionUrl = new URL(value);
  const isDirectHost = /(^|\.)supabase\.co$/i.test(connectionUrl.hostname);
  const isPoolerHost = /(^|\.)pooler\.supabase\.com$/i.test(connectionUrl.hostname);
  if (!isDirectHost && !isPoolerHost) throw new Error('Hote Supabase invalide');
  if (!value.includes('hozhnlzgbccrkdluqjcg')) throw new Error('Projet Supabase incorrect');

  const envPath = path.resolve(workspacePath, '.env');
  let source = '';
  try { source = await readFile(envPath, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const line = `DATABASE_URL=${value}`;
  const lines = source.replace(/\r\n/g, '\n').split('\n').filter((item, index, all) => item || index < all.length - 1);
  const existingIndex = lines.findIndex((item) => item.startsWith('DATABASE_URL='));
  if (existingIndex >= 0) lines[existingIndex] = line;
  else lines.push(line);
  await writeFile(envPath, `${lines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });

  return { configured: true, host: connectionUrl.hostname, environmentFile: '.env' };
}
