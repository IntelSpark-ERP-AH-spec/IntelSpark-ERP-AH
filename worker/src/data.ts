import type { AuthUser } from './auth';
import { json, supabaseRest, type JsonValue } from './http';

const DEFAULT_ORGANIZATION_ID = 'org_default';
const KEY_RE = /^[a-zA-Z0-9_]{1,50}$/;
const MAX_VALUE_BYTES = 5 * 1024 * 1024;

const USER_PRIVATE_DATA_KEYS = new Set([
  'ui_session_state',
  'user_preferences',
  'is_theme',
  'is_lang',
  'is_currency',
  'is_font_size',
  'is_font_family',
  'is_font_color',
  'is_active_page',
]);

const COMPANY_KEY_TO_COLUMN: Record<string, string> = {
  is_company_name: 'company_name',
  is_company_address: 'company_address',
  is_company_phone: 'company_phone',
  is_company_email: 'company_email',
  is_company_activity: 'company_activity',
  is_footer: 'legal_mentions',
  is_logo: 'logo_url',
  is_brands: 'brands_json',
};

function isUserPrivateDataKey(key: string): boolean {
  return USER_PRIVATE_DATA_KEYS.has(key);
}

function parseStoredJson(value: unknown, fallback: JsonValue = null): JsonValue {
  if (value !== null && typeof value === 'object') return value as JsonValue;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return fallback;
  }
}

type Organization = { id: string; name: string; realtime_topic: string };

async function getOrganization(env: Env, user: AuthUser): Promise<Organization> {
  const orgId = user.organization_id || DEFAULT_ORGANIZATION_ID;
  const result = await supabaseRest<Organization[]>(
    env,
    `organizations?id=eq.${encodeURIComponent(orgId)}&select=id,name,realtime_topic&limit=1`,
  );
  if (result.ok && Array.isArray(result.data) && result.data[0]) return result.data[0];

  const fallback = await supabaseRest<Organization[]>(
    env,
    `organizations?id=eq.${encodeURIComponent(DEFAULT_ORGANIZATION_ID)}&select=id,name,realtime_topic&limit=1`,
  );
  if (!fallback.ok || !Array.isArray(fallback.data) || !fallback.data[0]) {
    throw new Error('Organisation principale indisponible');
  }
  return fallback.data[0];
}

async function readCompanySettings(env: Env, organizationId: string): Promise<Record<string, JsonValue>> {
  const result = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    `company_settings?organization_id=eq.${encodeURIComponent(organizationId)}&select=*&limit=1`,
  );
  const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return {};
  const text = (value: unknown) => (
    value === null || value === undefined || String(value).trim().toLowerCase() === 'null'
      ? ''
      : String(value)
  );
  return {
    is_company_name: text(row.company_name),
    is_company_address: text(row.company_address),
    is_company_phone: text(row.company_phone),
    is_company_email: text(row.company_email),
    is_company_activity: text(row.company_activity),
    is_footer: text(row.legal_mentions),
    is_logo: text(row.logo_url),
    is_brands: parseStoredJson(row.brands_json, []),
  };
}

async function setOrganizationDocument(
  env: Env,
  organizationId: string,
  userId: string,
  key: string,
  value: unknown,
): Promise<void> {
  const result = await supabaseRest(env, 'organization_documents?on_conflict=organization_id,key', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      organization_id: organizationId,
      key,
      value_json: JSON.stringify(value),
      updated_by: userId,
      version: 1,
      updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    }),
  });
  if (!result.ok) throw new Error(result.text || 'Écriture document organisation impossible');
}

async function setUserDocument(env: Env, userId: string, key: string, value: unknown): Promise<void> {
  const result = await supabaseRest(env, 'user_documents?on_conflict=user_id,key', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      user_id: userId,
      key,
      value_json: JSON.stringify(value),
      updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    }),
  });
  if (!result.ok) throw new Error(result.text || 'Écriture document utilisateur impossible');
}

