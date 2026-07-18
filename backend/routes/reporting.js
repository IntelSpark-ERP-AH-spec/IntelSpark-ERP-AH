import { Router } from 'express';
import { dbQuery } from '../db.js';
import { authMiddleware, requireRole, requirePermission } from '../auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/dashboard-complet', requireRole('admin', 'commercial', 'financier'), (req, res) => {
  const ventesPeriode = dbQuery(`SELECT strftime('%Y-%m', date_creation) as mois, COUNT(*) as nb, COALESCE(SUM(total_ttc),0) as total
    FROM documents WHERE status NOT IN ('brouillon','annule') AND date_creation >= date('now', '-12 months')
    GROUP BY mois ORDER BY mois`);

  const topProduits = dbQuery(`SELECT p.designation, p.reference,
    COALESCE(SUM(di.quantite),0) as qte_vendue,
    COALESCE(SUM(di.quantite * di.prix_ht),0) as ca
    FROM document_items di JOIN produits p ON p.id=di.produit_id
    JOIN documents d ON d.id=di.document_id
    WHERE d.type='facture' AND d.status NOT IN ('brouillon','annule')
    GROUP BY p.id ORDER BY ca DESC LIMIT 10`);

  const stockValeur = dbQuery(`SELECT p.categorie,
    SUM(COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END)
    FROM stock_mouvements WHERE produit_id=p.id),0) * p.prix_ht) as valeur
    FROM produits p WHERE p.actif=1 GROUP BY p.categorie`);

  const rhEffectif = dbQuery("SELECT departement, COUNT(*) as nb FROM employes WHERE status='actif' GROUP BY departement");

  const parcVehicules = dbQuery("SELECT type, COUNT(*) as nb FROM vehicules WHERE status='actif' GROUP BY type");

  const maintenanceCouts = dbQuery(`SELECT strftime('%Y-%m', date_fin) as mois, COALESCE(SUM(cout_total),0) as cout
    FROM maintenance_taches WHERE status='terminee' AND date_fin >= date('now', '-12 months')
    GROUP BY mois ORDER BY mois`);

  const tresorerie = dbQuery(`SELECT strftime('%Y-%m', date_operation) as mois,
    COALESCE(SUM(CASE WHEN type='recette' THEN montant ELSE 0 END),0) as recettes,
    COALESCE(SUM(CASE WHEN type='depense' THEN montant ELSE 0 END),0) as depenses
    FROM comptabilite WHERE date_operation >= date('now', '-12 months')
    GROUP BY mois ORDER BY mois`);

  const commandesEnAttente = dbQuery("SELECT COUNT(*) as total FROM commandes_achat WHERE status='en_attente' OR status='validee'")[0].total;
  const atelierEnCours = dbQuery("SELECT COUNT(*) as total FROM atelier_ordres WHERE status='en_cours'")[0].total;

  res.json({
    ventesPeriode, topProduits, stockValeur, rhEffectif,
    parcVehicules, maintenanceCouts, tresorerie,
    commandesEnAttente, atelierEnCours,
  });
});

router.get('/ventes', requireRole('admin', 'commercial', 'financier'), (req, res) => {
  const { debut, fin } = req.query;
  let sql = `SELECT d.*, SUM(di.quantite * di.prix_ht) as total_ligne
    FROM documents d JOIN document_items di ON di.document_id=d.id
    WHERE d.type IN ('facture','devis') AND d.status NOT IN ('brouillon','annule')`;
  const params = [];
  if (debut) { sql += ' AND d.date_creation >= ?'; params.push(debut); }
  if (fin) { sql += ' AND d.date_creation <= ?'; params.push(fin); }
  sql += ' GROUP BY d.id ORDER BY d.date_creation DESC LIMIT 500';
  res.json(dbQuery(sql, params));
});

router.get('/stock-mouvements', requireRole('admin', 'magasinier'), (req, res) => {
  const { debut, fin, type, limit } = req.query;
  let sql = `SELECT sm.*, p.reference, p.designation
    FROM stock_mouvements sm JOIN produits p ON p.id=sm.produit_id WHERE 1=1`;
  const params = [];
  if (debut) { sql += ' AND sm.created_at >= ?'; params.push(debut); }
  if (fin) { sql += ' AND sm.created_at <= ?'; params.push(fin); }
  if (type) { sql += ' AND sm.type = ?'; params.push(type); }
  sql += ' ORDER BY sm.created_at DESC';
  const maxLimit = Math.min(parseInt(limit) || 200, 2000);
  sql += ` LIMIT ${maxLimit}`;
  res.json(dbQuery(sql, params));
});

router.get('/maintenance', requireRole('admin', 'technicien'), (req, res) => {
  const { debut, fin } = req.query;
  let sql = `SELECT mt.*, v.immatriculation, v.marque, v.modele, v.type
    FROM maintenance_taches mt JOIN vehicules v ON v.id=mt.vehicule_id WHERE 1=1`;
  const params = [];
  if (debut) { sql += ' AND mt.created_at >= ?'; params.push(debut); }
  if (fin) { sql += ' AND mt.created_at <= ?'; params.push(fin); }
  sql += ' ORDER BY mt.created_at DESC LIMIT 500';
  res.json(dbQuery(sql, params));
});

router.get('/audit', requireRole('admin'), (req, res) => {
  const { severity, action, limit } = req.query;
  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const params = [];
  if (severity) { sql += ' AND severity = ?'; params.push(severity); }
  if (action) { sql += ' AND action LIKE ?'; params.push(`%${action}%`); }
  sql += ' ORDER BY created_at DESC';
  const maxLimit = Math.min(parseInt(limit) || 100, 1000);
  sql += ` LIMIT ${maxLimit}`;
  res.json(dbQuery(sql, params));
});

export default router;
