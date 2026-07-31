/**
 * Frontend-used API routes that must exist on the Worker for Cloudflare cutover.
 * Priority P0–P2 must be covered before Pages deploy.
 *
 * Commercial devis/BL/BC/factures/clients/catalog live as organization_documents
 * keys via /api/data/* (not separate REST resources).
 */
export const FRONTEND_ROUTES = [
  // P0 — auth / session / users / org data / settings
  { method: 'POST', path: '/api/auth/login', priority: 'P0', feature: 'auth' },
  { method: 'GET', path: '/api/auth/me', priority: 'P0', feature: 'auth' },
  { method: 'POST', path: '/api/auth/logout', priority: 'P0', feature: 'auth' },
  { method: 'GET', path: '/api/users', priority: 'P0', feature: 'users' },
  { method: 'POST', path: '/api/users', priority: 'P0', feature: 'users' },
  { method: 'PUT', path: '/api/users/:id', priority: 'P0', feature: 'users' },
  { method: 'DELETE', path: '/api/users/:id', priority: 'P0', feature: 'users' },
  { method: 'GET', path: '/api/system/config/public', priority: 'P0', feature: 'system' },
  { method: 'GET', path: '/api/data/context', priority: 'P0', feature: 'organization' },
  { method: 'GET', path: '/api/data/load', priority: 'P0', feature: 'organization' },
  { method: 'POST', path: '/api/data/save', priority: 'P0', feature: 'organization' },
  { method: 'GET', path: '/api/data/doc/:key', priority: 'P0', feature: 'organization' },
  { method: 'PUT', path: '/api/data/doc/:key', priority: 'P0', feature: 'organization' },
  { method: 'DELETE', path: '/api/data/doc/:key', priority: 'P0', feature: 'organization' },
  { method: 'PUT', path: '/api/data/company-settings/:scope', priority: 'P0', feature: 'organization' },

  // P1 — stock / fournisseurs / commandes (+ catalog/clients via data docs)
  { method: 'GET', path: '/api/stock', priority: 'P1', feature: 'stock' },
  { method: 'GET', path: '/api/stock/categories', priority: 'P1', feature: 'stock' },
  { method: 'GET', path: '/api/stock/stats/global', priority: 'P1', feature: 'stock' },
  { method: 'POST', path: '/api/stock', priority: 'P1', feature: 'stock' },
  { method: 'PUT', path: '/api/stock/:id', priority: 'P1', feature: 'stock' },
  { method: 'DELETE', path: '/api/stock/:id', priority: 'P1', feature: 'stock' },
  { method: 'GET', path: '/api/stock/:id/mouvements', priority: 'P1', feature: 'stock' },
  { method: 'POST', path: '/api/stock/:id/entree', priority: 'P1', feature: 'stock' },
  { method: 'POST', path: '/api/stock/:id/sortie', priority: 'P1', feature: 'stock' },
  { method: 'POST', path: '/api/stock/:id/inventaire', priority: 'P1', feature: 'stock' },
  { method: 'GET', path: '/api/fournisseurs', priority: 'P1', feature: 'fournisseurs' },
  { method: 'POST', path: '/api/fournisseurs', priority: 'P1', feature: 'fournisseurs' },
  { method: 'PUT', path: '/api/fournisseurs/:id', priority: 'P1', feature: 'fournisseurs' },
  { method: 'DELETE', path: '/api/fournisseurs/:id', priority: 'P1', feature: 'fournisseurs' },
  { method: 'GET', path: '/api/commandes', priority: 'P1', feature: 'commandes' },
  { method: 'GET', path: '/api/commandes/stats', priority: 'P1', feature: 'commandes' },
  { method: 'GET', path: '/api/commandes/:id', priority: 'P1', feature: 'commandes' },
  { method: 'POST', path: '/api/commandes', priority: 'P1', feature: 'commandes' },
  { method: 'DELETE', path: '/api/commandes/:id', priority: 'P1', feature: 'commandes' },
  { method: 'GET', path: '/api/dashboard', priority: 'P1', feature: 'dashboard' },

  // P2 — commercial docs via data keys; warehouse BL publish used by App
  { method: 'GET', path: '/api/warehouse/bons-livraison', priority: 'P2', feature: 'documents' },
  { method: 'POST', path: '/api/warehouse/bons-livraison', priority: 'P2', feature: 'documents' },
  { method: 'GET', path: '/api/warehouse/bons-livraison/:numero', priority: 'P2', feature: 'documents' },
  { method: 'POST', path: '/api/warehouse/bons-livraison/:id/valider', priority: 'P2', feature: 'documents' },
];

