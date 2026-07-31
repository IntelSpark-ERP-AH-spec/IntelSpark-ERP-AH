import type { AuthUser } from './auth';
import { json, supabaseRest } from './http';
import { hasRole } from './permissions';
import { auditAction } from './middleware';

function sanitizeStr(value: unknown, maxLen = 200): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

async function stockOf(env: Env, produitId: string, organizationId?: string): Promise<number> {
  let path = `stock_mouvements?produit_id=eq.${encodeURIComponent(produitId)}&select=type,quantite`;
  if (organizationId) path += `&organization_id=eq.${encodeURIComponent(organizationId)}`;
  const result = await supabaseRest<Array<{ type: string; quantite: number }>>(env, path);
  const rows = result.ok && Array.isArray(result.data) ? result.data : [];
  let stock = 0;
  for (const row of rows) {
    if (row.type === 'entree') stock += Number(row.quantite || 0);
    else if (row.type === 'sortie') stock -= Number(row.quantite || 0);
  }
  return stock;
}

export async function handleReceptionsList(env: Env, user: AuthUser, cors: HeadersInit): Promise<Response> {
  if (!hasRole(user, 'admin', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  const result = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    'warehouse_receptions?select=*,produits(reference,designation)&order=created_at.desc',
  );
  const rows = (result.ok && Array.isArray(result.data) ? result.data : []).map((row) => {
    const produit = row.produits as { reference?: string; designation?: string } | null;
    const { produits: _p, ...rest } = row;
    return {
      ...rest,
      reference: produit?.reference || null,
      designation: produit?.designation || null,
    };
  });
  return json(rows, 200, cors);
}

export async function handleReceptionCreate(
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

  if (Array.isArray(body.items)) {
    const supplier = sanitizeStr(body.fournisseur_nom || body.fournisseur, 160);
    const deliveryNote = sanitizeStr(body.num_bl || body.bon_livraison, 120);
    const items = (body.items as Array<Record<string, unknown>>).map((item) => ({
      produit_id: item.produit_id,
      quantite: Number(item.quantite_recue || 0),
      item_id: item.item_id,
      emplacement: sanitizeStr(item.emplacement, 100),
    })).filter((item) => item.quantite > 0);

    if (!deliveryNote || !items.length) {
      return json({ error: 'Bon de livraison et au moins une pièce reçue sont requis' }, 400, cors);
    }
    if (items.some((item) => !item.produit_id || !Number.isFinite(item.quantite))) {
      return json({ error: 'Chaque pièce reçue doit être liée au catalogue' }, 400, cors);
    }

    try {
      for (const item of items) {
        const product = await supabaseRest<Array<{ id: string; emplacement: string | null }>>(
          env,
          `produits?id=eq.${encodeURIComponent(String(item.produit_id))}&actif=eq.1&select=id,emplacement&limit=1`,
        );
        if (!product.ok || !Array.isArray(product.data) || !product.data[0]) {
          throw new Error('Produit introuvable dans le catalogue');
        }
        const stockBefore = await stockOf(env, String(item.produit_id), user.organization_id);
        const movement = await supabaseRest(env, 'stock_mouvements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            organization_id: user.organization_id,
            produit_id: item.produit_id,
            type: 'entree',
            quantite: item.quantite,
            stock_avant: stockBefore,
            stock_apres: stockBefore + item.quantite,
            motif: `Réception BL ${deliveryNote}`,
            user_id: user.id,
          }),
        });
        if (!movement.ok) throw new Error('Impossible de mettre le stock à jour');

        const reception = await supabaseRest(env, 'warehouse_receptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            produit_id: item.produit_id,
            quantite_recue: item.quantite,
            fournisseur: supplier,
            emplacement: item.emplacement || product.data[0].emplacement || null,
            bon_livraison: deliveryNote,
            user_id: user.id,
          }),
        });
        if (!reception.ok) throw new Error('Impossible d’enregistrer la réception');

        const commandeId = body.commande_id ? String(body.commande_id) : '';
        if (commandeId && item.item_id) {
          const commandItem = await supabaseRest<Array<{ quantite_recue: number }>>(
            env,
            `commandes_achat_items?id=eq.${encodeURIComponent(String(item.item_id))}&commande_id=eq.${encodeURIComponent(commandeId)}&select=quantite_recue&limit=1`,
          );
          if (commandItem.ok && Array.isArray(commandItem.data) && commandItem.data[0]) {
            await supabaseRest(
              env,
              `commandes_achat_items?id=eq.${encodeURIComponent(String(item.item_id))}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({
                  quantite_recue: Number(commandItem.data[0].quantite_recue || 0) + item.quantite,
                }),
              },
            );
          }
        }
      }

      const commandeId = body.commande_id ? String(body.commande_id) : '';
      if (commandeId) {
        const commandItems = await supabaseRest<Array<{ quantite_commandee: number; quantite_recue: number }>>(
          env,
          `commandes_achat_items?commande_id=eq.${encodeURIComponent(commandeId)}&select=quantite_commandee,quantite_recue`,
        );
        if (commandItems.ok && Array.isArray(commandItems.data) && commandItems.data.length) {
          const fullyReceived = commandItems.data.every(
            (item) => Number(item.quantite_recue) >= Number(item.quantite_commandee),
          );
          const partiallyReceived = commandItems.data.some((item) => Number(item.quantite_recue) > 0);
          await supabaseRest(env, `commandes_achat?id=eq.${encodeURIComponent(commandeId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
            body: JSON.stringify({
              status: fullyReceived ? 'livree' : partiallyReceived ? 'livree_partielle' : 'en_attente',
            }),
          });
        }
      }
    } catch (error) {
      return json({
        error: error instanceof Error ? error.message : 'Impossible de mettre le stock à jour',
      }, 400, cors);
    }

    auditAction('warehouse.reception.create_batch', user, { pieces: items.length });
    return json({ success: true, pieces_entrees: items.length }, 201, cors);
  }

  const produitId = body.produit_id;
  const qty = Number(body.quantite_recue);
  if (!produitId || !body.quantite_recue) {
    return json({ error: 'produit_id et quantite_recue requis' }, 400, cors);
  }
  if (!Number.isFinite(qty) || qty <= 0 || qty > 999999) {
    return json({ error: 'Quantité invalide' }, 400, cors);
  }
  const id = crypto.randomUUID();
  const inserted = await supabaseRest(env, 'warehouse_receptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id,
      produit_id: produitId,
      quantite_recue: qty,
      fournisseur: sanitizeStr(body.fournisseur),
      emplacement: sanitizeStr(body.emplacement),
      bon_livraison: sanitizeStr(body.bon_livraison),
      user_id: user.id,
    }),
  });
  if (!inserted.ok) return json({ error: 'Erreur interne' }, 500, cors);
  auditAction('warehouse.reception.create', user, { id });
  return json({ id, success: true }, 200, cors);
}

