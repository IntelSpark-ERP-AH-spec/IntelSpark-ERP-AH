import bcrypt from 'bcryptjs';
import { type AuthUser, patchUser } from './auth';
import { json, supabaseRest } from './http';
import { auditAction, sanitizeUserRecord } from './middleware';
import { VALID_ROLES } from './permissions';
import { validatePassword } from './validation';

type UserRow = {
  id: string;
  username: string;
  role: string;
  department: string | null;
  full_name: string | null;
  email: string | null;
  active: number;
  created_at?: string | null;
  last_login?: string | null;
  organization_id: string;
  token_version?: number;
};

function randomTempPassword(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

async function listOrgUsers(env: Env, organizationId: string): Promise<UserRow[]> {
  const org = encodeURIComponent(organizationId);
  const result = await supabaseRest<UserRow[]>(
    env,
    `users?organization_id=eq.${org}&select=id,username,role,department,full_name,email,active,created_at,last_login,organization_id&order=created_at.asc`,
  );
  if (!result.ok || !Array.isArray(result.data)) return [];
  return result.data.map((row) => ({
    ...row,
    organization_id: row.organization_id || 'org_default',
  }));
}

async function findOrgUser(env: Env, id: string, organizationId: string): Promise<UserRow | null> {
  const result = await supabaseRest<UserRow[]>(
    env,
    `users?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=id,username,role,department,full_name,email,active,created_at,last_login,organization_id,token_version&limit=1`,
  );
  if (!result.ok || !Array.isArray(result.data) || !result.data[0]) return null;
  const row = result.data[0];
  return { ...row, organization_id: row.organization_id || 'org_default' };
}

async function countActiveAdmins(env: Env, organizationId: string): Promise<number> {
  const result = await supabaseRest<Array<{ id: string }>>(
    env,
    `users?role=eq.admin&active=eq.1&organization_id=eq.${encodeURIComponent(organizationId)}&select=id`,
  );
  if (!result.ok || !Array.isArray(result.data)) return 0;
  return result.data.length;
}

async function usernameTaken(env: Env, username: string): Promise<boolean> {
  const result = await supabaseRest<Array<{ id: string }>>(
    env,
    `users?username=ilike.${encodeURIComponent(username)}&select=id&limit=1`,
  );
  return Boolean(result.ok && Array.isArray(result.data) && result.data.length);
}

export async function handleListUsers(env: Env, actor: AuthUser, cors: HeadersInit): Promise<Response> {
  const users = await listOrgUsers(env, actor.organization_id);
  return json(users.map((u) => sanitizeUserRecord(u as unknown as Record<string, unknown>)), 200, cors);
}

export async function handleCreateUser(
  request: Request,
  env: Env,
  actor: AuthUser,
  cors: HeadersInit,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Données invalides' }, 400, cors);
  }

  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) return json({ error: 'username et password requis' }, 400, cors);
  if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
    return json({ error: 'Nom d’utilisateur invalide' }, 400, cors);
  }
  const passwordError = validatePassword(password);
  if (passwordError) return json({ error: passwordError }, 400, cors);

  const role = typeof body.role === 'string' && body.role ? body.role : 'employe';
  if (!(VALID_ROLES as readonly string[]).includes(role)) {
    return json({ error: 'Rôle invalide' }, 400, cors);
  }
  if (await usernameTaken(env, username)) {
    return json({ error: "Nom d'utilisateur déjà pris" }, 400, cors);
  }

  const hash = await bcrypt.hash(password, 12);
  const id = crypto.randomUUID();
  const department = body.department == null ? null : String(body.department);
  const fullName = body.full_name == null ? null : String(body.full_name);
  const email = body.email == null ? null : String(body.email);
  const organizationId = actor.organization_id;

  const insert = await supabaseRest(env, 'users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      id,
      username,
      password: hash,
      role,
      department,
      full_name: fullName,
      email,
      organization_id: organizationId,
      active: 1,
      token_version: 0,
    }),
  });

  if (!insert.ok) {
    console.warn(JSON.stringify({ event: 'user_create_failed', status: insert.status }));
    return json({ error: 'Erreur interne' }, 500, cors);
  }

  auditAction('users.create', actor, { target_username: username, role });
  return json({
    id,
    username,
    role,
    department,
    full_name: fullName,
    email,
    organization_id: organizationId,
  }, 201, cors);
}

