import type { AuthUser } from './auth';
import { json, supabaseRest } from './http';
import { hasRole } from './permissions';
import { auditAction } from './middleware';

function sanitizeStr(value: unknown, maxLen = 200): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function parsePositiveNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

export async function handleBlList(
  request: Request,
  env: Env,
  user: AuthUser,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  const query = sanitizeStr(new URL(request.url).searchParams.get('recherche') || '', 80).toLowerCase();
  const result = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    `documents?type=ilike.bl&status=not.in.(expedie,expedie_partiel,annule,annulee)&select=id,numero,client_nom,status,date_creation,data_json,created_at&order=created_at.desc&limit=100`,
  );
  const rows = result.ok && Array.isArray(result.data) ? result.data : [];
  const mapped = rows.map((row) => {
    let metadata: Record<string, unknown> = {};
    try { metadata = JSON.parse(String(row.data_json || '{}')); } catch { /* ignore */ }
    return {
      id: row.id,
      numero: row.numero,
      client_nom: row.client_nom || metadata.client_nom || 'Client à préciser',
      chauffeur_livreur: metadata.chauffeur_livreur || metadata.representative || 'À affecter',
      status: row.status,
      date_creation: row.date_creation,
    };
  }).filter((row) => !query || `${row.numero} ${row.client_nom} ${row.chauffeur_livreur}`.toLowerCase().includes(query));
  return json(mapped, 200, cors);
}

export async function handleBlCreate(
  request: Request,
  env: Env,
  user: AuthUser,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'commercial')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return json({ error: 'Données invalides' }, 400, cors); }

  const numero = sanitizeStr(body.numero, 80);
  const clientNom = sanitizeStr(body.client_nom, 180);
  const clientAdresse = sanitizeStr(body.client_adresse, 500);
  const chauffeurLivreur = sanitizeStr(body.chauffeur_livreur, 160);
  const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
  if (!numero || !clientNom || !items.length) {
    return json({ error: 'Numéro du BL, client et au moins une pièce sont requis' }, 400, cors);
  }

  const normalizedItems = [];
  for (const item of items) {
    const reference = sanitizeStr(item.reference, 80);
    const designation = sanitizeStr(item.designation, 250);
    const quantite = Number(item.quantite || 0);
    if (!reference || !designation || !Number.isFinite(quantite) || quantite <= 0 || quantite > 999999) {
      return json({ error: 'Chaque ligne doit contenir une référence, une désignation et une quantité valide' }, 400, cors);
    }
    const product = await supabaseRest<Array<{ id: string }>>(
      env,
      `produits?reference=ilike.${encodeURIComponent(reference)}&actif=eq.1&select=id&limit=1`,
    );
    normalizedItems.push({
      reference,
      designation,
      quantite,
      prix_ht: parsePositiveNumber(item.prix_ht, 0),
      tva_rate: parsePositiveNumber(item.tva_rate, 20),
      produit_id: product.ok && Array.isArray(product.data) && product.data[0] ? product.data[0].id : null,
    });
  }

  const totalHt = normalizedItems.reduce((sum, item) => sum + item.quantite * item.prix_ht, 0);
  const totalTtc = totalHt + normalizedItems.reduce((sum, item) => sum + item.quantite * item.prix_ht * item.tva_rate / 100, 0);
  const metadata = JSON.stringify({
    chauffeur_livreur: chauffeurLivreur,
    representative: chauffeurLivreur,
    origine: 'commercial',
  });

  const existing = await supabaseRest<Array<{ id: string }>>(
    env,
    `documents?numero=eq.${encodeURIComponent(numero)}&type=ilike.bl&select=id&order=created_at.desc&limit=1`,
  );
  const existingId = existing.ok && Array.isArray(existing.data) && existing.data[0] ? existing.data[0].id : null;
  const documentId = existingId || crypto.randomUUID();
  const dateCreation = sanitizeStr(body.date_creation, 30) || new Date().toISOString().slice(0, 10);

  if (existingId) {
    await supabaseRest(env, `documents?id=eq.${encodeURIComponent(documentId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        client_nom: clientNom,
        client_adresse: clientAdresse,
        date_creation: dateCreation,
        status: 'pret_expedition',
        total_ht: totalHt,
        total_ttc: totalTtc,
        data_json: metadata,
        user_id: user.id,
      }),
    });
    await supabaseRest(env, `document_items?document_id=eq.${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
    });
  } else {
    const inserted = await supabaseRest(env, 'documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: documentId,
        type: 'BL',
        numero,
        client_nom: clientNom,
        client_adresse: clientAdresse,
        date_creation: dateCreation,
        status: 'pret_expedition',
        total_ht: totalHt,
        total_ttc: totalTtc,
        user_id: user.id,
        data_json: metadata,
      }),
    });
    if (!inserted.ok) return json({ error: 'Impossible d’enregistrer le bon de livraison' }, 400, cors);
  }

  const itemRows = normalizedItems.map((item) => ({
    id: crypto.randomUUID(),
    document_id: documentId,
    produit_id: item.produit_id,
    designation: item.designation,
    quantite: item.quantite,
    prix_ht: item.prix_ht,
    tva_rate: item.tva_rate,
  }));
  const itemsInsert = await supabaseRest(env, 'document_items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(itemRows),
  });
  if (!itemsInsert.ok) return json({ error: 'Impossible d’enregistrer le bon de livraison' }, 400, cors);

  const magasiners = await supabaseRest<Array<{ id: string }>>(
    env,
    `users?active=eq.1&role=eq.magasinier&select=id`,
  );
  if (magasiners.ok && Array.isArray(magasiners.data)) {
    for (const mag of magasiners.data) {
      await supabaseRest(env, 'notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          user_id: mag.id,
          type: 'bon_livraison',
          title: 'Bon de livraison à expédier',
          message: `BL ${numero} envoyé par le commercial pour ${clientNom}.`,
        }),
      });
    }
  }

  auditAction('warehouse.bl.create', user, { id: documentId, numero });
  return json({ id: documentId, numero, status: 'pret_expedition' }, existingId ? 200 : 201, cors);
}

