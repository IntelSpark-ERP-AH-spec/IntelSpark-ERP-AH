import type { AuthUser } from './auth';
import { json, supabaseRest } from './http';
import { hasRole } from './permissions';
import { auditAction } from './middleware';

type Produit = {
  id: string;
  organization_id: string;
  reference: string;
  designation: string;
  categorie: string | null;
  prix_ht: number;
  prix_vente: number;
  tva_rate: number;
  unite: string | null;
  stock_min: number;
  stock_max: number;
  emplacement: string | null;
  fournisseur: string | null;
  code_barre: string | null;
  actif: number;
};

type Mouvement = {
  id: string;
  produit_id: string;
  type: string;
  quantite: number;
  stock_avant: number;
  stock_apres: number;
  motif: string | null;
  user_id: string | null;
  document_id?: string | null;
  created_at?: string;
  organization_id: string;
};

function sumStock(mouvements: Mouvement[]): number {
  let stock = 0;
  for (const row of mouvements) {
    if (row.type === 'entree') stock += Number(row.quantite || 0);
    else if (row.type === 'sortie') stock -= Number(row.quantite || 0);
    else if (row.type === 'inventaire') stock += Number(row.quantite || 0);
  }
  return stock;
}

async function listMouvements(env: Env, organizationId: string, produitId?: string): Promise<Mouvement[]> {
  let path = `stock_mouvements?organization_id=eq.${encodeURIComponent(organizationId)}&select=*&order=created_at.asc`;
  if (produitId) path = `stock_mouvements?produit_id=eq.${encodeURIComponent(produitId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=*&order=created_at.asc`;
  const result = await supabaseRest<Mouvement[]>(env, path);
  return result.ok && Array.isArray(result.data) ? result.data : [];
}

async function findProduct(env: Env, id: string, organizationId: string): Promise<Produit | null> {
  const result = await supabaseRest<Produit[]>(
    env,
    `produits?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=*&limit=1`,
  );
  return result.ok && Array.isArray(result.data) && result.data[0] ? result.data[0] : null;
}

async function currentStock(env: Env, produitId: string, organizationId: string): Promise<number> {
  return sumStock(await listMouvements(env, organizationId, produitId));
}

export async function handleStockList(
  request: Request,
  env: Env,
  user: AuthUser,
  cors: HeadersInit,
): Promise<Response> {
  const organizationId = user.organization_id;
  const url = new URL(request.url);
  const search = url.searchParams.get('search');
  const categorie = url.searchParams.get('categorie');

  let path = `produits?organization_id=eq.${encodeURIComponent(organizationId)}&actif=eq.1&select=*&order=designation.asc`;
  if (categorie) path += `&categorie=eq.${encodeURIComponent(categorie)}`;
  if (search) {
    // PostgREST or filter
    path = `produits?organization_id=eq.${encodeURIComponent(organizationId)}&actif=eq.1&or=(designation.ilike.*${encodeURIComponent(search)}*,reference.ilike.*${encodeURIComponent(search)}*)&select=*&order=designation.asc`;
    if (categorie) path += `&categorie=eq.${encodeURIComponent(categorie)}`;
  }

  const products = await supabaseRest<Produit[]>(env, path);
  const rows = products.ok && Array.isArray(products.data) ? products.data : [];
  const mouvements = await listMouvements(env, organizationId);
  const byProduct = new Map<string, Mouvement[]>();
  for (const m of mouvements) {
    const list = byProduct.get(m.produit_id) || [];
    list.push(m);
    byProduct.set(m.produit_id, list);
  }
  return json(rows.map((p) => ({
    ...p,
    stock_actuel: sumStock(byProduct.get(p.id) || []),
  })), 200, cors);
}

export async function handleStockCategories(env: Env, user: AuthUser, cors: HeadersInit): Promise<Response> {
  const result = await supabaseRest<Array<{ categorie: string }>>(
    env,
    `produits?organization_id=eq.${encodeURIComponent(user.organization_id)}&categorie=not.is.null&select=categorie&order=categorie.asc`,
  );
  const cats = result.ok && Array.isArray(result.data)
    ? [...new Set(result.data.map((r) => r.categorie).filter(Boolean))].map((categorie) => ({ categorie }))
    : [];
  return json(cats, 200, cors);
}

