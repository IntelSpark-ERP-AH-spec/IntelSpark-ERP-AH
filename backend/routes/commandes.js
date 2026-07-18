import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun, dbTransaction } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';

const router = Router();
router.use(authMiddleware);

const COUNTER_KEY = 'commande_counter';

function nextNumero() {
  const row = dbGet(`SELECT value FROM user_data WHERE key=? AND user_id='_system'`, [COUNTER_KEY]);
  const next = (row ? parseInt(row.value) || 0 : 0) + 1;
  if (row) {
    dbRun(`UPDATE user_data SET value=? WHERE key=? AND user_id='_system'`, [String(next), COUNTER_KEY]);
  } else {
    dbRun(`INSERT INTO user_data (id, user_id, key, value) VALUES (?, '_system', ?, ?)`, [uuidv4(), COUNTER_KEY, String(next)]);
  }
  return `CMD-${String(next).padStart(5, '0')}`;
}

router.get('/', (req, res) => {
  const { status, fournisseur_id } = req.query;
  let sql = `SELECT ca.*, f.nom as fournisseur_nom
    FROM commandes_achat ca JOIN fournisseurs f ON f.id = ca.fournisseur_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND ca.status = ?'; params.push(status); }
  if (fournisseur_id) { sql += ' AND ca.fournisseur_id = ?'; params.push(fournisseur_id); }
  sql += ' ORDER BY ca.created_at DESC';
  res.json(dbQuery(sql, params));
});

router.get('/stats', (req, res) => {
  const total = dbQuery('SELECT COUNT(*) as total FROM commandes_achat')[0].total;
  const enAttente = dbQuery("SELECT COUNT(*) as total FROM commandes_achat WHERE status='en_attente'")[0].total;
  const enCours = dbQuery("SELECT COUNT(*) as total FROM commandes_achat WHERE status='validee' OR status='livree_partielle'")[0].total;
  const totalHt = dbQuery("SELECT COALESCE(SUM(total_ht),0) as total FROM commandes_achat WHERE status != 'annulee'")[0].total;
  res.json({ total, enAttente, enCours, totalHt });
});

router.get('/:id', (req, res) => {
  const cmd = dbGet(`SELECT ca.*, f.nom as fournisseur_nom, f.email as fournisseur_email, f.telephone as fournisseur_telephone
    FROM commandes_achat ca JOIN fournisseurs f ON f.id = ca.fournisseur_id WHERE ca.id=?`, [req.params.id]);
  if (!cmd) return res.status(404).json({ error: 'Commande introuvable' });
  cmd.items = dbQuery(`SELECT cai.*, p.reference, p.designation as produit_designation
    FROM commandes_achat_items cai LEFT JOIN produits p ON p.id = cai.produit_id WHERE cai.commande_id=?`, [req.params.id]);
  res.json(cmd);
});

router.post('/', requireRole('admin', 'commercial', 'magasinier'), (req, res) => {
  const { fournisseur_id, date_livraison_prevue, notes, items } = req.body;
  if (!fournisseur_id) return res.status(400).json({ error: 'fournisseur_id requis' });
  if (!items || !items.length) return res.status(400).json({ error: 'Au moins un article requis' });

  const id = uuidv4();
  const numero = nextNumero();
  let totalHt = 0;
  let totalTtc = 0;

  const itemIds = [];
  for (const item of items) {
    const itemId = uuidv4();
    const prixHt = item.prix_unitaire_ht || 0;
    const tva = item.tva_rate || 20;
    const qte = item.quantite_commandee || 1;
    totalHt += prixHt * qte;
    totalTtc += prixHt * qte * (1 + tva / 100);
    itemIds.push({ id: itemId, ...item });
  }

  dbRun(`INSERT INTO commandes_achat (id, numero, fournisseur_id, date_livraison_prevue, total_ht, total_ttc, notes, user_id)
    VALUES (?,?,?,?,?,?,?,?)`,
    [id, numero, fournisseur_id, date_livraison_prevue || null, totalHt, totalTtc, notes || null, req.user.id]);

  for (const item of itemIds) {
    dbRun(`INSERT INTO commandes_achat_items (id, commande_id, produit_id, designation, quantite_commandee, prix_unitaire_ht, tva_rate)
      VALUES (?,?,?,?,?,?,?)`,
      [item.id, id, item.produit_id || null, item.designation, item.quantite_commandee, item.prix_unitaire_ht || 0, item.tva_rate || 20]);
  }

  res.status(201).json({ id, numero, total_ht: totalHt, total_ttc: totalTtc });
});

router.put('/:id', requireRole('admin', 'commercial', 'magasinier'), (req, res) => {
  const { status, date_livraison_prevue, notes } = req.body;
  dbRun('UPDATE commandes_achat SET status=?, date_livraison_prevue=?, notes=? WHERE id=?',
    [status, date_livraison_prevue, notes, req.params.id]);
  res.json({ success: true });
});

router.post('/:id/reception', requireRole('admin', 'magasinier'), (req, res) => {
  const { items } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'Au moins un article requis' });

  for (const item of items) {
    const cmdItem = dbGet('SELECT * FROM commandes_achat_items WHERE id=? AND commande_id=?', [item.item_id, req.params.id]);
    if (!cmdItem) continue;
    const qtyRecue = (cmdItem.quantite_recue || 0) + (item.quantite_recue || 0);
    dbRun('UPDATE commandes_achat_items SET quantite_recue=? WHERE id=?', [qtyRecue, item.item_id]);

    if (cmdItem.produit_id && item.quantite_recue > 0) {
      const stockAvant = dbGet(`SELECT COALESCE(SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END),0) as stock
        FROM stock_mouvements WHERE produit_id=?`, [cmdItem.produit_id]).stock;
      const mvtId = uuidv4();
      dbRun('INSERT INTO stock_mouvements (id, produit_id, type, quantite, stock_avant, stock_apres, motif, user_id) VALUES (?,?,?,?,?,?,?,?)',
        [mvtId, cmdItem.produit_id, 'entree', item.quantite_recue, stockAvant, stockAvant + item.quantite_recue, `Réception commande ${req.params.id}`, req.user.id]);
    }
  }

  const allItems = dbQuery('SELECT * FROM commandes_achat_items WHERE commande_id=?', [req.params.id]);
  const totalRecu = allItems.every(i => i.quantite_recue >= i.quantite_commandee);
  const partiel = allItems.some(i => i.quantite_recue > 0);
  if (totalRecu) {
    dbRun("UPDATE commandes_achat SET status='livree' WHERE id=?", [req.params.id]);
  } else if (partiel) {
    dbRun("UPDATE commandes_achat SET status='livree_partielle' WHERE id=?", [req.params.id]);
  }
  res.json({ success: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  dbRun('DELETE FROM commandes_achat_items WHERE commande_id=?', [req.params.id]);
  dbRun('DELETE FROM commandes_achat WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

export default router;