async function setCompanySetting(
  env: Env,
  organizationId: string,
  key: string,
  value: unknown,
  updatedBy: string,
): Promise<boolean> {
  const column = COMPANY_KEY_TO_COLUMN[key];
  if (!column) return false;
  const stored = key === 'is_brands'
    ? JSON.stringify(value ?? [])
    : (value === null || value === undefined || String(value).trim().toLowerCase() === 'null' ? null : value);

  await supabaseRest(env, 'company_settings?on_conflict=organization_id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({
      organization_id: organizationId,
      [column]: stored,
      updated_by: updatedBy,
      updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    }),
  });

  if (stored === null) {
    await supabaseRest(
      env,
      `organization_documents?organization_id=eq.${encodeURIComponent(organizationId)}&key=eq.${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
  } else {
    await setOrganizationDocument(env, organizationId, updatedBy, key, key === 'is_brands' ? (value ?? []) : stored);
  }
  return true;
}

export async function handleDataContext(env: Env, user: AuthUser, cors: HeadersInit): Promise<Response> {
  const organization = await getOrganization(env, user);
  return json({
    id: organization.id,
    name: organization.name,
    realtime_topic: organization.realtime_topic,
    logo_upload_url: null,
  }, 200, cors);
}

export async function handleDataLoad(env: Env, user: AuthUser, cors: HeadersInit): Promise<Response> {
  const organization = await getOrganization(env, user);
  const map: Record<string, JsonValue> = {};

  const userDocs = await supabaseRest<Array<{ key: string; value_json: string }>>(
    env,
    `user_documents?user_id=eq.${encodeURIComponent(user.id)}&select=key,value_json`,
  );
  if (userDocs.ok && Array.isArray(userDocs.data)) {
    for (const row of userDocs.data) {
      if (String(row.key).startsWith('is_brands_chunk_')) continue;
      if (isUserPrivateDataKey(row.key)) map[row.key] = parseStoredJson(row.value_json);
    }
  }

  const orgDocs = await supabaseRest<Array<{ key: string; value_json: string }>>(
    env,
    `organization_documents?organization_id=eq.${encodeURIComponent(organization.id)}&select=key,value_json`,
  );
  if (orgDocs.ok && Array.isArray(orgDocs.data)) {
    for (const row of orgDocs.data) {
      map[row.key] = parseStoredJson(row.value_json);
    }
  }

  Object.assign(map, await readCompanySettings(env, organization.id));
  return json({
    ...map,
    _sync: { organization_id: organization.id, realtime_topic: organization.realtime_topic },
  }, 200, cors);
}

export async function handleDataSave(
  request: Request,
  env: Env,
  user: AuthUser,
  cors: HeadersInit,
): Promise<Response> {
  let data: Record<string, unknown>;
  try {
    data = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Données invalides' }, 400, cors);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return json({ error: 'Données invalides' }, 400, cors);
  }
  const keys = Object.keys(data);
  if (keys.length > 100) return json({ error: 'Trop de clés (max 100)' }, 400, cors);
  if (user.role !== 'admin' && keys.some((key) => COMPANY_KEY_TO_COLUMN[key])) {
    return json({ error: 'Paramètres entreprise réservés à l’administrateur' }, 403, cors);
  }
  for (const [key, value] of Object.entries(data)) {
    if (!KEY_RE.test(key)) return json({ error: `Nom de clé invalide: ${key}` }, 400, cors);
    if (JSON.stringify(value).length > MAX_VALUE_BYTES) {
      return json({ error: `Valeur trop grande pour: ${key}` }, 400, cors);
    }
  }

  const organization = await getOrganization(env, user);
  for (const [key, value] of Object.entries(data)) {
    if (isUserPrivateDataKey(key)) await setUserDocument(env, user.id, key, value);
    else if (!(await setCompanySetting(env, organization.id, key, value, user.id))) {
      await setOrganizationDocument(env, organization.id, user.id, key, value);
    }
  }
  return json({ success: true, scope: 'organization', organization_id: organization.id, saved_keys: keys }, 200, cors);
}

export async function handleDocGet(
  env: Env,
  user: AuthUser,
  key: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!KEY_RE.test(key)) return json({ error: 'Clé invalide' }, 400, cors);
  const organization = await getOrganization(env, user);
  if (COMPANY_KEY_TO_COLUMN[key]) {
    const settings = await readCompanySettings(env, organization.id);
    return json(settings[key] ?? null, 200, cors);
  }

  if (isUserPrivateDataKey(key)) {
    const result = await supabaseRest<Array<{ value_json: string }>>(
      env,
      `user_documents?user_id=eq.${encodeURIComponent(user.id)}&key=eq.${encodeURIComponent(key)}&select=value_json&limit=1`,
    );
    if (result.ok && Array.isArray(result.data) && result.data[0]) {
      return json(parseStoredJson(result.data[0].value_json), 200, cors);
    }
    return json(null, 200, cors);
  }

  const result = await supabaseRest<Array<{ value_json: string }>>(
    env,
    `organization_documents?organization_id=eq.${encodeURIComponent(organization.id)}&key=eq.${encodeURIComponent(key)}&select=value_json&limit=1`,
  );
  if (result.ok && Array.isArray(result.data) && result.data[0]) {
    return json(parseStoredJson(result.data[0].value_json), 200, cors);
  }
  return json(null, 200, cors);
}

export async function handleDocPut(
  request: Request,
  env: Env,
  user: AuthUser,
  key: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!KEY_RE.test(key)) return json({ error: 'Clé invalide' }, 400, cors);
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return json({ error: 'Données invalides' }, 400, cors);
  }
  if (JSON.stringify(value).length > MAX_VALUE_BYTES) {
    return json({ error: 'Valeur trop grande' }, 400, cors);
  }
  if (COMPANY_KEY_TO_COLUMN[key] && user.role !== 'admin') {
    return json({ error: 'Paramètres entreprise réservés à l’administrateur' }, 403, cors);
  }
  const organization = await getOrganization(env, user);
  if (isUserPrivateDataKey(key)) await setUserDocument(env, user.id, key, value);
  else if (!(await setCompanySetting(env, organization.id, key, value, user.id))) {
    await setOrganizationDocument(env, organization.id, user.id, key, value);
  }
  return json({ success: true, scope: isUserPrivateDataKey(key) ? 'user' : 'organization' }, 200, cors);
}
