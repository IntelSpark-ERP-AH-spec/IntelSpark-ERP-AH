import bcrypt from 'bcryptjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from './index';
import { requireOrganization, requirePermission, requireRole, type AuthUser } from './auth';

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
    ...overrides,
  };
}

describe('worker health', () => {
  it('reports a connected database', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));

    const response = await handleRequest(
      new Request('https://api.example.com/api/health', {
        headers: { Origin: 'https://erp.example.com' },
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      service: 'backend',
      database: 'connected',
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://erp.example.com');
  });

  it('reports database failure safely', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));

    const response = await handleRequest(
      new Request('https://api.example.com/api/health'),
      env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'degraded',
      service: 'backend',
      database: 'unavailable',
    });
  });

  it('rejects an unknown browser origin', async () => {
    const response = await handleRequest(
      new Request('https://api.example.com/api/health', {
        headers: { Origin: 'https://attacker.example' },
      }),
      env,
    );

    expect(response.status).toBe(403);
  });

  it('answers allowed preflight requests for mutations', async () => {
    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/login', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      }),
      env,
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

describe('worker auth contracts', () => {
  it('rejects invalid login payloads with Express-compatible message', async () => {
    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/login', {
        method: 'POST',
        headers: {
          Origin: 'https://erp.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: '', password: '' }),
      }),
      env,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Identifiants requis' });
  });

  it('returns incorrect credentials when user is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/login', {
        method: 'POST',
        headers: {
          Origin: 'https://erp.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: 'missing', password: 'WrongPass123!' }),
      }),
      env,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Identifiants incorrects' });
  });

  it('logs in and returns token + user shape compatible with Express', async () => {
    const user = mockUserRow();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rest/v1/users?username=')) {
        return new Response(JSON.stringify([user]), { status: 200 });
      }
      if (url.includes('/rest/v1/users?id=') && init?.method === 'PATCH') {
        return new Response(null, { status: 204 });
      }
      return new Response('[]', { status: 200 });
    }));

    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/login', {
        method: 'POST',
        headers: {
          Origin: 'https://erp.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: 'admin', password: 'AdminPass123!@#' }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { token: string; user: Record<string, unknown> };
    expect(typeof body.token).toBe('string');
    expect(body.user).toEqual({
      id: 'user-1',
      username: 'admin',
      role: 'admin',
      department: 'direction',
      organization_id: 'org_default',
      full_name: 'Admin',
      email: 'admin@example.com',
    });
  });

  it('requires authentication for logout like Express', async () => {
    const response = await handleRequest(
      new Request('https://api.example.com/api/auth/logout', {
        method: 'POST',
        headers: { Origin: 'https://erp.example.com' },
      }),
      env,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentification requise' });
  });
});

describe('role organization permission guards', () => {
  const baseUser: AuthUser = {
    id: 'u1',
    username: 'commercial1',
    role: 'commercial',
    department: 'ventes',
    organization_id: 'org_default',
    full_name: 'Com',
    email: null,
    active: 1,
    token_version: 0,
    permissions: ['clients:read', 'clients:write', 'stock:read', 'documents:read', 'documents:write', 'dashboard:read', 'ai:use'],
  };

  it('denies missing roles with Express-compatible payload', async () => {
    const denied = requireRole(baseUser, 'admin');
    expect(denied?.status).toBe(403);
    expect(await denied!.json()).toEqual({ error: 'Rôle non autorisé' });
  });

  it('denies missing permissions with Express-compatible payload', async () => {
    const denied = requirePermission(baseUser, 'rh:write');
    expect(denied?.status).toBe(403);
    expect(await denied!.json()).toEqual({ error: 'Permission refusée' });
  });

  it('denies foreign organization access', async () => {
    const denied = requireOrganization(baseUser, 'org_other');
    expect(denied?.status).toBe(403);
    expect(await denied!.json()).toEqual({ error: 'Organisation non autorisée' });
  });

  it('allows matching organization and permission', () => {
    expect(requireOrganization(baseUser, 'org_default')).toBeNull();
    expect(requirePermission(baseUser, 'clients:write')).toBeNull();
    expect(requireRole(baseUser, 'commercial', 'admin')).toBeNull();
  });
});