export async function handleStockStats(env: Env, user: AuthUser, cors: HeadersInit): Promise<Response> {
  const organizationId = user.organization_id;
  const products = await supabaseRest<Produit[]>(
    env,
    `produits?organization_id=eq.${encodeURIComponent(organizationId)}&actif=eq.1&select=*`,
  );
  const rows = products.ok && Array.isArray(products.data) ? products.data : [];
  const mouvements = await listMouvements(env, organizationId);
  const byProduct = new Map<string, Mouvement[]>();
  for (const m of mouvements) {
    const list = byProduct.get(m.produit_id) || [];
    list.push(m);
    byProduct.set(m.produit_id, list);
  }
  let stockFaible = 0;
  let valeur = 0;
  const fournisseurs = new Set<string>();
  for (const p of rows) {
    const stock = sumStock(byProduct.get(p.id) || []);
    if (stock <= Number(p.stock_min || 0)) stockFaible += 1;
    valeur += stock * Number(p.prix_ht || 0);
    if (p.fournisseur) fournisseurs.add(p.fournisseur);
  }
  return json({
    total_produits: rows.length,
    stock_faible: stockFaible,
    valeur_stock: valeur,
    nb_fournisseurs: fournisseurs.size,
  }, 200, cors);
}

export async function handleStockCreate(
  request: Request,
  env: Env,
  user: AuthUser,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'Données invalides' }, 400, cors); }

  const reference = String(body.reference || '').trim();
  const designation = String(body.designation || '').trim();
  if (!reference || !designation) return json({ error: 'Référence et désignation requises' }, 400, cors);

  const existing = await supabaseRest<Array<{ id: string }>>(
    env,
    `produits?organization_id=eq.${encodeURIComponent(user.organization_id)}&reference=eq.${encodeURIComponent(reference)}&select=id&limit=1`,
  );
  if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
    return json({ error: 'Référence déjà existante' }, 400, cors);
  }

  const id = crypto.randomUUID();
  const insert = await supabaseRest(env, 'produits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id,
      organization_id: user.organization_id,
      reference,
      designation,
      categorie: body.categorie ?? null,
      prix_ht: body.prix_ht || 0,
      prix_vente: body.prix_vente || 0,
      tva_rate: body.tva_rate ?? 20,
      unite: body.unite || 'pièce',
      stock_min: body.stock_min || 0,
      stock_max: body.stock_max || 0,
      emplacement: body.emplacement ?? null,
      fournisseur: body.fournisseur ?? null,
      code_barre: body.code_barre ?? null,
      actif: 1,
    }),
  });
  if (!insert.ok) return json({ error: 'Erreur interne' }, 500, cors);
  auditAction('stock.create', user, { produit_id: id, reference });
  return json({ id, reference, designation }, 201, cors);
}

