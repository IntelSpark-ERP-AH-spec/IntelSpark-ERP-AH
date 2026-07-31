import {
  handleChangePassword,
  handleLogin,
  handleLogout,
  handleMe,
  handleUpdateMe,
} from './auth';
import {
  handleDataContext,
  handleDataLoad,
  handleDataSave,
  handleDocGet,
  handleDocPut,
} from './data';
import { corsHeaders, json, normalizedSupabaseUrl, supabaseHeaders } from './http';
import { requireAdmin, requireAuth } from './middleware';
import {
  handleCreateUser,
  handleDeleteUser,
  handleListUsers,
  handleResetPassword,
  handleUpdateUser,
} from './users';

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

    // --- Auth (parity with backend/routes/auth.js; SMTP stays on Express) ---
    if (pathname === '/api/auth/login' && request.method === 'POST') {
      return handleLogin(request, env, cors);
    }
    if (pathname === '/api/auth/me' && request.method === 'GET') {
      return handleMe(request, env, cors);
    }
    if (pathname === '/api/auth/me' && request.method === 'PUT') {
      return handleUpdateMe(request, env, cors);
    }
    if (pathname === '/api/auth/password' && request.method === 'PUT') {
      return handleChangePassword(request, env, cors);
    }
    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      return handleLogout(request, env, cors);
    }

    // --- Users (admin only; parity with backend/routes/users.js) ---
    if (pathname === '/api/users' && request.method === 'GET') {
      const admin = await requireAdmin(request, env, cors);
      if (admin instanceof Response) return admin;
      return handleListUsers(env, admin, cors);
    }
    if (pathname === '/api/users' && request.method === 'POST') {
      const admin = await requireAdmin(request, env, cors);
      if (admin instanceof Response) return admin;
      return handleCreateUser(request, env, admin, cors);
    }

    const resetMatch = pathname.match(/^\/api\/users\/([^/]+)\/reset-password$/);
    if (resetMatch && request.method === 'POST') {
      const admin = await requireAdmin(request, env, cors);
      if (admin instanceof Response) return admin;
      return handleResetPassword(env, admin, decodeURIComponent(resetMatch[1]), cors);
    }

    const userMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch) {
      const admin = await requireAdmin(request, env, cors);
      if (admin instanceof Response) return admin;
      const userId = decodeURIComponent(userMatch[1]);
      if (request.method === 'PUT') return handleUpdateUser(request, env, admin, userId, cors);
      if (request.method === 'DELETE') return handleDeleteUser(env, admin, userId, cors);
    }

    // --- Data (supporting; SPA still on Express until cutover) ---
    if (pathname === '/api/data/context' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleDataContext(env, user, cors);
    }
    if (pathname === '/api/data/load' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleDataLoad(env, user, cors);
    }
    if (pathname === '/api/data/save' && request.method === 'POST') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleDataSave(request, env, user, cors);
    }

    const docMatch = pathname.match(/^\/api\/data\/doc\/([a-zA-Z0-9_]{1,50})$/);
    if (docMatch) {
      const user = await requireAuth(request, env, cors);
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
