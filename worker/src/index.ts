import { authenticateRequest, handleLogin, handleLogout, handleMe } from './auth';
import {
  handleDataContext,
  handleDataLoad,
  handleDataSave,
  handleDocGet,
  handleDocPut,
} from './data';
import { corsHeaders, json, normalizedSupabaseUrl, supabaseHeaders } from './http';

const HEALTH_PATH = '/api/health';

async function databaseStatus(env: Env): Promise<'connected' | 'unavailable'> {
  const baseUrl = normalizedSupabaseUrl(env.SUPABASE_URL);
  if (!baseUrl || !env.SUPABASE_SERVICE_ROLE_KEY) return 'unavailable';

  try {
    const response = await fetch(
      `${baseUrl}/rest/v1/organizations?select=id&limit=1`,
      {
        method: 'GET',
        headers: supabaseHeaders(env),
      },
    );
    if (!response.ok) {
      console.warn(JSON.stringify({
        event: 'database_health_failed',
        status: response.status,
      }));
      return 'unavailable';
    }
    return 'connected';
  } catch {
    console.warn(JSON.stringify({ event: 'database_health_request_failed' }));
    return 'unavailable';
  }
}

function withCors(response: Response, cors: HeadersInit): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, String(value));
  return new Response(response.body, { status: response.status, headers });
}

async function requireUser(request: Request, env: Env, cors: HeadersInit) {
  const auth = await authenticateRequest(request, env);
  if (auth instanceof Response) return withCors(auth, cors);
  return auth;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (cors === null) {
    return json({ error: 'Origin not allowed' }, 403);
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(request.url);
  const { pathname } = url;

  try {
    if (request.method === 'GET' && pathname === HEALTH_PATH) {
      const database = await databaseStatus(env);
      return json(
        {
          status: database === 'connected' ? 'ok' : 'degraded',
          service: 'backend',
          database,
        },
        database === 'connected' ? 200 : 503,
        cors,
      );
    }

    if (pathname === '/api/auth/login' && request.method === 'POST') {
      return handleLogin(request, env, cors);
    }
    if (pathname === '/api/auth/me' && request.method === 'GET') {
      return handleMe(request, env, cors);
    }
    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      return handleLogout(request, env, cors);
    }

    if (pathname === '/api/data/context' && request.method === 'GET') {
      const user = await requireUser(request, env, cors);
      if (user instanceof Response) return user;
      return handleDataContext(env, user, cors);
    }
    if (pathname === '/api/data/load' && request.method === 'GET') {
      const user = await requireUser(request, env, cors);
      if (user instanceof Response) return user;
      return handleDataLoad(env, user, cors);
    }
    if (pathname === '/api/data/save' && request.method === 'POST') {
      const user = await requireUser(request, env, cors);
      if (user instanceof Response) return user;
      return handleDataSave(request, env, user, cors);
    }

    const docMatch = pathname.match(/^\/api\/data\/doc\/([a-zA-Z0-9_]{1,50})$/);
    if (docMatch) {
      const user = await requireUser(request, env, cors);
      if (user instanceof Response) return user;
      if (request.method === 'GET') return handleDocGet(env, user, docMatch[1], cors);
      if (request.method === 'PUT') return handleDocPut(request, env, user, docMatch[1], cors);
    }

    return json({ error: 'Not found' }, 404, cors);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'worker_request_failed',
      path: pathname,
      message: error instanceof Error ? error.message : 'unknown',
    }));
    return json({ error: 'Erreur interne' }, 500, cors);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