export async function handleBlGetByNumero(
  env: Env,
  user: AuthUser,
  numero: string,
  cors: HeadersInit,
): Promise<Response> {
  if (!hasRole(user, 'admin', 'magasinier')) {
    return json({ error: 'Rôle non autorisé' }, 403, cors);
  }
  const result = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    `documents?numero=eq.${encodeURIComponent(decodeURIComponent(numero))}&type=ilike.bl&status=not.in.(expedie,expedie_partiel,annule,annulee)&select=*&order=created_at.desc&limit=1`,
  );
  if (!result.ok || !Array.isArray(result.data) || !result.data[0]) {
    return json({ error: 'Bon de livraison introuvable ou déjà expédié' }, 404, cors);
  }
  const order = result.data[0];
  const items = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    `document_items?document_id=eq.${encodeURIComponent(String(order.id))}&select=*,produits(reference,emplacement,poids_unitaire)`,
  );
  let metadata: Record<string, unknown> = {};
  try { metadata = JSON.parse(String(order.data_json || '{}')); } catch { /* ignore */ }
  const mappedItems = (items.ok && Array.isArray(items.data) ? items.data : []).map((item) => {
    const produit = item.produits as { reference?: string; emplacement?: string; poids_unitaire?: number } | null;
    const { produits: _p, ...rest } = item;
    return {
      ...rest,
      reference: produit?.reference || null,
      emplacement: produit?.emplacement || null,
      quantite_attendue: Number(item.quantite || 0),
      poids_unitaire: Number(produit?.poids_unitaire || 0),
    };
  });
  return json({
    id: order.id,
    numero: order.numero,
    client_nom: order.client_nom || metadata.client_nom || 'Client à préciser',
    chauffeur_livreur: metadata.chauffeur_livreur || metadata.representative || 'À affecter',
    items: mappedItems,
  }, 200, cors);
}

