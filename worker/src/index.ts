import {
  handleChangePassword,
  handleLogin,
  handleLogout,
  handleMe,
  handleUpdateMe,
} from './auth';
import {
  handleCommandeCreate,
  handleCommandeDelete,
  handleCommandeGet,
  handleCommandesList,
  handleCommandesStats,
} from './commandes';
import { handleDashboard } from './dashboard';
import {
  handleCompanySettings,
  handleDataContext,
  handleDataLoad,
  handleDataSave,
  handleDocDelete,
  handleDocGet,
  handleDocPut,
} from './data';
import {
  handleFournisseurCreate,
  handleFournisseurDelete,
  handleFournisseursList,
  handleFournisseurUpdate,
} from './fournisseurs';
import { corsHeaders, json, normalizedSupabaseUrl, supabaseHeaders } from './http';
import { requireAdmin, requireAuth } from './middleware';
import {
  handleStockCategories,
  handleStockCreate,
  handleStockDelete,
  handleStockList,
  handleStockMovement,
  handleStockMouvements,
  handleStockStats,
  handleStockUpdate,
} from './stock';
import { handlePublicSystemConfig } from './system';
import {
  handleCreateUser,
  handleDeleteUser,
  handleListUsers,
  handleResetPassword,
  handleUpdateUser,
} from './users';
import {
  handleBlCreate,
  handleBlGetByNumero,
  handleBlList,
  handleBlValidate,
} from './warehouse';

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

    // Auth
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

    // System public config (auth optional / required like Express)
    if (pathname === '/api/system/config/public' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handlePublicSystemConfig(env, user, cors);
    }

    // Users
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

    // Data / organization
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
    const companyMatch = pathname.match(/^\/api\/data\/company-settings\/([a-zA-Z]+)$/);
    if (companyMatch && request.method === 'PUT') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleCompanySettings(request, env, user, companyMatch[1], cors);
    }
    const docMatch = pathname.match(/^\/api\/data\/doc\/([a-zA-Z0-9_]{1,50})$/);
    if (docMatch) {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      if (request.method === 'GET') return handleDocGet(env, user, docMatch[1], cors);
      if (request.method === 'PUT') return handleDocPut(request, env, user, docMatch[1], cors);
      if (request.method === 'DELETE') return handleDocDelete(env, user, docMatch[1], cors);
    }

    // Dashboard
    if (pathname === '/api/dashboard' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleDashboard(env, user, cors);
    }

    // Stock
    if (pathname === '/api/stock' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleStockList(request, env, user, cors);
    }
    if (pathname === '/api/stock' && request.method === 'POST') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleStockCreate(request, env, user, cors);
    }
    if (pathname === '/api/stock/categories' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleStockCategories(env, user, cors);
    }
    if (pathname === '/api/stock/stats/global' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleStockStats(env, user, cors);
    }
    const stockMoveMatch = pathname.match(/^\/api\/stock\/([^/]+)\/(mouvements|entree|sortie|inventaire)$/);
    if (stockMoveMatch) {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      const stockId = decodeURIComponent(stockMoveMatch[1]);
      const action = stockMoveMatch[2];
      if (action === 'mouvements' && request.method === 'GET') {
        return handleStockMouvements(env, user, stockId, cors);
      }
      if (request.method === 'POST' && (action === 'entree' || action === 'sortie' || action === 'inventaire')) {
        return handleStockMovement(request, env, user, stockId, action, cors);
      }
    }
    const stockIdMatch = pathname.match(/^\/api\/stock\/([^/]+)$/);
    if (stockIdMatch) {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      const stockId = decodeURIComponent(stockIdMatch[1]);
      if (request.method === 'PUT') return handleStockUpdate(request, env, user, stockId, cors);
      if (request.method === 'DELETE') return handleStockDelete(env, user, stockId, cors);
    }

    // Fournisseurs
    if (pathname === '/api/fournisseurs' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleFournisseursList(request, env, user, cors);
    }
    if (pathname === '/api/fournisseurs' && request.method === 'POST') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleFournisseurCreate(request, env, user, cors);
    }
    const fournisseurMatch = pathname.match(/^\/api\/fournisseurs\/([^/]+)$/);
    if (fournisseurMatch) {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      const fid = decodeURIComponent(fournisseurMatch[1]);
      if (request.method === 'PUT') return handleFournisseurUpdate(request, env, user, fid, cors);
      if (request.method === 'DELETE') return handleFournisseurDelete(env, user, fid, cors);
    }

    // Commandes
    if (pathname === '/api/commandes' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleCommandesList(request, env, user, cors);
    }
    if (pathname === '/api/commandes' && request.method === 'POST') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleCommandeCreate(request, env, user, cors);
    }
    if (pathname === '/api/commandes/stats' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleCommandesStats(env, user, cors);
    }
    const commandeMatch = pathname.match(/^\/api\/commandes\/([^/]+)$/);
    if (commandeMatch) {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      const cid = decodeURIComponent(commandeMatch[1]);
      if (request.method === 'GET') return handleCommandeGet(env, user, cid, cors);
      if (request.method === 'DELETE') return handleCommandeDelete(env, user, cid, cors);
    }

    // Warehouse BL (P2 commercial expedition)
    if (pathname === '/api/warehouse/bons-livraison' && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleBlList(request, env, user, cors);
    }
    if (pathname === '/api/warehouse/bons-livraison' && request.method === 'POST') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleBlCreate(request, env, user, cors);
    }
    const blValidateMatch = pathname.match(/^\/api\/warehouse\/bons-livraison\/([^/]+)\/valider$/);
    if (blValidateMatch && request.method === 'POST') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleBlValidate(request, env, user, decodeURIComponent(blValidateMatch[1]), cors);
    }
    const blNumeroMatch = pathname.match(/^\/api\/warehouse\/bons-livraison\/([^/]+)$/);
    if (blNumeroMatch && request.method === 'GET') {
      const user = await requireAuth(request, env, cors);
      if (user instanceof Response) return user;
      return handleBlGetByNumero(env, user, blNumeroMatch[1], cors);
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
