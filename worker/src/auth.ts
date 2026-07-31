import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify, errors as JoseErrors } from 'jose';
import { json, supabaseRest } from './http';
import {
  getRolePermissions,
  hasPermission,
  hasRole,
  organizationDeniedResponse,
  permissionDeniedResponse,
  roleDeniedResponse,
  sameOrganization,
} from './permissions';

const JWT_ISSUER = 'intelsheets';
const JWT_AUDIENCE = 'intelsheets-web';
const TOKEN_EXPIRY = '12h';
const MAX_LOGIN_ATTEMPTS = 10;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000;

export type AuthUser = {
  id: string;
  username: string;
  role: string;
  department: string | null;
  organization_id: string;
  full_name: string | null;
  email: string | null;
  active: number;
  token_version: number;
  permissions: string[];
  jti?: string;
  exp?: number;
  password?: string;
  login_attempts?: number;
  locked_until?: string | null;
};

function jwtSecretKey(env: Env): Uint8Array {
  const secret = String(env.JWT_SECRET || '').trim();
  if (!secret || secret.includes('a_remplacer')) {
    throw new Error('JWT_SECRET manquant');
  }
  return new TextEncoder().encode(secret);
}

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    department: user.department,
    organization_id: user.organization_id || 'org_default',
    full_name: user.full_name,
    email: user.email,
  };
}

async function findUserByUsername(env: Env, username: string): Promise<AuthUser | null> {
  const encoded = encodeURIComponent(username);
  const result = await supabaseRest<Array<AuthUser & { password?: string }>>(
    env,
    `users?username=eq.${encoded}&select=id,username,password,role,department,organization_id,full_name,email,active,token_version,login_attempts,locked_until&limit=1`,
  );
  if (!result.ok || !Array.isArray(result.data) || !result.data[0]) return null;
  const row = result.data[0];
  return {
    ...row,
    organization_id: row.organization_id || 'org_default',
    permissions: getRolePermissions(row.role),
  };
}

async function findUserById(env: Env, id: string): Promise<AuthUser | null> {
  const encoded = encodeURIComponent(id);
  const result = await supabaseRest<AuthUser[]>(
    env,
    `users?id=eq.${encoded}&select=id,username,role,department,organization_id,full_name,email,active,token_version&limit=1`,
  );
  if (!result.ok || !Array.isArray(result.data) || !result.data[0]) return null;
  const row = result.data[0];
  return {
    ...row,
    organization_id: row.organization_id || 'org_default',
    permissions: getRolePermissions(row.role),
  };
}

