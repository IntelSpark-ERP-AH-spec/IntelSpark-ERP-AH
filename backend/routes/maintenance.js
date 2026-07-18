import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const { status, priorite, vehicule_id, type } = req.query;
  let sql = `SELECT mt.*, v.immatriculation, v.marque, v.modele
    FROM maintenance_taches mt JOIN vehicules v ON v.id = mt.vehicule_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND mt.status = ?'; params.push(status); }
  if (priorite) { sql += ' AND mt.priorite = ?'; params.push(priorite); }
  if (vehicule_id) { sql += ' AND mt.vehicule_id = ?'; params.push(vehicule_id); }
  if (type) { sql += ' AND mt.type = ?'; params.push(type); }
  sql += ' ORDER BY mt.created_at DESC';
  res.json(dbQuery(sql, params));
});

router.get('/stats', (req, res) => {
  const total = dbQuery('SELECT COUNT(*) as total FROM maintenance_taches')[0].total;
  const enCours = dbQuery("SELECT COUNT(*) as total FROM maintenance_taches WHERE status='en_cours'")[0].total;
  const planifiees = dbQuery("SELECT COUNT(*) as total FROM maintenance_taches WHERE status='planifiee'")[0].total;
  const urgentes = dbQuery("SELECT COUNT(*) as total FROM maintenance_taches WHERE priorite='urgente' AND status != 'terminee'")[0].total;
  const coutTotal = dbQuery("SELECT COALESCE(SUM(cout_total),0) as total FROM maintenance_taches WHERE status='terminee'")[0].total;
  const ceMois = dbQuery(`SELECT COUNT(*) as total FROM maintenance_taches
    WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`)[0].total;
  res.json({ total, enCours, planifiees, urgentes, coutTotal, ceMois });
});

router.get('/:id', (req, res) => {
  const tache = dbGet(`SELECT mt.*, v.immatriculation, v.marque, v.modele
    FROM maintenance_taches mt JOIN vehicules v ON v.id = mt.vehicule_id WHERE mt.id=?`, [req.params.id]);
  if (!tache) return res.status(404).json({ error: 'Tâche introuvable' });
  res.json(tache);
});

router.post('/', requireRole('admin', 'technicien', 'magasinier'), (req, res) => {
  const { vehicule_id, type, description, priorite, date_planification, cout_pieces, cout_main_oeuvre, fournisseur, pieces_utilisees, notes } = req.body;
  if (!vehicule_id || !type || !description) return res.status(400).json({ error: 'vehicule_id, type et description requis' });
  const id = uuidv4();
  const coutTotal = (cout_pieces || 0) + (cout_main_oeuvre || 0);
  dbRun(`INSERT INTO maintenance_taches (id, vehicule_id, type, description, priorite, date_planification, cout_pieces, cout_main_oeuvre, cout_total, fournisseur, pieces_utilisees, notes, user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, vehicule_id, type, description, priorite || 'normale', date_planification || null, cout_pieces || 0, cout_main_oeuvre || 0, coutTotal, fournisseur || null, pieces_utilisees || null, notes || null, req.user.id]);
  res.status(201).json({ id });
});

router.put('/:id', requireRole('admin', 'technicien'), (req, res) => {
  const { type, description, priorite, status, date_debut, date_fin, cout_pieces, cout_main_oeuvre, fournisseur, pieces_utilisees, notes } = req.body;
  const coutTotal = (cout_pieces || 0) + (cout_main_oeuvre || 0);
  dbRun(`UPDATE maintenance_taches SET type=?, description=?, priorite=?, status=?, date_debut=?, date_fin=?, cout_pieces=?, cout_main_oeuvre=?, cout_total=?, fournisseur=?, pieces_utilisees=?, notes=? WHERE id=?`,
    [type, description, priorite, status, date_debut, date_fin, cout_pieces, cout_main_oeuvre, coutTotal, fournisseur, pieces_utilisees, notes, req.params.id]);

  if (status === 'en_cours') {
    dbRun("UPDATE vehicules SET status='en_maintenance' WHERE id=(SELECT vehicule_id FROM maintenance_taches WHERE id=?)", [req.params.id]);
  } else if (status === 'terminee') {
    dbRun("UPDATE vehicules SET status='actif' WHERE id=(SELECT vehicule_id FROM maintenance_taches WHERE id=?)", [req.params.id]);
  }
  res.json({ success: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  dbRun('DELETE FROM maintenance_taches WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

export default router;
