import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const { vehicule_id, status } = req.query;
  let sql = `SELECT p.*, v.immatriculation, v.marque, v.modele
    FROM pneus p JOIN vehicules v ON v.id = p.vehicule_id WHERE 1=1`;
  const params = [];
  if (vehicule_id) { sql += ' AND p.vehicule_id = ?'; params.push(vehicule_id); }
  if (status) { sql += ' AND p.status = ?'; params.push(status); }
  sql += ' ORDER BY v.immatriculation, p.position';
  res.json(dbQuery(sql, params));
});

router.get('/:id', (req, res) => {
  const pneu = dbGet(`SELECT p.*, v.immatriculation, v.marque, v.modele
    FROM pneus p JOIN vehicules v ON v.id = p.vehicule_id WHERE p.id=?`, [req.params.id]);
  if (!pneu) return res.status(404).json({ error: 'Pneu introuvable' });
  res.json(pneu);
});

router.post('/', requireRole('admin', 'technicien', 'magasinier'), (req, res) => {
  const { vehicule_id, position, marque, dimension, indice_vitesse, date_montage, kilometrage_montage, pression_recommandee, notes } = req.body;
  if (!vehicule_id || !position) return res.status(400).json({ error: 'vehicule_id et position requis' });
  const id = uuidv4();
  dbRun(`INSERT INTO pneus (id, vehicule_id, position, marque, dimension, indice_vitesse, date_montage, kilometrage_montage, pression_recommandee, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, vehicule_id, position, marque || null, dimension || null, indice_vitesse || null, date_montage || null, kilometrage_montage || 0, pression_recommandee || null, notes || null]);
  res.status(201).json({ id });
});

router.put('/:id', requireRole('admin', 'technicien', 'magasinier'), (req, res) => {
  const { marque, dimension, indice_vitesse, usure_percent, status, date_remplacement, pression_recommandee, notes } = req.body;
  dbRun(`UPDATE pneus SET marque=?, dimension=?, indice_vitesse=?, usure_percent=?, status=?, date_remplacement=?, pression_recommandee=?, notes=? WHERE id=?`,
    [marque, dimension, indice_vitesse, usure_percent, status, date_remplacement, pression_recommandee, notes, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  dbRun('DELETE FROM pneus WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

export default router;
