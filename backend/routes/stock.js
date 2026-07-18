import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, roleMiddleware } from '../auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const { search, categorie } = req.query;
  let sql = `SELECT p.*, 
    COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id), 0) as stock_actuel
    FROM produits p WHERE p.actif=1`;
  const params = [];
  if (search) { sql += ' AND (p.designation LIKE ? OR p.reference LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (categorie) { sql += ' AND p.categorie = ?'; params.push(categorie); }
  sql += ' ORDER BY p.designation';
  res.json(dbQuery(sql, params));
});

router.get('/categories', (req, res) => {
  res.json(dbQuery('SELECT DISTINCT categorie FROM produits WHERE categorie IS NOT NULL ORDER BY categorie'));
});

router.get('/:id', (req, res) => {
  const produit = dbGet(`SELECT p.*,
    COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id), 0) as stock_actuel
    FROM produits p WHERE p.id=?`, [req.params.id]);
  if (!produit) return res.status(404).json({ error: 'Produit introuvable' });
  res.json(produit);
});

router.post('/', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const { reference, designation, categorie, prix_ht, prix_vente, tva_rate, unite, stock_min, stock_max, emplacement, fournisseur, code_barre } = req.body;
  if (!reference || !designation) return res.status(400).json({ error: 'reference et designation requis' });
  const existing = dbGet('SELECT id FROM produits WHERE reference = ?', [reference]);
  if (existing) return res.status(400).json({ error: 'Référence déjà existante' });
  const id = uuidv4();
  dbRun(`INSERT INTO produits (id,reference,designation,categorie,prix_ht,prix_vente,tva_rate,unite,stock_min,stock_max,emplacement,fournisseur,code_barre) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, reference, designation, categorie || null, prix_ht || 0, prix_vente || 0, tva_rate ?? 20, unite || 'pièce', stock_min || 0, stock_max || 0, emplacement || null, fournisseur || null, code_barre || null]);
  res.status(201).json({ id, reference, designation });
});

router.put('/:id', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const current = dbGet('SELECT * FROM produits WHERE id=?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Produit introuvable' });
  const next = { ...current, ...req.body };
  const { reference, designation, categorie, prix_ht, prix_vente, tva_rate, unite, stock_min, stock_max, emplacement, fournisseur, code_barre, actif } = next;
  dbRun(`UPDATE produits SET reference=?,designation=?,categorie=?,prix_ht=?,prix_vente=?,tva_rate=?,unite=?,stock_min=?,stock_max=?,emplacement=?,fournisseur=?,code_barre=?,actif=? WHERE id=?`,
    [reference, designation, categorie, prix_ht, prix_vente, tva_rate, unite, stock_min, stock_max, emplacement, fournisseur, code_barre, actif ?? 1, req.params.id]);
  if (req.body.stock_actuel != null) {
    const stockAvant = Number(dbGet(`SELECT COALESCE(SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END),0) as stock FROM stock_mouvements WHERE produit_id=?`, [req.params.id]).stock || 0);
    const stockApres = Number(req.body.stock_actuel);
    if (!Number.isFinite(stockApres) || stockApres < 0) return res.status(400).json({ error: 'Quantité de stock invalide' });
    if (stockApres !== stockAvant) {
      dbRun('INSERT INTO stock_mouvements (id,produit_id,type,quantite,stock_avant,stock_apres,motif,user_id) VALUES (?,?,?,?,?,?,?,?)',
        [uuidv4(), req.params.id, 'inventaire', stockApres - stockAvant, stockAvant, stockApres, 'Ajustement depuis stockage', req.user.id]);
    }
  }
  res.json({ success: true });
});

router.delete('/:id', roleMiddleware('admin'), (req, res) => {
  const produit = dbGet('SELECT id, actif FROM produits WHERE id=?', [req.params.id]);
  if (!produit) return res.status(404).json({ error: 'Produit introuvable' });
  dbRun('UPDATE produits SET actif=0 WHERE id=?', [req.params.id]);
  res.json({ success: true, deleted: req.params.id });
});

router.get('/:id/mouvements', (req, res) => {
  const mvt = dbQuery('SELECT * FROM stock_mouvements WHERE produit_id=? ORDER BY created_at DESC LIMIT 200', [req.params.id]);
  res.json(mvt);
});

router.post('/:id/entree', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const { quantite, motif } = req.body;
  if (!quantite || quantite <= 0) return res.status(400).json({ error: 'Quantité invalide' });
  const produit = dbGet('SELECT id FROM produits WHERE id=?', [req.params.id]);
  if (!produit) return res.status(404).json({ error: 'Produit introuvable' });
  const stockAvant = Number(dbGet(`SELECT COALESCE(SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END),0) as stock FROM stock_mouvements WHERE produit_id=?`, [req.params.id]).stock || 0);
  const id = uuidv4();
  dbRun('INSERT INTO stock_mouvements (id,produit_id,type,quantite,stock_avant,stock_apres,motif,user_id) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.params.id, 'entree', quantite, stockAvant, stockAvant + quantite, motif || null, req.user.id]);
  res.status(201).json({ id, stock_apres: stockAvant + quantite });
});

router.post('/:id/sortie', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const { quantite, motif } = req.body;
  if (!quantite || quantite <= 0) return res.status(400).json({ error: 'Quantité invalide' });
  const produit = dbGet('SELECT id FROM produits WHERE id=?', [req.params.id]);
  if (!produit) return res.status(404).json({ error: 'Produit introuvable' });
  const stockAvant = Number(dbGet(`SELECT COALESCE(SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END),0) as stock FROM stock_mouvements WHERE produit_id=?`, [req.params.id]).stock || 0);
  if (stockAvant < quantite) return res.status(400).json({ error: 'Stock insuffisant' });
  const id = uuidv4();
  dbRun('INSERT INTO stock_mouvements (id,produit_id,type,quantite,stock_avant,stock_apres,motif,user_id) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.params.id, 'sortie', quantite, stockAvant, stockAvant - quantite, motif || null, req.user.id]);
  res.status(201).json({ id, stock_apres: stockAvant - quantite });
});

router.post('/:id/inventaire', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const { quantite_reelle, motif } = req.body;
  if (quantite_reelle == null) return res.status(400).json({ error: 'Quantité réelle requise' });
  const stockAvant = Number(dbGet(`SELECT COALESCE(SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END),0) as stock FROM stock_mouvements WHERE produit_id=?`, [req.params.id]).stock || 0);
  const ecart = quantite_reelle - stockAvant;
  const id = uuidv4();
  dbRun('INSERT INTO stock_mouvements (id,produit_id,type,quantite,stock_avant,stock_apres,motif,user_id) VALUES (?,?,?,?,?,?,?,?)',
    [id, req.params.id, 'inventaire', ecart, stockAvant, quantite_reelle, motif || 'Inventaire', req.user.id]);
  res.json({ id, stock_avant: stockAvant, stock_apres: quantite_reelle, ecart });
});

router.get('/stats/global', (req, res) => {
  const total_produits = dbQuery('SELECT COUNT(*) as total FROM produits WHERE actif=1')[0].total;
  const stock_faible = dbQuery(`SELECT COUNT(*) as total FROM produits p WHERE actif=1 AND
    COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id),0) <= p.stock_min`)[0].total;
  const valeur_stock = dbQuery(`SELECT COALESCE(SUM(
    (COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id),0)) * p.prix_ht
  ),0) as total FROM produits p WHERE actif=1`)[0].total;
  const nb_fournisseurs = dbQuery('SELECT COUNT(DISTINCT fournisseur) as total FROM produits WHERE fournisseur IS NOT NULL AND actif=1')[0].total;
  res.json({ total_produits, stock_faible, valeur_stock, nb_fournisseurs });
});

router.get('/export/csv', (req, res) => {
  const produits = dbQuery(`SELECT p.*,
    COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id),0) as stock_actuel
    FROM produits p WHERE actif=1 ORDER BY p.designation`);
  const header = 'Référence;Désignation;Catégorie;Fournisseur;Stock;Min;Max;Emplacement;Prix HT;Prix Vente;Valeur\n';
  const rows = produits.map(p =>
    `${p.reference};${p.designation};${p.categorie||''};${p.fournisseur||''};${p.stock_actuel||0};${p.stock_min||0};${p.stock_max||0};${p.emplacement||''};${Number(p.prix_ht).toFixed(2)};${Number(p.prix_vente||0).toFixed(2)};${Number((p.stock_actuel||0)*p.prix_ht).toFixed(2)}`
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv;charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment;filename=stock.csv');
  res.send('\uFEFF' + header + rows);
});

export default router;
