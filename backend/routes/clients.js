import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, roleMiddleware } from '../auth.js';

const router = Router();
router.use(authMiddleware);

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_PHONE = /^[0-9+\-\s()]{6,20}$/;
const VALID_SIRET = /^[0-9]{14}$/;

router.get('/', roleMiddleware('admin', 'commercial', 'comptable', 'financier'), (req, res) => {
  const { search } = req.query;
  let sql = 'SELECT * FROM clients WHERE 1=1';
  const params = [];
  if (search && typeof search === 'string' && search.length <= 100) { sql += ' AND (nom LIKE ? OR email LIKE ? OR siret LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY nom';
  res.json(dbQuery(sql, params));
});

router.get('/:id', (req, res) => {
  const client = dbGet('SELECT * FROM clients WHERE id=?', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Client introuvable' });
  client.documents = dbQuery("SELECT * FROM documents WHERE client_nom=? ORDER BY date_creation DESC LIMIT 20", [client.nom]);
  res.json(client);
});

router.post('/', roleMiddleware('admin', 'commercial'), (req, res) => {
  let { nom, adresse, email, telephone, siret } = req.body;
  if (!nom || typeof nom !== 'string' || nom.trim().length < 1 || nom.length > 200) return res.status(400).json({ error: 'nom requis (max 200 car.)' });
  if (email && !VALID_EMAIL.test(email)) return res.status(400).json({ error: 'Email invalide' });
  if (telephone && !VALID_PHONE.test(telephone)) return res.status(400).json({ error: 'Téléphone invalide' });
  if (siret && !VALID_SIRET.test(siret)) return res.status(400).json({ error: 'SIRET invalide (14 chiffres)' });
  nom = nom.trim();
  const id = uuidv4();
  dbRun('INSERT INTO clients (id,nom,adresse,email,telephone,siret) VALUES (?,?,?,?,?,?)',
    [id, nom, adresse || '', email || '', telephone || '', siret || '']);
  res.status(201).json({ id, nom });
});

router.put('/:id', roleMiddleware('admin', 'commercial'), (req, res) => {
  let { nom, adresse, email, telephone, siret } = req.body;
  if (nom !== undefined && (typeof nom !== 'string' || nom.trim().length < 1 || nom.length > 200)) return res.status(400).json({ error: 'nom invalide' });
  if (email && !VALID_EMAIL.test(email)) return res.status(400).json({ error: 'Email invalide' });
  if (telephone && !VALID_PHONE.test(telephone)) return res.status(400).json({ error: 'Téléphone invalide' });
  if (siret && !VALID_SIRET.test(siret)) return res.status(400).json({ error: 'SIRET invalide' });
  if (nom) nom = nom.trim();
  dbRun('UPDATE clients SET nom=?,adresse=?,email=?,telephone=?,siret=? WHERE id=?',
    [nom || '', adresse || '', email || '', telephone || '', siret || '', req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', roleMiddleware('admin'), (req, res) => {
  dbRun('DELETE FROM clients WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

export default router;