async function patchUser(env: Env, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const result = await supabaseRest(env, `users?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(patch),
  });
  return result.ok;
}

async function isBlacklisted(env: Env, jti: string): Promise<boolean> {
  const result = await supabaseRest<Array<{ jti: string }>>(
    env,
    `sessions_blacklist?jti=eq.${encodeURIComponent(jti)}&select=jti&limit=1`,
  );
  return Boolean(result.ok && Array.isArray(result.data) && result.data.length);
}

async function blacklistToken(env: Env, jti: string, expSeconds?: number): Promise<void> {
  const expiresAt = expSeconds
    ? new Date(expSeconds * 1000).toISOString()
    : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await supabaseRest(env, 'sessions_blacklist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify({ jti, expires_at: expiresAt }),
  });
}

async function isMaintenanceMode(env: Env): Promise<{ enabled: boolean; announcement: string }> {
  const result = await supabaseRest<Array<{ key: string; value_json: string }>>(
    env,
    'runtime_config?key=in.(maintenance_mode,system_announcement)&select=key,value_json',
  );
  if (!result.ok || !Array.isArray(result.data)) return { enabled: false, announcement: '' };
  const map = new Map(result.data.map((row) => [row.key, row.value_json]));
  let enabled = false;
  let announcement = '';
  try {
    enabled = JSON.parse(map.get('maintenance_mode') || 'false') === true;
  } catch {
    enabled = false;
  }
  try {
    announcement = String(JSON.parse(map.get('system_announcement') || '""') || '');
  } catch {
    announcement = '';
  }
  return { enabled, announcement };
}

export async function generateToken(env: Env, user: AuthUser): Promise<string> {
  const jti = crypto.randomUUID().replace(/-/g, '');
  return new SignJWT({
    jti,
    id: user.id,
    username: user.username,
    role: user.role,
    department: user.department,
    organization_id: user.organization_id || 'org_default',
    permissions: getRolePermissions(user.role),
    tokenVersion: Number(user.token_version || 0),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(jwtSecretKey(env));
}

export async function authenticateRequest(request: Request, env: Env): Promise<AuthUser | Response> {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return json({ error: 'Authentification requise' }, 401);

  try {
    const verified = await jwtVerify(token, jwtSecretKey(env), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
    const payload = verified.payload as Record<string, unknown>;
    const jti = String(payload.jti || '');
    if (jti && await isBlacklisted(env, jti)) {
      return json({ error: 'Session révoquée' }, 401);
    }
    const userId = String(payload.id || '');
    const user = await findUserById(env, userId);
    if (!user || !user.active) return json({ error: 'Compte indisponible' }, 401);
    if (Number(payload.tokenVersion || 0) !== Number(user.token_version || 0)) {
      return json({ error: 'Session révoquée' }, 401);
    }

    if (user.role !== 'admin') {
      const maintenance = await isMaintenanceMode(env);
      if (maintenance.enabled) {
        return json({
          error: 'Maintenance en cours',
          announcement: maintenance.announcement,
          code: 'MAINTENANCE_MODE',
        }, 503);
      }
    }

    return {
      ...user,
      jti,
      exp: Number(payload.exp || 0) || undefined,
      permissions: getRolePermissions(user.role),
    };
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      return json({ error: 'Session expirée', code: 'TOKEN_EXPIRED' }, 401);
    }
    return json({ error: 'Token invalide' }, 401);
  }
}

export function requireRole(user: AuthUser, ...roles: string[]): Response | null {
  if (!hasRole(user, ...roles)) return json(roleDeniedResponse(), 403);
  return null;
}

export function requirePermission(user: AuthUser, ...permissions: string[]): Response | null {
  const allowed = permissions.some((permission) => hasPermission(user, permission));
  if (!allowed) return json(permissionDeniedResponse(), 403);
  return null;
}

export function requireOrganization(user: AuthUser, organizationId: string): Response | null {
  if (!sameOrganization(user, organizationId)) return json(organizationDeniedResponse(), 403);
  return null;
}

function isLocked(user: AuthUser): boolean {
  if (!user.locked_until) return false;
  return new Date(user.locked_until).getTime() > Date.now();
}

export async function handleLogin(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json() as { username?: unknown; password?: unknown };
  } catch {
    return json({ error: 'Identifiants requis' }, 400, cors);
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password || password.length > 128) {
    return json({ error: 'Identifiants requis' }, 400, cors);
  }

  const user = await findUserByUsername(env, username);
  if (user && isLocked(user)) {
    return json({ error: 'Compte temporairement verrouillé. Réessayez dans 5 minutes.' }, 429, cors);
  }

  const passwordOk = user?.active === 1 && user.password
    ? await bcrypt.compare(password, user.password)
    : false;

  if (!user || !passwordOk) {
    if (user) {
      const attempts = Number(user.login_attempts || 0) + 1;
      const patch: Record<string, unknown> = { login_attempts: attempts };
      if (attempts >= MAX_LOGIN_ATTEMPTS) {
        patch.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
      }
      await patchUser(env, user.id, patch);
    }
    return json({ error: 'Identifiants incorrects' }, 401, cors);
  }

  await patchUser(env, user.id, {
    login_attempts: 0,
    locked_until: null,
    last_login: new Date().toISOString().replace('T', ' ').slice(0, 19),
  });

  const token = await generateToken(env, user);
  const headers = new Headers(cors);
  headers.append('Set-Cookie', 'token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None');
  return json({ token, user: publicUser(user) }, 200, headers);
}

export async function handleMe(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (auth instanceof Response) {
    const headers = new Headers(auth.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, String(value));
    return new Response(auth.body, { status: auth.status, headers });
  }
  return json(publicUser(auth), 200, cors);
}

export async function handleLogout(request: Request, env: Env, cors: HeadersInit): Promise<Response> {
  const auth = await authenticateRequest(request, env);
  if (auth instanceof Response) {
    const headers = new Headers(auth.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, String(value));
    return new Response(auth.body, { status: auth.status, headers });
  }
  if (auth.jti) await blacklistToken(env, auth.jti, auth.exp);
  return json({ success: true }, 200, cors);
}
