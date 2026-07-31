import type { AuthUser } from './auth';
import { json, supabaseRest } from './http';

const PUBLIC_CONFIG_KEYS = new Set([
  'maintenance_mode',
  'system_announcement',
  'app_name',
  'support_email',
  'default_currency',
  'default_locale',
]);

export async function handlePublicSystemConfig(env: Env, _user: AuthUser | null, cors: HeadersInit): Promise<Response> {
  const result = await supabaseRest<Array<{ key: string; value_json: string }>>(
    env,
    'runtime_config?select=key,value_json',
  );
  const rows = result.ok && Array.isArray(result.data) ? result.data : [];
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    if (!PUBLIC_CONFIG_KEYS.has(row.key) && !String(row.key).startsWith('public_')) continue;
    try {
      out[row.key] = JSON.parse(row.value_json);
    } catch {
      out[row.key] = row.value_json;
    }
  }
  return json(out, 200, cors);
}
