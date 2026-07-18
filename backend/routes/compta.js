import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, roleMiddleware } from '../auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const { debut, fin, type, categorie } = req.query;
  let sql = 'SELECT * FROM comptabilite WHERE 1=1';
  const params = [];
  if (debut) { sql += ' AND date_operation >= ?'; params.push(debut); }
  if (fin) { sql += ' AND date_operation <= ?'; params.push(fin); }
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (categorie) { sql += ' AND categorie = ?'; params.push(categorie); }
  sql += ' ORDER BY date_operation DESC';
  res.json(dbQuery(sql, params));
});

router.get('/recettes', (req, res) => {
  const { debut, fin } = req.query;
  let sql = "SELECT COALESCE(SUM(montant),0) as total FROM comptabilite WHERE type='recette'";
  const params = [];
  if (debut) { sql += ' AND date_operation >= ?'; params.push(debut); }
  if (fin) { sql += ' AND date_operation <= ?'; params.push(fin); }
  res.json(dbQuery(sql, params)[0]);
});

router.get('/depenses', (req, res) => {
  const { debut, fin } = req.query;
  let sql = "SELECT COALESCE(SUM(montant),0) as total FROM comptabilite WHERE type='depense'";
  const params = [];
  if (debut) { sql += ' AND date_operation >= ?'; params.push(debut); }
  if (fin) { sql += ' AND date_operation <= ?'; params.push(fin); }
  res.json(dbQuery(sql, params)[0]);
});

router.get('/solde', (req, res) => {
  const recettes = dbQuery("SELECT COALESCE(SUM(montant),0) as total FROM comptabilite WHERE type='recette'")[0].total;
  const depenses = dbQuery("SELECT COALESCE(SUM(montant),0) as total FROM comptabilite WHERE type='depense'")[0].total;
  res.json({ recettes, depenses, solde: recettes - depenses });
});

router.post('/', roleMiddleware('admin', 'comptable', 'financier'), (req, res) => {
  const { type, categorie, montant, description, date_operation, compte, rapproche } = req.body;
  if (!type || !montant) return res.status(400).json({ error: 'type et montant requis' });
  const id = uuidv4();
  dbRun('INSERT INTO comptabilite (id,type,categorie,montant,description,date_operation,user_id,compte,rapproche) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, type, categorie, montant, description, date_operation || null, req.user.id, compte, rapproche ? 1 : 0]);
  res.status(201).json({ id });
});

router.put('/:id', roleMiddleware('admin', 'comptable'), (req, res) => {
  const { categorie, montant, description, date_operation } = req.body;
  dbRun('UPDATE comptabilite SET categorie=?,montant=?,description=?,date_operation=? WHERE id=?',
    [categorie, montant, description, date_operation, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', roleMiddleware('admin'), (req, res) => {
  dbRun('DELETE FROM comptabilite WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

router.get('/categories', (req, res) => {
  res.json(dbQuery('SELECT DISTINCT categorie FROM comptabilite WHERE categorie IS NOT NULL ORDER BY categorie'));
});

router.get('/rapport/mensuel', roleMiddleware('admin', 'comptable', 'financier'), (req, res) => {
  const rapport = dbQuery(`SELECT 
    strftime('%Y-%m', date_operation) as mois,
    type,
    SUM(montant) as total
    FROM comptabilite 
    WHERE date_operation >= date('now', '-12 months')
    GROUP BY mois, type
    ORDER BY mois`);
  res.json(rapport);
});

export default router;