export const WORKER_ROUTES = [
  { method: 'GET', path: '/api/health' },
  { method: 'POST', path: '/api/auth/login' },
  { method: 'GET', path: '/api/auth/me' },
  { method: 'PUT', path: '/api/auth/me' },
  { method: 'PUT', path: '/api/auth/password' },
  { method: 'POST', path: '/api/auth/logout' },
  { method: 'GET', path: '/api/users' },
  { method: 'POST', path: '/api/users' },
  { method: 'PUT', path: '/api/users/:id' },
  { method: 'DELETE', path: '/api/users/:id' },
  { method: 'POST', path: '/api/users/:id/reset-password' },
  { method: 'GET', path: '/api/system/config/public' },
  { method: 'GET', path: '/api/data/context' },
  { method: 'GET', path: '/api/data/load' },
  { method: 'POST', path: '/api/data/save' },
  { method: 'GET', path: '/api/data/doc/:key' },
  { method: 'PUT', path: '/api/data/doc/:key' },
  { method: 'DELETE', path: '/api/data/doc/:key' },
  { method: 'PUT', path: '/api/data/company-settings/:scope' },
  { method: 'GET', path: '/api/stock' },
  { method: 'GET', path: '/api/stock/categories' },
  { method: 'GET', path: '/api/stock/stats/global' },
  { method: 'POST', path: '/api/stock' },
  { method: 'PUT', path: '/api/stock/:id' },
  { method: 'DELETE', path: '/api/stock/:id' },
  { method: 'GET', path: '/api/stock/:id/mouvements' },
  { method: 'POST', path: '/api/stock/:id/entree' },
  { method: 'POST', path: '/api/stock/:id/sortie' },
  { method: 'POST', path: '/api/stock/:id/inventaire' },
  { method: 'GET', path: '/api/fournisseurs' },
  { method: 'POST', path: '/api/fournisseurs' },
  { method: 'PUT', path: '/api/fournisseurs/:id' },
  { method: 'DELETE', path: '/api/fournisseurs/:id' },
  { method: 'GET', path: '/api/commandes' },
  { method: 'GET', path: '/api/commandes/stats' },
  { method: 'GET', path: '/api/commandes/:id' },
  { method: 'POST', path: '/api/commandes' },
  { method: 'DELETE', path: '/api/commandes/:id' },
  { method: 'GET', path: '/api/dashboard' },
  { method: 'GET', path: '/api/warehouse/bons-livraison' },
  { method: 'POST', path: '/api/warehouse/bons-livraison' },
  { method: 'GET', path: '/api/warehouse/bons-livraison/:numero' },
  { method: 'POST', path: '/api/warehouse/bons-livraison/:id/valider' },
];

export function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
}

export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

export function pathMatches(pattern: string, path: string): boolean {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
}

export function findWorkerRoute(method: string, path: string) {
  return WORKER_ROUTES.find(
    (route) => route.method === method.toUpperCase() && pathMatches(route.path, path),
  );
}

export function coverageReport(priorities: string[] = ['P0', 'P1', 'P2']) {
  const required = FRONTEND_ROUTES.filter((route) => priorities.includes(route.priority));
  const covered = required.filter((route) => findWorkerRoute(route.method, route.path));
  const missing = required.filter((route) => !findWorkerRoute(route.method, route.path));
  const unused = WORKER_ROUTES.filter(
    (workerRoute) => !FRONTEND_ROUTES.some(
      (front) => front.method === workerRoute.method && pathMatches(front.path, workerRoute.path),
    ),
  );
  const byPriority = Object.fromEntries(priorities.map((priority) => {
    const group = required.filter((route) => route.priority === priority);
    const groupCovered = group.filter((route) => findWorkerRoute(route.method, route.path));
    return [priority, {
      total: group.length,
      covered: groupCovered.length,
      missing: group.length - groupCovered.length,
      percent: group.length ? Math.round((groupCovered.length / group.length) * 100) : 100,
    }];
  }));
  return {
    frontendRoutes: FRONTEND_ROUTES.length,
    workerRoutes: WORKER_ROUTES.length,
    required: required.length,
    covered: covered.map((route) => routeKey(route.method, route.path)),
    missing: missing.map((route) => ({
      ...route,
      key: routeKey(route.method, route.path),
    })),
    unused: unused.map((route) => routeKey(route.method, route.path)),
    byPriority,
    percent: required.length ? Math.round((covered.length / required.length) * 100) : 100,
  };
}
