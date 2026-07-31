import { json } from './http';
import type { AuthUser } from './auth';
import { authenticateRequest, requireRole } from './auth';

export function withCors(response: Response, cors: HeadersInit): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, String(value));
  return new Response(response.body, { status: response.status, headers });
}

export async function requireAuth(
  request: Request,
  env: Env,
  cors: HeadersInit,
): Promise<AuthUser | Response> {
  const auth = await authenticateRequest(request, env);
  if (auth instanceof Response) return withCors(auth, cors);
  return auth;
}

export async function requireAdmin(
  request: Request,
  env: Env,
  cors: HeadersInit,
): Promise<AuthUser | Response> {
  const auth = await requireAuth(request, env, cors);
  if (auth instanceof Response) return auth;
  const denied = requireRole(auth, 'admin');
  if (denied) return withCors(denied, cors);
  return auth;
}

export async function requireActiveUser(
  request: Request,
  env: Env,
  cors: HeadersInit,
): Promise<AuthUser | Response> {
  const auth = await requireAuth(request, env, cors);
  if (auth instanceof Response) return auth;
  if (!auth.active) return withCors(json({ error: 'Compte indisponible' }, 401), cors);
  return auth;
}

export function requireOrganizationGuard(
  user: AuthUser,
  organizationId: string,
  cors: HeadersInit,
): Response | null {
  if (String(user.organization_id || 'org_default') !== String(organizationId)) {
    return withCors(json({ error: 'Organisation non autorisée' }, 403), cors);
  }
  return null;
}

export async function readJsonBody<T = Record<string, unknown>>(
  request: Request,
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  try {
    const body = await request.json() as T;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, response: json({ error: 'Données invalides' }, 400) };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, response: json({ error: 'Données invalides' }, 400) };
  }
}

export { validatePassword } from './validation';

export function auditAction(
  action: string,
  actor: AuthUser | null,
  detail: Record<string, unknown> = {},
): void {
  console.info(JSON.stringify({
    event: 'audit_action',
    action,
    actor_id: actor?.id || null,
    actor_role: actor?.role || null,
    organization_id: actor?.organization_id || null,
    ...detail,
  }));
}

export function sanitizeUserRecord(row: Record<string, unknown>) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    department: row.department ?? null,
    full_name: row.full_name ?? null,
    email: row.email ?? null,
    active: row.active,
    created_at: row.created_at ?? null,
    last_login: row.last_login ?? null,
    organization_id: row.organization_id || 'org_default',
  };
}