export async function handleUpdateUser(
  request: Request,
  env: Env,
  actor: AuthUser,
  userId: string,
  cors: HeadersInit,
): Promise<Response> {
  const existing = await findOrgUser(env, userId, actor.organization_id);
  if (!existing) return json({ error: 'Utilisateur introuvable' }, 404, cors);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: 'Données invalides' }, 400, cors);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'organization_id')
    || Object.prototype.hasOwnProperty.call(body, 'password')
    || Object.prototype.hasOwnProperty.call(body, 'permissions')
    || Object.prototype.hasOwnProperty.call(body, 'username')) {
    return json({ error: 'Champ interdit' }, 403, cors);
  }

  const nextRole = body.role === undefined ? existing.role : String(body.role);
  if (!(VALID_ROLES as readonly string[]).includes(nextRole)) {
    return json({ error: 'Rôle invalide' }, 400, cors);
  }

  const nextActive = body.active === undefined ? existing.active : (body.active ? 1 : 0);
  if (String(existing.id) === String(actor.id) && !nextActive) {
    return json({ error: 'Vous ne pouvez pas désactiver votre propre compte' }, 400, cors);
  }

  if (existing.role === 'admin' && (nextRole !== 'admin' || !nextActive)) {
    const adminCount = await countActiveAdmins(env, actor.organization_id);
    if (adminCount <= 1) {
      return json({ error: 'Impossible de supprimer le dernier administrateur actif' }, 400, cors);
    }
  }

  const revokeSessions = nextRole !== existing.role || nextActive !== existing.active;
  const patch: Record<string, unknown> = {
    role: nextRole,
    department: body.department === undefined ? existing.department : (body.department == null ? null : String(body.department)),
    full_name: body.full_name === undefined ? existing.full_name : (body.full_name == null ? null : String(body.full_name)),
    email: body.email === undefined ? existing.email : (body.email == null ? null : String(body.email)),
    active: nextActive,
  };
  if (revokeSessions) {
    patch.token_version = Number(existing.token_version || 0) + 1;
  }

  const ok = await patchUser(env, existing.id, patch);
  if (!ok) return json({ error: 'Erreur interne' }, 500, cors);
  auditAction('users.update', actor, {
    target_id: existing.id,
    role: nextRole,
    active: nextActive,
  });
  return json({ success: true }, 200, cors);
}

export async function handleDeleteUser(
  env: Env,
  actor: AuthUser,
  userId: string,
  cors: HeadersInit,
): Promise<Response> {
  const target = await findOrgUser(env, userId, actor.organization_id);
  if (!target) return json({ error: 'Utilisateur introuvable' }, 404, cors);
  if (String(target.id) === String(actor.id)) {
    return json({ error: 'Vous ne pouvez pas supprimer votre propre compte' }, 400, cors);
  }
  if (target.role === 'admin') {
    const adminCount = await countActiveAdmins(env, actor.organization_id);
    if (adminCount <= 1) {
      return json({ error: 'Impossible de supprimer le dernier administrateur actif' }, 400, cors);
    }
  }

  const uid = encodeURIComponent(target.id);
  const org = encodeURIComponent(actor.organization_id);
  try {
    await supabaseRest(env, `notifications?user_id=eq.${uid}`, { method: 'DELETE' });
    await supabaseRest(env, `messages?or=(sender_id.eq.${uid},recipient_id.eq.${uid})`, { method: 'DELETE' });
    await supabaseRest(env, `user_data?user_id=eq.${uid}`, { method: 'DELETE' });
    const deleted = await supabaseRest(env, `users?id=eq.${uid}&organization_id=eq.${org}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    });
    if (!deleted.ok || (Array.isArray(deleted.data) && deleted.data.length === 0)) {
      return json({ error: 'Utilisateur introuvable' }, 404, cors);
    }
  } catch {
    return json({ error: 'Suppression impossible: des données liées doivent être vérifiées' }, 409, cors);
  }
  auditAction('users.delete', actor, { target_id: target.id, username: target.username });
  return json({ success: true, deleted: { id: target.id, username: target.username } }, 200, cors);
}

export async function handleResetPassword(
  env: Env,
  actor: AuthUser,
  userId: string,
  cors: HeadersInit,
): Promise<Response> {
  const target = await findOrgUser(env, userId, actor.organization_id);
  if (!target) return json({ error: 'Utilisateur introuvable' }, 404, cors);

  const temporaryPassword = randomTempPassword();
  const hash = await bcrypt.hash(temporaryPassword, 12);
  const ok = await patchUser(env, target.id, {
    password: hash,
    token_version: Number(target.token_version || 0) + 1,
  });
  if (!ok) return json({ error: 'Erreur interne' }, 500, cors);
  auditAction('users.reset_password', actor, { target_id: target.id });
  return json({ success: true, temporary_password: temporaryPassword }, 200, cors);
}
