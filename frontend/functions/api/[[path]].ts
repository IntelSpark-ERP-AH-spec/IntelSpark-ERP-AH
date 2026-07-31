/**
 * Proxy /api/* from Cloudflare Pages to the API Worker (same-origin for the SPA).
 * Configure Pages env var API_UPSTREAM = https://intelspark-erp-api.<subdomain>.workers.dev
 */
export async function onRequest(context: {
  request: Request;
  env: { API_UPSTREAM?: string };
  params: { path?: string | string[] };
}): Promise<Response> {
  const upstreamBase = String(context.env.API_UPSTREAM || '').trim().replace(/\/+$/, '');
  if (!upstreamBase) {
    return Response.json(
      { error: 'API Cloudflare non configurée (API_UPSTREAM manquant)' },
      { status: 503 },
    );
  }

  const incoming = new URL(context.request.url);
  const pathParts = context.params.path;
  const suffix = Array.isArray(pathParts) ? pathParts.join('/') : String(pathParts || '');
  const target = new URL(`${upstreamBase}/api/${suffix}${incoming.search}`);

  const headers = new Headers(context.request.headers);
  headers.delete('host');

  const init: RequestInit = {
    method: context.request.method,
    headers,
    redirect: 'manual',
  };
  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    init.body = context.request.body;
    // @ts-expect-error duplex required for streaming body in some runtimes
    init.duplex = 'half';
  }

  const response = await fetch(target, init);
  const outHeaders = new Headers(response.headers);
  outHeaders.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, headers: outHeaders });
}
