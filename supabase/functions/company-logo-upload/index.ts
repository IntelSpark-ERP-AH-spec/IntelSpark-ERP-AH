import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.0';

const allowedOrigins = new Set([
  'https://intelspark-erp-ah.netlify.app',
  'https://tourmaline-crostata-f9cf29.netlify.app',
  'http://localhost:3001', 'http://localhost:5173', 'http://localhost:5174',
]);
for (const key of ['APP_PUBLIC_URL', 'URL', 'SITE_URL']) {
  const value = Deno.env.get(key)?.trim().replace(/\/$/, '');
  if (value) allowedOrigins.add(value);
}

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    // Do not emit a wildcard: the upload endpoint accepts authenticated
    // requests and must only allow the configured application origins.
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

  const requestOrigin = (req.headers.get('origin') || '').replace(/\/$/, '');
  if (!allowedOrigins.has(requestOrigin)) return json(req, { error: 'Origine refusée' }, 403);

  const authorization = req.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json(req, { error: 'Authentification requise' }, 401);
  const appUrl = requestOrigin || (Deno.env.get('APP_PUBLIC_URL') || 'https://tourmaline-crostata-f9cf29.netlify.app').replace(/\/$/, '');
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

  const kind = new URL(req.url).searchParams.get('kind') || 'logo';
  if (!['logo', 'brand'].includes(kind)) return json(req, { error: 'Type image invalide' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const objectPath = kind === 'brand'
    ? `${user.organization_id}/brands/${crypto.randomUUID()}.${extension}`
    : `${user.organization_id}/company-logo.${extension}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage.from('company-assets').upload(objectPath, bytes, {
    contentType: file.type, upsert: kind === 'logo', cacheControl: '3600',
  });
  if (error) return json(req, { error: 'Stockage logo indisponible' }, 500);
  const { data } = supabase.storage.from('company-assets').getPublicUrl(objectPath);
  const logoUrl = data.publicUrl;

  // Draft uploads only place the file in Storage. The settings/document rows
  // are written by the explicit company save button in the application.
  const shouldPersist = kind === 'logo' && new URL(req.url).searchParams.get('persist') !== '0';
  if (!shouldPersist) return json(req, { url: `${logoUrl}?v=${Date.now()}` });

  // Persist the canonical URL from the trusted function as part of the same
  // operation.  The browser still mirrors it through /api/data/doc/is_logo,
  // but this server-side write prevents a transient network failure in the
  // second request from leaving the logo visible on only one device.
  const updatedBy = Number.isFinite(Number(user.id)) ? Number(user.id) : null;
  const { error: settingsError } = await supabase.from('company_settings').upsert({
    organization_id: user.organization_id,
    logo_url: logoUrl,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id' });
  if (settingsError) {
    await supabase.storage.from('company-assets').remove([objectPath]).catch(() => {});
    return json(req, { error: 'Persistance du logo indisponible' }, 500);
  }
  const { error: documentError } = await supabase.from('organization_documents').upsert({
    organization_id: user.organization_id,
    key: 'is_logo',
    value_json: JSON.stringify(logoUrl),
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'organization_id,key' });
  if (documentError) {
    await supabase.storage.from('company-assets').remove([objectPath]).catch(() => {});
    return json(req, { error: 'Persistance du logo indisponible' }, 500);
  }
  return json(req, { url: `${logoUrl}?v=${Date.now()}` });
});
