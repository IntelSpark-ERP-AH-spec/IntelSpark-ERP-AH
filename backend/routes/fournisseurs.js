import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, requireRole } from '../auth.js';

const router = Router();
router.use(authMiddleware);

router.get('/', (req, res) => {
  const { search, categorie, actif } = req.query;
  let sql = 'SELECT * FROM fournisseurs WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (nom LIKE ? OR email LIKE ? OR siret LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (categorie) { sql += ' AND categorie = ?'; params.push(categorie); }
  if (actif !== undefined) { sql += ' AND actif = ?'; params.push(actif === '1' ? 1 : 0); }
  sql += ' ORDER BY nom';
  res.json(dbQuery(sql, params));
});

router.get('/categories', (req, res) => {
  res.json(dbQuery('SELECT DISTINCT categorie FROM fournisseurs WHERE categorie IS NOT NULL ORDER BY categorie'));
});

router.get('/:id', (req, res) => {
  const four = dbGet('SELECT * FROM fournisseurs WHERE id=?', [req.params.id]);
  if (!four) return res.status(404).json({ error: 'Fournisseur introuvable' });
  four.commandes = dbQuery('SELECT * FROM commandes_achat WHERE fournisseur_id=? ORDER BY created_at DESC LIMIT 20', [req.params.id]);
  res.json(four);
});

router.post('/', requireRole('admin', 'commercial', 'comptable'), (req, res) => {
  const { nom, contact, email, telephone, adresse, siret, ice, categorie, notes } = req.body;
  if (!nom) return res.status(400).json({ error: 'nom requis' });
  const id = uuidv4();
  dbRun('INSERT INTO fournisseurs (id, nom, contact, email, telephone, adresse, siret, ice, categorie, notes) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [id, nom, contact || '', email || '', telephone || '', adresse || '', siret || '', ice || '', categorie || null, notes || null]);
  res.status(201).json({ id, nom });
});

router.put('/:id', requireRole('admin', 'commercial', 'comptable'), (req, res) => {
  const { nom, contact, email, telephone, adresse, siret, ice, categorie, notes, actif } = req.body;
  dbRun('UPDATE fournisseurs SET nom=?, contact=?, email=?, telephone=?, adresse=?, siret=?, ice=?, categorie=?, notes=?, actif=? WHERE id=?',
    [nom, contact, email, telephone, adresse, siret, ice, categorie, notes, actif ?? 1, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  dbRun('DELETE FROM fournisseurs WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

export default router;
