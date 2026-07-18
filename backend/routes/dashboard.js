import { Router } from 'express';
import { dbQuery } from '../db.js';
import { authMiddleware } from '../auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const users_count = dbQuery('SELECT COUNT(*) as total FROM users WHERE active=1')[0].total;
  const produits_count = dbQuery('SELECT COUNT(*) as total FROM produits')[0].total;
  const stock_faible = dbQuery(`SELECT COUNT(*) as total FROM produits p WHERE 
    COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id),0) <= p.stock_min`)[0].total;

  const docs_brouillon = dbQuery("SELECT COUNT(*) as total FROM documents WHERE status='brouillon'")[0].total;
  const docs_valides = dbQuery("SELECT COUNT(*) as total FROM documents WHERE status='validé' OR status='payé'")[0].total;
  const total_facture = dbQuery("SELECT COALESCE(SUM(total_ttc),0) as total FROM documents WHERE type='facture'")[0].total;
  const total_devis = dbQuery("SELECT COALESCE(SUM(total_ttc),0) as total FROM documents WHERE type='devis'")[0].total;

  const recent_mvt = dbQuery(`SELECT sm.*, p.designation FROM stock_mouvements sm JOIN produits p ON p.id=sm.produit_id ORDER BY sm.created_at DESC LIMIT 10`);

  res.json({
    users_count,
    produits_count,
    stock_faible,
    docs_brouillon,
    docs_valides,
    total_facture,
    total_devis,
    recent_mouvements: recent_mvt,
    role: req.user.role,
    department: req.user.department
  });
});

export default router;
