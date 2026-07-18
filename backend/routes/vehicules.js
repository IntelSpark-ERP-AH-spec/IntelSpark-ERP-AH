import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, requireRole, requirePermission } from '../auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const { search, status, type } = req.query;
  let sql = `SELECT v.*, e.nom || ' ' || e.prenom as conducteur_nom
    FROM vehicules v LEFT JOIN employes e ON e.id = v.conducteur_id WHERE 1=1`;
  const params = [];
  if (search) { sql += ' AND (v.immatriculation LIKE ? OR v.marque LIKE ? OR v.modele LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status) { sql += ' AND v.status = ?'; params.push(status); }
  if (type) { sql += ' AND v.type = ?'; params.push(type); }
  sql += ' ORDER BY v.immatriculation';
  res.json(dbQuery(sql, params));
});

router.get('/stats', (req, res) => {
  const total = dbQuery('SELECT COUNT(*) as total FROM vehicules')[0].total;
  const actifs = dbQuery("SELECT COUNT(*) as total FROM vehicules WHERE status='actif'")[0].total;
  const enMaintenance = dbQuery("SELECT COUNT(*) as total FROM vehicules WHERE status='en_maintenance'")[0].total;
  const camions = dbQuery("SELECT COUNT(*) as total FROM vehicules WHERE type='camion'")[0].total;
  const remorques = dbQuery("SELECT COUNT(*) as total FROM vehicules WHERE type='remorque' OR type='semi-remorque'")[0].total;
  const prochainCT = dbQuery(`SELECT COUNT(*) as total FROM vehicules WHERE date_prochain_ct IS NOT NULL
    AND date_prochain_ct <= date('now', '+30 days') AND status='actif'`)[0].total;
  res.json({ total, actifs, enMaintenance, camions, remorques, prochainCT });
});

router.get('/:id', (req, res) => {
  const veh = dbGet(`SELECT v.*, e.nom || ' ' || e.prenom as conducteur_nom
    FROM vehicules v LEFT JOIN employes e ON e.id = v.conducteur_id WHERE v.id=?`, [req.params.id]);
  if (!veh) return res.status(404).json({ error: 'Véhicule introuvable' });
  veh.maintenance = dbQuery('SELECT * FROM maintenance_taches WHERE vehicule_id=? ORDER BY created_at DESC LIMIT 20', [req.params.id]);
  veh.pneus = dbQuery('SELECT * FROM pneus WHERE vehicule_id=? ORDER BY position', [req.params.id]);
  res.json(veh);
});

router.post('/', requireRole('admin', 'commercial', 'magasinier'), (req, res) => {
  const { immatriculation, marque, modele, annee, type, poids_plafond, capacite_charge, nb_essieux, proprietaire, vignette_critair, date_achat, kilometrage, notes, conducteur_id } = req.body;
  if (!immatriculation || !marque || !modele || !type) return res.status(400).json({ error: 'immatriculation, marque, modele et type requis' });
  const existing = dbGet('SELECT id FROM vehicules WHERE immatriculation = ?', [immatriculation.toUpperCase()]);
  if (existing) return res.status(400).json({ error: 'Immatriculation déjà existante' });
  const id = uuidv4();
  dbRun(`INSERT INTO vehicules (id, immatriculation, marque, modele, annee, type, poids_plafond, capacite_charge, nb_essieux, proprietaire, vignette_critair, date_achat, kilometrage, notes, conducteur_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, immatriculation.toUpperCase(), marque, modele, annee || null, type, poids_plafond || null, capacite_charge || null, nb_essieux || null, proprietaire || 'entreprise', vignette_critair || null, date_achat || null, kilometrage || 0, notes || null, conducteur_id || null]);
  res.status(201).json({ id, immatriculation: immatriculation.toUpperCase() });
});

router.put('/:id', requireRole('admin', 'commercial', 'magasinier'), (req, res) => {
  const { marque, modele, annee, type, poids_plafond, capacite_charge, nb_essieux, proprietaire, vignette_critair, date_achat, date_dernier_ct, date_prochain_ct, kilometrage, status, notes, conducteur_id } = req.body;
  dbRun(`UPDATE vehicules SET marque=?, modele=?, annee=?, type=?, poids_plafond=?, capacite_charge=?, nb_essieux=?, proprietaire=?, vignette_critair=?, date_achat=?, date_dernier_ct=?, date_prochain_ct=?, kilometrage=?, status=?, notes=?, conducteur_id=? WHERE id=?`,
    [marque, modele, annee, type, poids_plafond, capacite_charge, nb_essieux, proprietaire, vignette_critair, date_achat, date_dernier_ct, date_prochain_ct, kilometrage, status, notes, conducteur_id, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  dbRun('DELETE FROM pneus WHERE vehicule_id=?', [req.params.id]);
  dbRun('DELETE FROM maintenance_taches WHERE vehicule_id=?', [req.params.id]);
  dbRun('DELETE FROM vehicules WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

router.post('/:id/kilometrage', requireRole('admin', 'magasinier', 'technicien'), (req, res) => {
  const { kilometrage } = req.body;
  if (!kilometrage || kilometrage < 0) return res.status(400).json({ error: 'Kilométrage invalide' });
  dbRun('UPDATE vehicules SET kilometrage=? WHERE id=?', [kilometrage, req.params.id]);
  res.json({ success: true, kilometrage });
});

export default router;
