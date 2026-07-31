import type { AuthUser } from './auth';
import { json, normalizedSupabaseUrl, supabaseRest, type JsonValue } from './http';
import { hasRole } from './permissions';

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
  const remoteLogoUploadEnabled = String(env.SUPABASE_LOGO_UPLOAD_ENABLED || '').toLowerCase() === 'true';
  const supabaseUrl = normalizedSupabaseUrl(env.SUPABASE_URL || '');
  return json({
    id: organization.id,
    name: organization.name,
    realtime_topic: organization.realtime_topic,
    logo_upload_url: remoteLogoUploadEnabled && supabaseUrl
      ? `${supabaseUrl}/functions/v1/company-logo-upload`
      : null,
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
  if (!hasRole(user, 'admin') && keys.some((key) => COMPANY_KEY_TO_COLUMN[key])) {
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
  if (COMPANY_KEY_TO_COLUMN[key] && !hasRole(user, 'admin')) {
    return json({ error: 'Paramètres entreprise réservés à l’administrateur' }, 403, cors);
  }
  const organization = await getOrganization(env, user);
  if (isUserPrivateDataKey(key)) await setUserDocument(env, user.id, key, value);
  else if (!(await setCompanySetting(env, organization.id, key, value, user.id))) {
    await setOrganizationDocument(env, organization.id, user.id, key, value);
  }
  return json({ success: true, scope: isUserPrivateDataKey(key) ? 'user' : 'organization' }, 200, cors);
}

export async function handleDocDelete(
  env: Env,
  user: AuthUser,
  key: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!KEY_RE.test(key)) return json({ error: 'Clé invalide' }, 400, cors);
  if (COMPANY_KEY_TO_COLUMN[key] && !hasRole(user, 'admin')) {
    return json({ error: 'Paramètres entreprise réservés à l’administrateur' }, 403, cors);
  }
  const organization = await getOrganization(env, user);
  if (isUserPrivateDataKey(key)) {
    await supabaseRest(
      env,
      `user_documents?user_id=eq.${encodeURIComponent(user.id)}&key=eq.${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
  } else if (COMPANY_KEY_TO_COLUMN[key]) {
    await setCompanySetting(env, organization.id, key, key === 'is_brands' ? [] : null, user.id);
  } else {
    await supabaseRest(
      env,
      `organization_documents?organization_id=eq.${encodeURIComponent(organization.id)}&key=eq.${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
  }
  return json({ success: true }, 200, cors);
}

const COMPANY_SCOPE_KEYS: Record<string, string[]> = {
  identity: [
    'is_company_name', 'is_company_address', 'is_company_phone',
    'is_company_email', 'is_company_activity', 'is_logo',
  ],
  branding: ['is_footer', 'is_brands'],
  all: Object.keys(COMPANY_KEY_TO_COLUMN),
};

const COMPANY_TEXT_LIMITS: Record<string, number> = {
  is_company_name: 200,
  is_company_address: 500,
  is_company_phone: 100,
  is_company_email: 254,
  is_company_activity: 500,
  is_footer: 5000,
};

function companyAssetBaseUrl(env: Env): string {
  const supabaseUrl = normalizedSupabaseUrl(env.SUPABASE_URL || '');
  return supabaseUrl ? `${supabaseUrl}/storage/v1/object/public/company-assets/` : '';
}

function normalizeCompanyAssetUrl(env: Env, value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const candidate = String(value).trim();
  if (!candidate) throw new Error('URL image invalide');
  if (candidate.startsWith('data:')) {
    if (candidate.length > 1024 * 1024) throw new Error('Image trop volumineuse');
    const match = candidate.match(/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/]+={0,2})$/);
    if (!match || match[2].length % 4 !== 0) throw new Error('Image locale invalide');
    return candidate;
  }
  if (candidate.length > 2048) throw new Error('URL image invalide');
  const base = companyAssetBaseUrl(env);
  if (!base) throw new Error('SUPABASE_URL manquant');
  if (!candidate.startsWith(base) && !candidate.startsWith('https://')) {
    throw new Error('URL image hors stockage');
  }
  return candidate;
}

function normalizeCompanySettings(env: Env, scope: string, body: Record<string, unknown>) {
  const keys = COMPANY_SCOPE_KEYS[scope];
  if (!keys || !body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Paramètres entreprise invalides');
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    if (COMPANY_TEXT_LIMITS[key]) {
      const text = String(body[key] ?? '').trim();
      if (text.length > COMPANY_TEXT_LIMITS[key]) throw new Error(`Valeur trop longue: ${key}`);
      result[key] = text;
      continue;
    }
    if (key === 'is_logo') {
      result[key] = normalizeCompanyAssetUrl(env, body[key]);
      continue;
    }
    if (key === 'is_brands') {
      if (!Array.isArray(body[key]) || body[key].length > 64) throw new Error('Liste des marques invalide');
      result[key] = (body[key] as unknown[]).map((brand, index) => {
        if (!brand || typeof brand !== 'object' || Array.isArray(brand)) throw new Error('Marque invalide');
        const entry = brand as Record<string, unknown>;
        const name = String(entry.name || '').trim().slice(0, 100);
        return {
          id: String(entry.id || `brand-${index + 1}`).slice(0, 100),
          ...(name ? { name } : {}),
          logo: normalizeCompanyAssetUrl(env, entry.logo),
        };
      });
    }
  }
  if (!Object.keys(result).length) throw new Error('Aucune donnée entreprise reçue');
  return result;
}

export async function handleCompanySettings(
  request: Request,
  env: Env,
  user: AuthUser,
  scopeParam: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'Paramètres entreprise invalides' }, 400, cors); }

  try {
    const scope = String(scopeParam || '').toLowerCase();
    const values = normalizeCompanySettings(env, scope, body);
    const organization = await getOrganization(env, user);
    for (const [key, value] of Object.entries(values)) {
      await setCompanySetting(env, organization.id, key, value, user.id);
    }
    return json({
      success: true,
      scope,
      organization_id: organization.id,
      settings: await readCompanySettings(env, organization.id),
    }, 200, cors);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sauvegarde entreprise impossible';
    const status = /invalide|trop longue|hors stockage|Aucune donnée|manquant/i.test(message) ? 400 : 500;
    return json({ error: message }, status, cors);
  }
}
