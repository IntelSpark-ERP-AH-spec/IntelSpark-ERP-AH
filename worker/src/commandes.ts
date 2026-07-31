import type { AuthUser } from './auth';
import { json, supabaseRest } from './http';
import { hasRole } from './permissions';
import { auditAction } from './middleware';

async function nextNumero(env: Env): Promise<string> {
  const result = await supabaseRest<Array<{ value: string }>>(
    env,
    `user_data?user_id=eq._system&key=eq.commande_counter&select=value&limit=1`,
  );
  const current = result.ok && Array.isArray(result.data) && result.data[0]
    ? Number.parseInt(String(result.data[0].value), 10) || 0
    : 0;
  const next = current + 1;
  if (result.ok && Array.isArray(result.data) && result.data[0]) {
    await supabaseRest(env, 'user_data?user_id=eq._system&key=eq.commande_counter', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ value: String(next) }),
    });
  } else {
    await supabaseRest(env, 'user_data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        user_id: '_system',
        key: 'commande_counter',
        value: String(next),
      }),
    });
  }
  return `CMD-${String(next).padStart(5, '0')}`;
}

export async function handleCommandesList(
  request: Request,
  env: Env,
  _user: AuthUser,
  cors: HeadersInit,
): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const fournisseurId = url.searchParams.get('fournisseur_id');

  let path = 'commandes_achat?select=*,fournisseurs(nom)&order=created_at.desc';
  if (status) path += `&status=eq.${encodeURIComponent(status)}`;
  if (fournisseurId) path += `&fournisseur_id=eq.${encodeURIComponent(fournisseurId)}`;

  const result = await supabaseRest<Array<Record<string, unknown>>>(env, path);
  const rows = (result.ok && Array.isArray(result.data) ? result.data : []).map((row) => {
    const fournisseur = row.fournisseurs as { nom?: string } | null;
    const { fournisseurs: _f, ...rest } = row;
    return { ...rest, fournisseur_nom: fournisseur?.nom || null };
  });
  return json(rows, 200, cors);
}

export async function handleCommandesStats(env: Env, _user: AuthUser, cors: HeadersInit): Promise<Response> {
  const all = await supabaseRest<Array<{ status: string; total_ht: number }>>(
    env,
    'commandes_achat?select=status,total_ht',
  );
  const rows = all.ok && Array.isArray(all.data) ? all.data : [];
  const total = rows.length;
  const enAttente = rows.filter((r) => r.status === 'en_attente').length;
  const enCours = rows.filter((r) => r.status === 'validee' || r.status === 'livree_partielle').length;
  const totalHt = rows
    .filter((r) => r.status !== 'annulee')
    .reduce((sum, r) => sum + Number(r.total_ht || 0), 0);
  return json({ total, enAttente, enCours, totalHt }, 200, cors);
}

export async function handleCommandeGet(
  env: Env,
  _user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  const result = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    `commandes_achat?id=eq.${encodeURIComponent(id)}&select=*,fournisseurs(nom,email,telephone)&limit=1`,
  );
  if (!result.ok || !Array.isArray(result.data) || !result.data[0]) {
    return json({ error: 'Commande introuvable' }, 404, cors);
  }
  const row = result.data[0];
  const fournisseur = row.fournisseurs as { nom?: string; email?: string; telephone?: string } | null;
  const { fournisseurs: _f, ...rest } = row;
  const items = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    `commandes_achat_items?commande_id=eq.${encodeURIComponent(id)}&select=*,produits(reference,designation)`,
  );
  const mappedItems = (items.ok && Array.isArray(items.data) ? items.data : []).map((item) => {
    const produit = item.produits as { reference?: string; designation?: string } | null;
    const { produits: _p, ...itemRest } = item;
    return {
      ...itemRest,
      reference: produit?.reference || null,
      produit_designation: produit?.designation || null,
    };
  });
  return json({
    ...rest,
    fournisseur_nom: fournisseur?.nom || null,
    fournisseur_email: fournisseur?.email || null,
    fournisseur_telephone: fournisseur?.telephone || null,
    items: mappedItems,
  }, 200, cors);
}

export async function handleCommandeCreate(
  request: Request,
  env: Env,
  user: AuthUser,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'commercial', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'Données invalides' }, 400, cors); }

  const fournisseurId = String(body.fournisseur_id || '');
  const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
  if (!fournisseurId) return json({ error: 'fournisseur_id requis' }, 400, cors);
  if (!items.length) return json({ error: 'Au moins un article requis' }, 400, cors);

  const id = crypto.randomUUID();
  const numero = await nextNumero(env);
  let totalHt = 0;
  let totalTtc = 0;
  const prepared = items.map((item) => {
    const prixHt = Number(item.prix_unitaire_ht || 0);
    const tva = Number(item.tva_rate || 20);
    const qte = Number(item.quantite_commandee || 1);
    totalHt += prixHt * qte;
    totalTtc += prixHt * qte * (1 + tva / 100);
    return {
      id: crypto.randomUUID(),
      commande_id: id,
      produit_id: item.produit_id || null,
      designation: item.designation,
      quantite_commandee: qte,
      prix_unitaire_ht: prixHt,
      tva_rate: tva,
    };
  });

  const insert = await supabaseRest(env, 'commandes_achat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id,
      numero,
      fournisseur_id: fournisseurId,
      date_livraison_prevue: body.date_livraison_prevue || null,
      total_ht: totalHt,
      total_ttc: totalTtc,
      notes: body.notes || null,
      user_id: user.id,
      status: 'en_attente',
    }),
  });
  if (!insert.ok) return json({ error: 'Erreur interne' }, 500, cors);

  const itemsInsert = await supabaseRest(env, 'commandes_achat_items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(prepared),
  });
  if (!itemsInsert.ok) {
    await supabaseRest(env, `commandes_achat?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    return json({ error: 'Erreur interne' }, 500, cors);
  }
  auditAction('commandes.create', user, { id, numero });
  return json({ id, numero, total_ht: totalHt, total_ttc: totalTtc }, 201, cors);
}

export async function handleCommandeDelete(
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'commercial', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  await supabaseRest(env, `commandes_achat_items?commande_id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const deleted = await supabaseRest(env, `commandes_achat?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  if (!deleted.ok || (Array.isArray(deleted.data) && deleted.data.length === 0)) {
    return json({ error: 'Commande introuvable' }, 404, cors);
  }
  auditAction('commandes.delete', user, { id });
  return json({ success: true }, 200, cors);
}
