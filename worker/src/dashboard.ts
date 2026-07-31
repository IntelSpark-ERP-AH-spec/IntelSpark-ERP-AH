import type { AuthUser } from './auth';
import { json, supabaseRest } from './http';

export async function handleDashboard(env: Env, user: AuthUser, cors: HeadersInit): Promise<Response> {
  const organizationId = user.organization_id;

  const [users, produits, docs, mouvements] = await Promise.all([
    supabaseRest<Array<{ id: string }>>(env, 'users?active=eq.1&select=id'),
    supabaseRest<Array<{ id: string; stock_min: number; prix_ht: number }>>(
      env,
      `produits?organization_id=eq.${encodeURIComponent(organizationId)}&select=id,stock_min,prix_ht`,
    ),
    supabaseRest<Array<{ type: string; status: string; total_ttc: number }>>(
      env,
      'documents?select=type,status,total_ttc',
    ),
    supabaseRest<Array<Record<string, unknown>>>(
      env,
      `stock_mouvements?organization_id=eq.${encodeURIComponent(organizationId)}&select=*,produits(designation)&order=created_at.desc&limit=10`,
    ),
  ]);

  const usersCount = users.ok && Array.isArray(users.data) ? users.data.length : 0;
  const productRows = produits.ok && Array.isArray(produits.data) ? produits.data : [];
  const allMvt = await supabaseRest<Array<{ produit_id: string; type: string; quantite: number }>>(
    env,
    `stock_mouvements?organization_id=eq.${encodeURIComponent(organizationId)}&select=produit_id,type,quantite`,
  );
  const mvtRows = allMvt.ok && Array.isArray(allMvt.data) ? allMvt.data : [];
  const stockByProduct = new Map<string, number>();
  for (const m of mvtRows) {
    const prev = stockByProduct.get(m.produit_id) || 0;
    if (m.type === 'entree') stockByProduct.set(m.produit_id, prev + Number(m.quantite || 0));
    else if (m.type === 'sortie') stockByProduct.set(m.produit_id, prev - Number(m.quantite || 0));
    else if (m.type === 'inventaire') stockByProduct.set(m.produit_id, prev + Number(m.quantite || 0));
  }
  const stockFaible = productRows.filter((p) => (stockByProduct.get(p.id) || 0) <= Number(p.stock_min || 0)).length;

  const docRows = docs.ok && Array.isArray(docs.data) ? docs.data : [];
  const docsBrouillon = docRows.filter((d) => d.status === 'brouillon').length;
  const docsValides = docRows.filter((d) => d.status === 'validé' || d.status === 'payé').length;
  const totalFacture = docRows.filter((d) => d.type === 'facture').reduce((s, d) => s + Number(d.total_ttc || 0), 0);
  const totalDevis = docRows.filter((d) => d.type === 'devis').reduce((s, d) => s + Number(d.total_ttc || 0), 0);

  const recent = (mouvements.ok && Array.isArray(mouvements.data) ? mouvements.data : []).map((row) => {
    const produit = row.produits as { designation?: string } | null;
    const { produits: _p, ...rest } = row;
    return { ...rest, designation: produit?.designation || null };
  });

  return json({
    users_count: usersCount,
    produits_count: productRows.length,
    stock_faible: stockFaible,
    docs_brouillon: docsBrouillon,
    docs_valides: docsValides,
    total_facture: totalFacture,
    total_devis: totalDevis,
    recent_mouvements: recent,
    role: user.role,
    department: user.department,
  }, 200, cors);
}