export async function handleBlValidate(
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

  const orderResult = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    `documents?id=eq.${encodeURIComponent(id)}&type=ilike.bl&select=*&limit=1`,
  );
  if (!orderResult.ok || !Array.isArray(orderResult.data) || !orderResult.data[0]) {
    return json({ error: 'Bon de livraison introuvable' }, 404, cors);
  }
  const order = orderResult.data[0];
  if (['expedie', 'expedie_partiel', 'annule', 'annulee'].includes(String(order.status))) {
    return json({ error: 'Ce bon de livraison a déjà été traité' }, 400, cors);
  }
  if (!Array.isArray(body.items) || !body.items.length) {
    return json({ error: 'Aucune pièce à expédier' }, 400, cors);
  }

  const orderedItemsResult = await supabaseRest<Array<Record<string, unknown>>>(
    env,
    `document_items?document_id=eq.${encodeURIComponent(String(order.id))}&select=*,produits(reference)`,
  );
  const orderedItems = (orderedItemsResult.ok && Array.isArray(orderedItemsResult.data) ? orderedItemsResult.data : []).map((item) => {
    const produit = item.produits as { reference?: string } | null;
    return {
      id: item.id,
      produit_id: item.produit_id,
      designation: item.designation,
      quantite: item.quantite,
      prix_ht: item.prix_ht,
      tva_rate: item.tva_rate,
      reference: produit?.reference || null,
    };
  });

  const bodyItems = body.items as Array<Record<string, unknown>>;
  const ids = new Set(bodyItems.map((row) => row.item_id));
  const rows = bodyItems
    .map((row) => ({
      ordered: orderedItems.find((item) => String(item.id) === String(row.item_id)),
      shipped: Number(row.quantite_expediee || 0),
      verified: row.verifie === true,
    }))
    .filter((row): row is { ordered: typeof orderedItems[number]; shipped: number; verified: boolean } => Boolean(row.ordered));

  if (
    rows.length !== orderedItems.length
    || ids.size !== rows.length
    || !rows.length
    || rows.some((row) => !Number.isFinite(row.shipped) || row.shipped < 0 || row.shipped > Number(row.ordered.quantite))
  ) {
    return json({ error: 'Les lignes ou quantités expédiées sont invalides' }, 400, cors);
  }
  if (rows.some((row) => row.shipped > 0 && !row.verified)) {
    return json({ error: 'Cochez le contrôle visuel de chaque pièce chargée' }, 400, cors);
  }
  const missing = rows.filter((row) => row.shipped < Number(row.ordered.quantite));
  if (missing.length && !body.confirmer_partiel) {
    const count = missing.reduce((sum, row) => sum + (Number(row.ordered.quantite) - row.shipped), 0);
    return json({ error: `Écart détecté avec le BL : ${count} pièce(s) manquante(s). Confirmez l’expédition partielle.` }, 409, cors);
  }
  if (rows.every((row) => row.shipped === 0)) {
    return json({ error: 'Saisissez au moins une pièce chargée' }, 400, cors);
  }

  const totalHt = rows.reduce((sum, row) => sum + row.shipped * Number(row.ordered.prix_ht || 0), 0);
  const tva = totalHt * 0.2;
  const totalTtc = totalHt + tva;

  try {
    for (const row of rows.filter((r) => r.shipped > 0)) {
      if (!row.ordered.produit_id) {
        throw new Error(`Produit non lié au catalogue : ${row.ordered.designation}`);
      }
      const stockBefore = await stockOf(env, String(row.ordered.produit_id), user.organization_id);
      if (stockBefore < row.shipped) {
        throw new Error(`Stock insuffisant pour ${row.ordered.designation}`);
      }
      const movement = await supabaseRest(env, 'stock_mouvements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          organization_id: user.organization_id,
          produit_id: row.ordered.produit_id,
          type: 'sortie',
          quantite: row.shipped,
          stock_avant: stockBefore,
          stock_apres: stockBefore - row.shipped,
          motif: `Expédition BL ${order.numero}`,
          user_id: user.id,
          document_id: order.id,
        }),
      });
      if (!movement.ok) throw new Error('Écriture stock impossible');
      await supabaseRest(env, 'warehouse_expeditions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          preparation_id: order.id,
          produit_id: row.ordered.produit_id,
          quantite: row.shipped,
          client_nom: order.client_nom || '',
          adresse_livraison: order.client_adresse || '',
          transporteur: '',
          status: 'expediee',
          user_id: user.id,
        }),
      });
    }

    await supabaseRest(env, `documents?id=eq.${encodeURIComponent(String(order.id))}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ status: missing.length ? 'expedie_partiel' : 'expedie' }),
    });

    await supabaseRest(env, 'comptabilite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        type: 'recette',
        categorie: 'Vente marchandises Maroc',
        montant: totalTtc,
        description: `À facturer - BL ${order.numero} : 711100 HT ${totalHt.toFixed(2)} DH, TVA 20% ${tva.toFixed(2)} DH, client 342100`,
        date_operation: new Date().toISOString().slice(0, 10),
        document_id: order.id,
        user_id: user.id,
        compte: '342100',
        rapproche: 0,
      }),
    });

    const accountants = await supabaseRest<Array<{ id: string }>>(
      env,
      `users?active=eq.1&role=eq.comptable&select=id`,
    );
    if (accountants.ok && Array.isArray(accountants.data)) {
      for (const accountant of accountants.data) {
        await supabaseRest(env, 'notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            user_id: accountant.id,
            type: 'expedition',
            title: 'Ordre de facturation à préparer',
            message: `BL ${order.numero} expédié : débit 342100 ${totalTtc.toFixed(2)} DH TTC ; crédit 711100 ${totalHt.toFixed(2)} DH HT ; TVA 20% ${tva.toFixed(2)} DH.`,
          }),
        });
      }
    }
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'Impossible de valider l’expédition',
    }, 400, cors);
  }

  auditAction('warehouse.bl.validate', user, { id: order.id });
  return json({ success: true, partial: missing.length > 0, total_ht: totalHt, total_ttc: totalTtc }, 200, cors);
}
