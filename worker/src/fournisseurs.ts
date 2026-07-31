import type { AuthUser } from './auth';
import { json, supabaseRest } from './http';
import { hasRole } from './permissions';
import { auditAction } from './middleware';

type Fournisseur = Record<string, unknown> & { id: string; nom: string };

export async function handleFournisseursList(
  request: Request,
  env: Env,
  _user: AuthUser,
  cors: HeadersInit,
): Promise<Response> {
  const url = new URL(request.url);
  const search = url.searchParams.get('search');
  const categorie = url.searchParams.get('categorie');
  const actif = url.searchParams.get('actif');

  let path = 'fournisseurs?select=*&order=nom.asc';
  if (search) {
    path = `fournisseurs?or=(nom.ilike.*${encodeURIComponent(search)}*,email.ilike.*${encodeURIComponent(search)}*,siret.ilike.*${encodeURIComponent(search)}*)&select=*&order=nom.asc`;
  }
  if (categorie) path += `&categorie=eq.${encodeURIComponent(categorie)}`;
  if (actif !== null && actif !== undefined && actif !== '') {
    path += `&actif=eq.${actif === '1' ? 1 : 0}`;
  }

  const result = await supabaseRest<Fournisseur[]>(env, path);
  return json(result.ok && Array.isArray(result.data) ? result.data : [], 200, cors);
}

export async function handleFournisseurCreate(
  request: Request,
  env: Env,
  user: AuthUser,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'commercial', 'comptable')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'Données invalides' }, 400, cors); }
  const nom = String(body.nom || '').trim();
  if (!nom) return json({ error: 'nom requis' }, 400, cors);
  const id = crypto.randomUUID();
  const insert = await supabaseRest(env, 'fournisseurs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id,
      nom,
      contact: body.contact || '',
      email: body.email || '',
      telephone: body.telephone || '',
      adresse: body.adresse || '',
      siret: body.siret || '',
      ice: body.ice || '',
      categorie: body.categorie ?? null,
      notes: body.notes ?? null,
      actif: 1,
    }),
  });
  if (!insert.ok) return json({ error: 'Erreur interne' }, 500, cors);
  auditAction('fournisseurs.create', user, { id, nom });
  return json({ id, nom }, 201, cors);
}

export async function handleFournisseurUpdate(
  request: Request,
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'commercial', 'comptable')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'Données invalides' }, 400, cors); }

  const updated = await supabaseRest(env, `fournisseurs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      nom: body.nom,
      contact: body.contact,
      email: body.email,
      telephone: body.telephone,
      adresse: body.adresse,
      siret: body.siret,
      ice: body.ice,
      categorie: body.categorie,
      notes: body.notes,
      actif: body.actif ?? 1,
    }),
  });
  if (!updated.ok) return json({ error: 'Erreur interne' }, 500, cors);
  auditAction('fournisseurs.update', user, { id });
  return json({ success: true }, 200, cors);
}

export async function handleFournisseurDelete(
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin')) return json({ error: 'Rôle non autorisé' }, 403, cors);
  const linked = await supabaseRest<Array<{ id: string }>>(
    env,
    `commandes_achat?fournisseur_id=eq.${encodeURIComponent(id)}&select=id&limit=1`,
  );
  if (linked.ok && Array.isArray(linked.data) && linked.data.length) {
    return json({ error: 'Suppression impossible: des documents liés doivent être vérifiés' }, 409, cors);
  }
  const deleted = await supabaseRest(env, `fournisseurs?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
  if (!deleted.ok) return json({ error: 'Erreur interne' }, 500, cors);
  auditAction('fournisseurs.delete', user, { id });
  return json({ success: true }, 200, cors);
}
