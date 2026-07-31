import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('worker auth', () => {
  it('rejects invalid login payloads', async () => {
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
});
