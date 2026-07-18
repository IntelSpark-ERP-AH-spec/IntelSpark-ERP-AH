import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, roleMiddleware } from '../auth.js';
import { organizationIdForUser } from '../organization.js';

const router = Router();
router.use(authMiddleware);

const stockSum = `COALESCE(SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END),0)`;
const currentStock = (productId, organizationId) => Number(dbGet(`SELECT ${stockSum} AS stock FROM stock_mouvements WHERE produit_id=? AND organization_id=?`, [productId, organizationId])?.stock || 0);
const findProduct = (id, organizationId) => dbGet('SELECT * FROM produits WHERE id=? AND organization_id=?', [id, organizationId]);

router.get('/', (req, res) => {
  const organizationId = organizationIdForUser(req.user);
  const { search, categorie } = req.query;
  let sql = `SELECT p.*, COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id AND organization_id=p.organization_id), 0) AS stock_actuel FROM produits p WHERE p.actif=1 AND p.organization_id=?`;
  const params = [organizationId];
  if (search) { sql += ' AND (p.designation LIKE ? OR p.reference LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (categorie) { sql += ' AND p.categorie = ?'; params.push(categorie); }
  sql += ' ORDER BY p.designation';
  res.json(dbQuery(sql, params));
});

router.get('/categories', (req, res) => res.json(dbQuery(
  'SELECT DISTINCT categorie FROM produits WHERE organization_id=? AND categorie IS NOT NULL ORDER BY categorie',
  [organizationIdForUser(req.user)],
)));

router.get('/stats/global', (req, res) => {
  const organizationId = organizationIdForUser(req.user);
  const total_produits = dbGet('SELECT COUNT(*) AS total FROM produits WHERE actif=1 AND organization_id=?', [organizationId]).total;
  const stock_faible = dbGet(`SELECT COUNT(*) AS total FROM produits p WHERE actif=1 AND organization_id=? AND COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id AND organization_id=p.organization_id),0) <= p.stock_min`, [organizationId]).total;
  const valeur_stock = dbGet(`SELECT COALESCE(SUM(COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id AND organization_id=p.organization_id),0) * p.prix_ht),0) AS total FROM produits p WHERE actif=1 AND organization_id=?`, [organizationId]).total;
  const nb_fournisseurs = dbGet('SELECT COUNT(DISTINCT fournisseur) AS total FROM produits WHERE fournisseur IS NOT NULL AND actif=1 AND organization_id=?', [organizationId]).total;
  res.json({ total_produits, stock_faible, valeur_stock, nb_fournisseurs });
});

router.get('/export/csv', (req, res) => {
  const organizationId = organizationIdForUser(req.user);
  const produits = dbQuery(`SELECT p.*, COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id AND organization_id=p.organization_id),0) AS stock_actuel FROM produits p WHERE actif=1 AND organization_id=? ORDER BY p.designation`, [organizationId]);
  const header = 'Référence;Désignation;Catégorie;Fournisseur;Stock;Min;Max;Emplacement;Prix HT;Prix Vente;Valeur\n';
  const rows = produits.map(p => `${p.reference};${p.designation};${p.categorie || ''};${p.fournisseur || ''};${p.stock_actuel || 0};${p.stock_min || 0};${p.stock_max || 0};${p.emplacement || ''};${Number(p.prix_ht).toFixed(2)};${Number(p.prix_vente || 0).toFixed(2)};${Number((p.stock_actuel || 0) * p.prix_ht).toFixed(2)}`).join('\n');
  res.setHeader('Content-Type', 'text/csv;charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment;filename=stock.csv');
  res.send('\uFEFF' + header + rows);
});

router.get('/:id', (req, res) => {
  const organizationId = organizationIdForUser(req.user);
  const produit = dbGet(`SELECT p.*, COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id AND organization_id=p.organization_id),0) AS stock_actuel FROM produits p WHERE p.id=? AND p.organization_id=?`, [req.params.id, organizationId]);
  if (!produit) return res.status(404).json({ error: 'Produit introuvable' });
  res.json(produit);
});

router.post('/', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const organizationId = organizationIdForUser(req.user);
  const { reference, designation, categorie, prix_ht, prix_vente, tva_rate, unite, stock_min, stock_max, emplacement, fournisseur, code_barre } = req.body;
  if (!reference || !designation) return res.status(400).json({ error: 'Référence et désignation requises' });
  if (dbGet('SELECT id FROM produits WHERE organization_id=? AND reference=?', [organizationId, reference])) return res.status(400).json({ error: 'Référence déjà existante' });
  const id = uuidv4();
  dbRun(`INSERT INTO produits (id,organization_id,reference,designation,categorie,prix_ht,prix_vente,tva_rate,unite,stock_min,stock_max,emplacement,fournisseur,code_barre) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, organizationId, reference, designation, categorie || null, prix_ht || 0, prix_vente || 0, tva_rate ?? 20, unite || 'pièce', stock_min || 0, stock_max || 0, emplacement || null, fournisseur || null, code_barre || null]);
  res.status(201).json({ id, reference, designation });
});

router.put('/:id', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const organizationId = organizationIdForUser(req.user);
  const current = findProduct(req.params.id, organizationId);
  if (!current) return res.status(404).json({ error: 'Produit introuvable' });
  const next = { ...current, ...req.body };
  const { reference, designation, categorie, prix_ht, prix_vente, tva_rate, unite, stock_min, stock_max, emplacement, fournisseur, code_barre, actif } = next;
  dbRun(`UPDATE produits SET reference=?,designation=?,categorie=?,prix_ht=?,prix_vente=?,tva_rate=?,unite=?,stock_min=?,stock_max=?,emplacement=?,fournisseur=?,code_barre=?,actif=? WHERE id=? AND organization_id=?`, [reference, designation, categorie, prix_ht, prix_vente, tva_rate, unite, stock_min, stock_max, emplacement, fournisseur, code_barre, actif ?? 1, req.params.id, organizationId]);
  if (req.body.stock_actuel != null) {
    const stockAvant = currentStock(req.params.id, organizationId);
    const stockApres = Number(req.body.stock_actuel);
    if (!Number.isFinite(stockApres) || stockApres < 0) return res.status(400).json({ error: 'Quantité invalide' });
    if (stockApres !== stockAvant) dbRun('INSERT INTO stock_mouvements (id,organization_id,produit_id,type,quantite,stock_avant,stock_apres,motif,user_id) VALUES (?,?,?,?,?,?,?,?,?)', [uuidv4(), organizationId, req.params.id, 'inventaire', stockApres - stockAvant, stockAvant, stockApres, 'Ajustement stock', req.user.id]);
  }
  res.json({ success: true });
});

router.delete('/:id', roleMiddleware('admin'), (req, res) => {
  const organizationId = organizationIdForUser(req.user);
  if (!findProduct(req.params.id, organizationId)) return res.status(404).json({ error: 'Produit introuvable' });
  dbRun('UPDATE produits SET actif=0 WHERE id=? AND organization_id=?', [req.params.id, organizationId]);
  res.json({ success: true, deleted: req.params.id });
});

router.get('/:id/mouvements', (req, res) => res.json(dbQuery(
  'SELECT * FROM stock_mouvements WHERE produit_id=? AND organization_id=? ORDER BY created_at DESC LIMIT 200',
  [req.params.id, organizationIdForUser(req.user)],
)));

function movementHandler(type) {
  return (req, res) => {
    const organizationId = organizationIdForUser(req.user);
    const product = findProduct(req.params.id, organizationId);
    if (!product) return res.status(404).json({ error: 'Produit introuvable' });
    const requested = type === 'inventaire' ? req.body.quantite_reelle : req.body.quantite;
    const quantity = Number(requested);
    if (!Number.isFinite(quantity) || quantity < 0 || (type !== 'inventaire' && quantity === 0)) return res.status(400).json({ error: 'Quantité invalide' });
    const before = currentStock(req.params.id, organizationId);
    if (type === 'sortie' && before < quantity) return res.status(400).json({ error: 'Stock insuffisant' });
    const after = type === 'entree' ? before + quantity : type === 'sortie' ? before - quantity : quantity;
    const storedQuantity = type === 'inventaire' ? after - before : quantity;
    const id = uuidv4();
    dbRun('INSERT INTO stock_mouvements (id,organization_id,produit_id,type,quantite,stock_avant,stock_apres,motif,user_id) VALUES (?,?,?,?,?,?,?,?,?)', [id, organizationId, req.params.id, type, storedQuantity, before, after, req.body.motif || (type === 'inventaire' ? 'Inventaire' : null), req.user.id]);
    res.status(type === 'inventaire' ? 200 : 201).json({ id, stock_avant: before, stock_apres: after, ecart: after - before });
  };
}

router.post('/:id/entree', roleMiddleware('admin', 'magasinier'), movementHandler('entree'));
router.post('/:id/sortie', roleMiddleware('admin', 'magasinier'), movementHandler('sortie'));
router.post('/:id/inventaire', roleMiddleware('admin', 'magasinier'), movementHandler('inventaire'));

export default router;
