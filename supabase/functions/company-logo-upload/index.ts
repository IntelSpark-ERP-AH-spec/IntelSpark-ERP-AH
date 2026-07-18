import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0';

const allowedOrigins = new Set([
  'https://intelspark-erp-ah.netlify.app',
  'http://localhost:3001', 'http://localhost:5173', 'http://localhost:5174',
]);

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://intelspark-erp-ah.netlify.app',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Méthode refusée' }, 405);

  const authorization = req.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json(req, { error: 'Authentification requise' }, 401);
  const appUrl = (Deno.env.get('APP_PUBLIC_URL') || 'https://intelspark-erp-ah.netlify.app').replace(/\/$/, '');
  const identityResponse = await fetch(`${appUrl}/api/auth/me`, {
    headers: { Authorization: authorization, 'X-Requested-With': 'XMLHttpRequest' },
  }).catch(() => null);
  if (!identityResponse?.ok) return json(req, { error: 'Session invalide' }, 401);
  const user = await identityResponse.json();
  if (user.role !== 'admin' || !user.organization_id) return json(req, { error: 'Accès refusé' }, 403);

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return json(req, { error: 'Logo manquant' }, 400);
  const mimeToExtension: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg',
  };
  const extension = mimeToExtension[file.type];
  if (!extension) return json(req, { error: 'Format interdit' }, 415);
  if (file.size > 2 * 1024 * 1024) return json(req, { error: 'Logo limité à 2 Mo' }, 413);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const objectPath = `${user.organization_id}/company-logo.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage.from('company-assets').upload(objectPath, bytes, {
    contentType: file.type, upsert: true, cacheControl: '3600',
  });
  if (error) return json(req, { error: 'Stockage logo indisponible' }, 500);
  const { data } = supabase.storage.from('company-assets').getPublicUrl(objectPath);
  return json(req, { url: `${data.publicUrl}?v=${Date.now()}` });
});
