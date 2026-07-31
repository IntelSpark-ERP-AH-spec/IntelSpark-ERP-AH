import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateToken, type AuthUser } from './auth';
import { handleRequest } from './index';

const env: Env = {
  SUPABASE_URL: 'https://project-ref.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  ALLOWED_ORIGINS: 'https://erp.example.com,http://localhost:5173',
  JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockUserRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    username: 'admin',
    password: bcrypt.hashSync('AdminPass123!@#', 4),
    role: 'admin',
    department: 'direction',
    organization_id: 'org_default',
    full_name: 'Admin',
    email: 'admin@example.com',
    active: 1,
    token_version: 0,
    login_attempts: 0,
    locked_until: null,
    created_at: '2026-01-01T00:00:00',
    last_login: null,
    ...overrides,
  };
}

async function authHeader(user = mockUserRow()): Promise<string> {
  const token = await generateToken(env, {
    ...user,
    permissions: ['*'],
  } as AuthUser);
  return `Bearer ${token}`;
}

function restRouter(handlers: Array<{
  match: (url: string, method: string) => boolean;
  response: () => Response;
}>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    for (const handler of handlers) {
      if (handler.match(url, method)) return handler.response();
    }
    return new Response('[]', { status: 200 });
  });
}

describe('auth login edge cases', () => {
  it('rejects wrong password with same message as missing user', async () => {
    const user = mockUserRow();
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes('/rest/v1/users?username='),
        response: () => new Response(JSON.stringify([user]), { status: 200 }),
      },
      {
        match: (url, method) => url.includes('/rest/v1/users?id=') && method === 'PATCH',
        response: () => new Response(null, { status: 204 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/login', {
        method: 'POST',
        headers: { Origin: 'https://erp.example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'WrongPass999!' }),
      }),
      env,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Identifiants incorrects' });
  });

  it('treats inactive users as incorrect credentials (Express parity)', async () => {
    const user = mockUserRow({ active: 0 });
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes('/rest/v1/users?username='),
        response: () => new Response(JSON.stringify([user]), { status: 200 }),
      },
      {
        match: (url, method) => method === 'PATCH',
        response: () => new Response(null, { status: 204 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/login', {
        method: 'POST',
        headers: { Origin: 'https://erp.example.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'AdminPass123!@#' }),
      }),
      env,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Identifiants incorrects' });
  });
});

describe('auth me and password', () => {
  it('returns current user for GET /api/auth/me', async () => {
    const user = mockUserRow();
    const authorization = await authHeader(user);
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes('/rest/v1/users?id=eq.user-1') && url.includes('select=id,username,role'),
        response: () => new Response(JSON.stringify([{
          id: user.id,
          username: user.username,
          role: user.role,
          department: user.department,
          organization_id: user.organization_id,
          full_name: user.full_name,
          email: user.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist'),
        response: () => new Response('[]', { status: 200 }),
      },
      {
        match: (url) => url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/me', {
        headers: { Origin: 'https://erp.example.com', Authorization: authorization },
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.username).toBe('admin');
    expect(body).not.toHaveProperty('password');
  });

  it('rejects GET /me without cookie/token', async () => {
    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/me', {
        headers: { Origin: 'https://erp.example.com' },
      }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it('rejects expired tokens', async () => {
    const token = await new SignJWT({
      jti: 'expired',
      id: 'user-1',
      username: 'admin',
      role: 'admin',
      organization_id: 'org_default',
      tokenVersion: 0,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('intelsheets')
      .setAudience('intelsheets-web')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(env.JWT_SECRET));

    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/me', {
        headers: { Origin: 'https://erp.example.com', Authorization: `Bearer ${token}` },
      }),
      env,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Session expirée', code: 'TOKEN_EXPIRED' });
  });

  it('rejects invalid tokens', async () => {
    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/me', {
        headers: {
          Origin: 'https://erp.example.com',
          Authorization: 'Bearer not-a-jwt',
        },
      }),
      env,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Token invalide' });
  });

  it('updates allowed profile fields on PUT /me', async () => {
    const user = mockUserRow();
    const authorization = await authHeader(user);
    let patched: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url, method) => url.includes('/rest/v1/users?id=eq.user-1') && method === 'GET',
        response: () => new Response(JSON.stringify([{
          id: user.id,
          username: user.username,
          role: user.role,
          department: user.department,
          organization_id: user.organization_id,
          full_name: user.full_name,
          email: user.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url, method) => url.includes('/rest/v1/users?id=eq.user-1') && method === 'PATCH',
        response: () => {
          patched = { ok: true };
          return new Response(null, { status: 204 });
        },
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/me', {
        method: 'PUT',
        headers: {
          Origin: 'https://erp.example.com',
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ full_name: 'New Name', email: 'new@example.com' }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(patched).toEqual({ ok: true });
  });

  it('forbids privileged fields on PUT /me', async () => {
    const user = mockUserRow();
    const authorization = await authHeader(user);
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes('/rest/v1/users?id=eq.user-1'),
        response: () => new Response(JSON.stringify([{
          id: user.id,
          username: user.username,
          role: user.role,
          department: user.department,
          organization_id: user.organization_id,
          full_name: user.full_name,
          email: user.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/me', {
        method: 'PUT',
        headers: {
          Origin: 'https://erp.example.com',
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'admin', full_name: 'X' }),
      }),
      env,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Champ interdit' });
  });

  it('changes password when current password is valid', async () => {
    const user = mockUserRow();
    const authorization = await authHeader(user);
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes('select=id,username,password'),
        response: () => new Response(JSON.stringify([user]), { status: 200 }),
      },
      {
        match: (url) => url.includes('/rest/v1/users?id=eq.user-1') && !url.includes('password'),
        response: () => new Response(JSON.stringify([{
          id: user.id,
          username: user.username,
          role: user.role,
          department: user.department,
          organization_id: user.organization_id,
          full_name: user.full_name,
          email: user.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (_url, method) => method === 'PATCH' || method === 'POST',
        response: () => new Response(null, { status: 204 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/password', {
        method: 'PUT',
        headers: {
          Origin: 'https://erp.example.com',
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'AdminPass123!@#',
          newPassword: 'BrandNewPass99!@#',
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });

  it('rejects wrong current password', async () => {
    const user = mockUserRow();
    const authorization = await authHeader(user);
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes('select=id,username,password'),
        response: () => new Response(JSON.stringify([user]), { status: 200 }),
      },
      {
        match: (url) => url.includes('/rest/v1/users?id=eq.user-1'),
        response: () => new Response(JSON.stringify([{
          id: user.id,
          username: user.username,
          role: user.role,
          department: user.department,
          organization_id: user.organization_id,
          full_name: user.full_name,
          email: user.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/password', {
        method: 'PUT',
        headers: {
          Origin: 'https://erp.example.com',
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: 'NopeWrong99!@#',
          newPassword: 'BrandNewPass99!@#',
        }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Mot de passe actuel incorrect' });
  });

  it('logs out authenticated user', async () => {
    const user = mockUserRow();
    const authorization = await authHeader(user);
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes('/rest/v1/users?id=eq.user-1'),
        response: () => new Response(JSON.stringify([{
          id: user.id,
          username: user.username,
          role: user.role,
          department: user.department,
          organization_id: user.organization_id,
          full_name: user.full_name,
          email: user.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url, method) => url.includes('sessions_blacklist') && method === 'POST',
        response: () => new Response(null, { status: 201 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/logout', {
        method: 'POST',
        headers: { Origin: 'https://erp.example.com', Authorization: authorization },
      }),
      env,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
});

describe('users admin API', () => {
  function authFetchForAdmin(admin = mockUserRow()) {
    return restRouter([
      {
        match: (url) => url.includes(`/rest/v1/users?id=eq.${admin.id}`) && !url.includes('organization_id=eq'),
        response: () => new Response(JSON.stringify([{
          id: admin.id,
          username: admin.username,
          role: admin.role,
          department: admin.department,
          organization_id: admin.organization_id,
          full_name: admin.full_name,
          email: admin.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]);
  }

  it('lists users for admin', async () => {
    const admin = mockUserRow();
    const authorization = await authHeader(admin);
    const listed = [mockUserRow(), mockUserRow({ id: 'user-2', username: 'bob', role: 'employe' })];
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes(`/rest/v1/users?id=eq.${admin.id}`) && !url.includes('organization_id=eq'),
        response: () => new Response(JSON.stringify([{
          id: admin.id,
          username: admin.username,
          role: 'admin',
          department: admin.department,
          organization_id: admin.organization_id,
          full_name: admin.full_name,
          email: admin.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('organization_id=eq.org_default') && url.includes('order=created_at'),
        response: () => new Response(JSON.stringify(listed), { status: 200 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/users', {
        headers: { Origin: 'https://erp.example.com', Authorization: authorization },
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body[0]).not.toHaveProperty('password');
  });

  it('denies users list for non-admin', async () => {
    const commercial = mockUserRow({ id: 'c1', username: 'com', role: 'commercial' });
    const authorization = await authHeader(commercial);
    vi.stubGlobal('fetch', authFetchForAdmin(commercial));

    const response = await handleRequest(
      new Request('https://api.example.com/api/users', {
        headers: { Origin: 'https://erp.example.com', Authorization: authorization },
      }),
      env,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Rôle non autorisé' });
  });

  it('creates user with valid payload', async () => {
    const admin = mockUserRow();
    const authorization = await authHeader(admin);
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes(`/rest/v1/users?id=eq.${admin.id}`) && !url.includes('organization_id=eq'),
        response: () => new Response(JSON.stringify([{
          id: admin.id,
          username: admin.username,
          role: 'admin',
          department: admin.department,
          organization_id: admin.organization_id,
          full_name: admin.full_name,
          email: admin.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('username=ilike.'),
        response: () => new Response('[]', { status: 200 }),
      },
      {
        match: (url, method) => url.endsWith('/rest/v1/users') && method === 'POST',
        response: () => new Response(JSON.stringify([{ id: 'new-id' }]), { status: 201 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/users', {
        method: 'POST',
        headers: {
          Origin: 'https://erp.example.com',
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'newbie',
          password: 'StrongPass123!@#',
          role: 'employe',
        }),
      }),
      env,
    );
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body.username).toBe('newbie');
    expect(body).not.toHaveProperty('password');
  });

  it('rejects invalid role on create', async () => {
    const admin = mockUserRow();
    const authorization = await authHeader(admin);
    vi.stubGlobal('fetch', authFetchForAdmin(admin));

    const response = await handleRequest(
      new Request('https://api.example.com/api/users', {
        method: 'POST',
        headers: {
          Origin: 'https://erp.example.com',
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'newbie',
          password: 'StrongPass123!@#',
          role: 'superuser',
        }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Rôle invalide' });
  });

  it('protects last active admin on delete', async () => {
    const admin = mockUserRow();
    const authorization = await authHeader(admin);
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes(`/rest/v1/users?id=eq.${admin.id}`) && !url.includes('organization_id=eq'),
        response: () => new Response(JSON.stringify([{
          id: admin.id,
          username: admin.username,
          role: 'admin',
          department: admin.department,
          organization_id: admin.organization_id,
          full_name: admin.full_name,
          email: admin.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('id=eq.admin-2') && url.includes('organization_id=eq'),
        response: () => new Response(JSON.stringify([{
          id: 'admin-2',
          username: 'otheradmin',
          role: 'admin',
          department: null,
          organization_id: 'org_default',
          full_name: null,
          email: null,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('role=eq.admin&active=eq.1'),
        response: () => new Response(JSON.stringify([{ id: 'admin-2' }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/users/admin-2', {
        method: 'DELETE',
        headers: { Origin: 'https://erp.example.com', Authorization: authorization },
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Impossible de supprimer le dernier administrateur actif',
    });
  });

  it('resets password without leaking hash', async () => {
    const admin = mockUserRow();
    const authorization = await authHeader(admin);
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes(`/rest/v1/users?id=eq.${admin.id}`) && !url.includes('organization_id=eq'),
        response: () => new Response(JSON.stringify([{
          id: admin.id,
          username: admin.username,
          role: 'admin',
          department: admin.department,
          organization_id: admin.organization_id,
          full_name: admin.full_name,
          email: admin.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('id=eq.user-2') && url.includes('organization_id=eq'),
        response: () => new Response(JSON.stringify([{
          id: 'user-2',
          username: 'bob',
          role: 'employe',
          department: null,
          organization_id: 'org_default',
          full_name: null,
          email: null,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (_url, method) => method === 'PATCH',
        response: () => new Response(null, { status: 204 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/users/user-2/reset-password', {
        method: 'POST',
        headers: { Origin: 'https://erp.example.com', Authorization: authorization },
      }),
      env,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(typeof body.temporary_password).toBe('string');
    expect(body).not.toHaveProperty('password');
    expect(JSON.stringify(body)).not.toMatch(/\$2[aby]\$/);
  });

  it('blocks cross-organization user update', async () => {
    const admin = mockUserRow();
    const authorization = await authHeader(admin);
    vi.stubGlobal('fetch', restRouter([
      {
        match: (url) => url.includes(`/rest/v1/users?id=eq.${admin.id}`) && !url.includes('organization_id=eq'),
        response: () => new Response(JSON.stringify([{
          id: admin.id,
          username: admin.username,
          role: 'admin',
          department: admin.department,
          organization_id: admin.organization_id,
          full_name: admin.full_name,
          email: admin.email,
          active: 1,
          token_version: 0,
        }]), { status: 200 }),
      },
      {
        match: (url) => url.includes('id=eq.foreign') && url.includes('organization_id=eq.org_default'),
        response: () => new Response('[]', { status: 200 }),
      },
      {
        match: (url) => url.includes('sessions_blacklist') || url.includes('runtime_config'),
        response: () => new Response('[]', { status: 200 }),
      },
    ]));

    const response = await handleRequest(
      new Request('https://api.example.com/api/users/foreign', {
        method: 'PUT',
        headers: {
          Origin: 'https://erp.example.com',
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'employe' }),
      }),
      env,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Utilisateur introuvable' });
  });
});
