import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';

const router = Router();
router.use(authMiddleware);

const COUNTER_KEY = 'atelier_counter';

function nextNumero() {
  const row = dbGet(`SELECT value FROM user_data WHERE key=? AND user_id='_system'`, [COUNTER_KEY]);
  const next = (row ? parseInt(row.value) || 0 : 0) + 1;
  if (row) {
    dbRun(`UPDATE user_data SET value=? WHERE key=? AND user_id='_system'`, [String(next), COUNTER_KEY]);
  } else {
    dbRun(`INSERT INTO user_data (id, user_id, key, value) VALUES (?, '_system', ?, ?)`, [uuidv4(), COUNTER_KEY, String(next)]);
  }
  return `AO-${String(next).padStart(5, '0')}`;
}

router.get('/', (req, res) => {
  const { status, priorite, vehicule_id } = req.query;
  let sql = `SELECT ao.*, v.immatriculation, v.marque, v.modele,
    e.nom || ' ' || e.prenom as technicien_nom
    FROM atelier_ordres ao
    LEFT JOIN vehicules v ON v.id = ao.vehicule_id
    LEFT JOIN employes e ON e.id = ao.technicien_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND ao.status = ?'; params.push(status); }
  if (priorite) { sql += ' AND ao.priorite = ?'; params.push(priorite); }
  if (vehicule_id) { sql += ' AND ao.vehicule_id = ?'; params.push(vehicule_id); }
  sql += ' ORDER BY ao.created_at DESC';
  res.json(dbQuery(sql, params));
});

router.get('/stats', (req, res) => {
  const total = dbQuery('SELECT COUNT(*) as total FROM atelier_ordres')[0].total;
  const enAttente = dbQuery("SELECT COUNT(*) as total FROM atelier_ordres WHERE status='en_attente'")[0].total;
  const enCours = dbQuery("SELECT COUNT(*) as total FROM atelier_ordres WHERE status='en_cours'")[0].total;
  const termines = dbQuery("SELECT COUNT(*) as total FROM atelier_ordres WHERE status='termine'")[0].total;
  res.json({ total, enAttente, enCours, termines });
});

router.get('/:id', (req, res) => {
  const ordre = dbGet(`SELECT ao.*, v.immatriculation, v.marque, v.modele,
    e.nom || ' ' || e.prenom as technicien_nom
    FROM atelier_ordres ao
    LEFT JOIN vehicules v ON v.id = ao.vehicule_id
    LEFT JOIN employes e ON e.id = ao.technicien_id
    WHERE ao.id=?`, [req.params.id]);
  if (!ordre) return res.status(404).json({ error: 'Ordre introuvable' });
  ordre.operations = dbQuery('SELECT * FROM atelier_operations WHERE ordre_id=? ORDER BY created_at', [req.params.id]);
  res.json(ordre);
});

router.post('/', requireRole('admin', 'technicien', 'magasinier'), (req, res) => {
  const { vehicule_id, type, description, priorite, date_fin_prevue, technicien_id, client_nom, client_vehicule_immat, diagnostic, notes } = req.body;
  if (!vehicule_id || !type || !description) return res.status(400).json({ error: 'vehicule_id, type et description requis' });
  const id = uuidv4();
  const numero = nextNumero();
  dbRun(`INSERT INTO atelier_ordres (id, numero, vehicule_id, type, description, priorite, date_fin_prevue, technicien_id, client_nom, client_vehicule_immat, diagnostic, notes, user_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, numero, vehicule_id, type, description, priorite || 'normale', date_fin_prevue || null, technicien_id || null, client_nom || null, client_vehicule_immat || null, diagnostic || null, notes || null, req.user.id]);
  res.status(201).json({ id, numero });
});

router.put('/:id', requireRole('admin', 'technicien'), (req, res) => {
  const { type, description, priorite, status, date_fin_prevue, date_fin_reelle, technicien_id, client_nom, client_vehicule_immat, diagnostic, notes } = req.body;
  dbRun(`UPDATE atelier_ordres SET type=?, description=?, priorite=?, status=?, date_fin_prevue=?, date_fin_reelle=?, technicien_id=?, client_nom=?, client_vehicule_immat=?, diagnostic=?, notes=? WHERE id=?`,
    [type, description, priorite, status, date_fin_prevue, date_fin_reelle, technicien_id, client_nom, client_vehicule_immat, diagnostic, notes, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  dbRun('DELETE FROM atelier_operations WHERE ordre_id=?', [req.params.id]);
  dbRun('DELETE FROM atelier_ordres WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

router.post('/:id/operations', requireRole('admin', 'technicien'), (req, res) => {
  const { description, duree_estimee, main_oeuvre, pieces_json } = req.body;
  if (!description) return res.status(400).json({ error: 'description requise' });
  const id = uuidv4();
  dbRun('INSERT INTO atelier_operations (id, ordre_id, description, duree_estimee, main_oeuvre, pieces_json) VALUES (?,?,?,?,?,?)',
    [id, req.params.id, description, duree_estimee || null, main_oeuvre || 0, pieces_json || null]);
  res.status(201).json({ id });
});

router.put('/:id/operations/:opId', requireRole('admin', 'technicien'), (req, res) => {
  const { description, duree_estimee, duree_reelle, main_oeuvre, pieces_json, status } = req.body;
  dbRun(`UPDATE atelier_operations SET description=?, duree_estimee=?, duree_reelle=?, main_oeuvre=?, pieces_json=?, status=? WHERE id=? AND ordre_id=?`,
    [description, duree_estimee, duree_reelle, main_oeuvre, pieces_json, status, req.params.opId, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id/operations/:opId', requireRole('admin'), (req, res) => {
  dbRun('DELETE FROM atelier_operations WHERE id=? AND ordre_id=?', [req.params.opId, req.params.id]);
  res.json({ success: true });
});

export default router;