export async function handleStockUpdate(
  request: Request,
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  const current = await findProduct(env, id, user.organization_id);
  if (!current) return json({ error: 'Produit introuvable' }, 404, cors);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'Données invalides' }, 400, cors); }

  const patch = {
    reference: body.reference ?? current.reference,
    designation: body.designation ?? current.designation,
    categorie: body.categorie === undefined ? current.categorie : body.categorie,
    prix_ht: body.prix_ht ?? current.prix_ht,
    prix_vente: body.prix_vente ?? current.prix_vente,
    tva_rate: body.tva_rate ?? current.tva_rate,
    unite: body.unite ?? current.unite,
    stock_min: body.stock_min ?? current.stock_min,
    stock_max: body.stock_max ?? current.stock_max,
    emplacement: body.emplacement === undefined ? current.emplacement : body.emplacement,
    fournisseur: body.fournisseur === undefined ? current.fournisseur : body.fournisseur,
    code_barre: body.code_barre === undefined ? current.code_barre : body.code_barre,
    actif: body.actif ?? current.actif ?? 1,
  };
  const updated = await supabaseRest(
    env,
    `produits?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(user.organization_id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    },
  );
  if (!updated.ok) return json({ error: 'Erreur interne' }, 500, cors);

  if (body.stock_actuel != null) {
    const stockAvant = await currentStock(env, id, user.organization_id);
    const stockApres = Number(body.stock_actuel);
    if (!Number.isFinite(stockApres) || stockApres < 0) {
      return json({ error: 'Quantité invalide' }, 400, cors);
    }
    if (stockApres !== stockAvant) {
      const movement = await supabaseRest(env, 'stock_mouvements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          organization_id: user.organization_id,
          produit_id: id,
          type: 'inventaire',
          quantite: stockApres - stockAvant,
          stock_avant: stockAvant,
          stock_apres: stockApres,
          motif: 'Ajustement stock',
          user_id: user.id,
        }),
      });
      if (!movement.ok) return json({ error: 'Erreur interne' }, 500, cors);
    }
  }
  auditAction('stock.update', user, { produit_id: id });
  return json({ success: true }, 200, cors);
}

export async function handleStockDelete(
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin')) return json({ error: 'Rôle non autorisé' }, 403, cors);
  const current = await findProduct(env, id, user.organization_id);
  if (!current) return json({ error: 'Produit introuvable' }, 404, cors);
  const updated = await supabaseRest(
    env,
    `produits?id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(user.organization_id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ actif: 0 }),
    },
  );
  if (!updated.ok) return json({ error: 'Erreur interne' }, 500, cors);
  auditAction('stock.deactivate', user, { produit_id: id });
  return json({ success: true, deleted: id }, 200, cors);
}

export async function handleStockMouvements(
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  const product = await findProduct(env, id, user.organization_id);
  if (!product) return json({ error: 'Produit introuvable' }, 404, cors);
  const result = await supabaseRest<Mouvement[]>(
    env,
    `stock_mouvements?produit_id=eq.${encodeURIComponent(id)}&organization_id=eq.${encodeURIComponent(user.organization_id)}&select=*&order=created_at.desc&limit=200`,
  );
  return json(result.ok && Array.isArray(result.data) ? result.data : [], 200, cors);
}

export async function handleStockMovement(
  request: Request,
  env: Env,
  user: AuthUser,
  id: string,
  type: 'entree' | 'sortie' | 'inventaire',
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  const product = await findProduct(env, id, user.organization_id);
  if (!product) return json({ error: 'Produit introuvable' }, 404, cors);

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'Données invalides' }, 400, cors); }

  const requested = type === 'inventaire' ? body.quantite_reelle : body.quantite;
  const quantity = Number(requested);
  if (!Number.isFinite(quantity) || quantity < 0 || (type !== 'inventaire' && quantity === 0)) {
    return json({ error: 'Quantité invalide' }, 400, cors);
  }

  // Note: race-safe SQL RPC not deployed yet; sequential read+write for now.
  const before = await currentStock(env, id, user.organization_id);
  if (type === 'sortie' && before < quantity) {
    return json({ error: 'Stock insuffisant' }, 400, cors);
  }
  const after = type === 'entree' ? before + quantity : type === 'sortie' ? before - quantity : quantity;
  const storedQuantity = type === 'inventaire' ? after - before : quantity;
  const movementId = crypto.randomUUID();
  const inserted = await supabaseRest(env, 'stock_mouvements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: movementId,
      organization_id: user.organization_id,
      produit_id: id,
      type,
      quantite: storedQuantity,
      stock_avant: before,
      stock_apres: after,
      motif: body.motif || (type === 'inventaire' ? 'Inventaire' : null),
      user_id: user.id,
      document_id: body.document_id ?? null,
    }),
  });
  if (!inserted.ok) return json({ error: 'Erreur interne' }, 500, cors);
  auditAction(`stock.${type}`, user, { produit_id: id, movement_id: movementId });
  return json({
    id: movementId,
    stock_avant: before,
    stock_apres: after,
    ecart: after - before,
  }, type === 'inventaire' ? 200 : 201, cors);
}