export async function handleReceptionDelete(
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin')) return json({ error: 'Rôle non autorisé' }, 403, cors);
  const deleted = await supabaseRest(env, `warehouse_receptions?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  if (!deleted.ok || (Array.isArray(deleted.data) && deleted.data.length === 0)) {
    return json({ error: 'Réception introuvable' }, 404, cors);
  }
  auditAction('warehouse.reception.delete', user, { id });
  return json({ success: true }, 200, cors);
}

const VALID_PREP_STATUSES = ['brouillon', 'prete', 'expediee', 'annulee'];

export async function handlePreparationsList(env: Env, user: AuthUser, cors: HeadersInit): Promise<Response> {
  if (!hasRole(user, 'admin', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  const result = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    'warehouse_preparations?select=*,produits(reference,designation)&order=created_at.desc',
  );
  const rows = (result.ok && Array.isArray(result.data) ? result.data : []).map((row) => {
    const produit = row.produits as { reference?: string; designation?: string } | null;
    const { produits: _p, ...rest } = row;
    return {
      ...rest,
      reference: produit?.reference || row.reference || null,
      designation: produit?.designation || null,
    };
  });
  return json(rows, 200, cors);
}

export async function handlePreparationCreate(
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
  if (!body.produit_id || !body.quantite) {
    return json({ error: 'produit_id et quantite requis' }, 400, cors);
  }
  const qty = Number(body.quantite);
  if (!Number.isFinite(qty) || qty <= 0 || qty > 999999) {
    return json({ error: 'Quantité invalide' }, 400, cors);
  }
  const id = crypto.randomUUID();
  const inserted = await supabaseRest(env, 'warehouse_preparations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id,
      reference: sanitizeStr(body.reference),
      produit_id: body.produit_id,
      quantite: qty,
      destination: sanitizeStr(body.destination),
      user_id: user.id,
      status: 'brouillon',
    }),
  });
  if (!inserted.ok) return json({ error: 'Erreur interne' }, 500, cors);
  return json({ id, success: true }, 200, cors);
}

export async function handlePreparationUpdate(
  request: Request,
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'Données invalides' }, 400, cors); }
  const status = String(body.status || '');
  if (!VALID_PREP_STATUSES.includes(status)) {
    return json({ error: 'Statut invalide' }, 400, cors);
  }
  const updated = await supabaseRest(env, `warehouse_preparations?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status }),
  });
  if (!updated.ok) return json({ error: 'Erreur interne' }, 500, cors);
  return json({ success: true }, 200, cors);
}

export async function handlePreparationDelete(
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin')) return json({ error: 'Rôle non autorisé' }, 403, cors);
  await supabaseRest(env, `warehouse_preparations?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return json({ success: true }, 200, cors);
}

export async function handleExpeditionsList(env: Env, user: AuthUser, cors: HeadersInit): Promise<Response> {
  if (!hasRole(user, 'admin', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  const result = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    'warehouse_expeditions?select=*&order=created_at.desc',
  );
  return json(result.ok && Array.isArray(result.data) ? result.data : [], 200, cors);
}

export async function handleExpeditionCreate(
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
  const id = crypto.randomUUID();
  const inserted = await supabaseRest(env, 'warehouse_expeditions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({
      id,
      preparation_id: body.preparation_id || null,
      produit_id: body.produit_id,
      quantite: Number(body.quantite || 0),
      client_nom: sanitizeStr(body.client_nom),
      adresse_livraison: sanitizeStr(body.adresse_livraison),
      transporteur: sanitizeStr(body.transporteur),
      status: body.status || 'en_cours',
      user_id: user.id,
    }),
  });
  if (!inserted.ok) return json({ error: 'Erreur interne' }, 500, cors);
  return json({ id, success: true }, 200, cors);
}

export async function handleExpeditionUpdate(
  request: Request,
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'Données invalides' }, 400, cors); }
  const updated = await supabaseRest(env, `warehouse_expeditions?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ status: body.status }),
  });
  if (!updated.ok) return json({ error: 'Erreur interne' }, 500, cors);
  return json({ success: true }, 200, cors);
}

export async function handleExpeditionDelete(
  env: Env,
  user: AuthUser,
  id: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin')) return json({ error: 'Rôle non autorisé' }, 403, cors);
  await supabaseRest(env, `warehouse_expeditions?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return json({ success: true }, 200, cors);
}
