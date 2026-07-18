import { dbGet, dbRun } from './db.js';

export const DEFAULT_ORGANIZATION_ID = 'org_default';

export const USER_PRIVATE_DATA_KEYS = new Set([
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

export function isUserPrivateDataKey(key) {
  return USER_PRIVATE_DATA_KEYS.has(String(key || ''));
}

export function ensureOrganizationForUser(userId) {
  let organization = dbGet(`SELECT o.id, o.name, o.realtime_topic
    FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
    WHERE u.id = ?`, [userId]);
  if (organization?.id) return organization;

  const fallback = dbGet('SELECT id, name, realtime_topic FROM organizations WHERE id = ?', [DEFAULT_ORGANIZATION_ID]);
  if (!fallback) throw new Error('Organisation principale indisponible');
  dbRun('UPDATE users SET organization_id = ? WHERE id = ?', [fallback.id, userId]);
  organization = fallback;
  return organization;
}

export function organizationIdForUser(user) {
  if (user?.organization_id) return String(user.organization_id);
  return ensureOrganizationForUser(user?.id).id;
}

export function organizationContextForUser(user) {
  const organization = ensureOrganizationForUser(user?.id);
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://hozhnlzgbccrkdluqjcg.supabase.co').replace(/\/$/, '');
  return {
    id: organization.id,
    name: organization.name,
    realtime_topic: organization.realtime_topic,
    logo_upload_url: supabaseUrl ? `${supabaseUrl}/functions/v1/company-logo-upload` : null,
  };
}
