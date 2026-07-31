export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

export function configuredOrigins(env: Env): Set<string> {
  return new Set(
    String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function corsHeaders(request: Request, env: Env): HeadersInit | null {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  if (!configuredOrigins(env).has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-CSRF-Token, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS, POST, PUT, PATCH, DELETE',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function normalizedSupabaseUrl(value: string): string {
  return value.trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

export function supabaseHeaders(env: Env, extra: HeadersInit = {}): HeadersInit {
  return {
    Accept: 'application/json',
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

export async function supabaseRest<T = unknown>(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null; text: string }> {
  const baseUrl = normalizedSupabaseUrl(env.SUPABASE_URL);
  const response = await fetch(`${baseUrl}/rest/v1/${path.replace(/^\//, '')}`, {
    ...init,
    headers: supabaseHeaders(env, init.headers || {}),
  });
  const text = await response.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data, text };
}
