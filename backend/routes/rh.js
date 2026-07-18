import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun } from '../db.js';
import { authMiddleware, roleMiddleware } from '../auth.js';

const router = Router();
router.use(authMiddleware);

// Candidatures routes must be defined before /:id to avoid route conflicts
router.get('/candidatures', (req, res) => {
  const { search, status } = req.query;
  let sql = 'SELECT * FROM rh_candidatures WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (nom LIKE ? OR prenom LIKE ? OR poste LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  res.json(dbQuery(sql, params));
});

router.post('/candidatures', roleMiddleware('admin', 'rh'), (req, res) => {
  const { nom, prenom, email, telephone, poste, departement, notes, status, date_dernier_contact, description_ia } = req.body;
  if (!nom || !prenom) return res.status(400).json({ error: 'nom et prenom requis' });
  const id = uuidv4();
  const normalizedStatus = normalizeStatus(status || 'nouveau_cv');
  dbRun(`INSERT INTO rh_candidatures (id, nom, prenom, email, telephone, poste, departement, notes, status, date_dernier_contact, description_ia) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, nom, prenom, email || null, telephone || null, poste || null, departement || null, notes || null, normalizedStatus, date_dernier_contact || null, description_ia || null]);
  res.status(201).json({ id, employee_created: false });
});

router.put('/candidatures/:id', roleMiddleware('admin', 'rh'), (req, res) => {
  const { nom, prenom, email, telephone, poste, departement, notes, status, date_dernier_contact, description_ia } = req.body;
  const current = dbGet('SELECT * FROM rh_candidatures WHERE id=?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Candidature introuvable' });

  const next = {
    nom: nom ?? current.nom,
    prenom: prenom ?? current.prenom,
    email: email ?? current.email,
    telephone: telephone ?? current.telephone,
    poste: poste ?? current.poste,
    departement: departement ?? current.departement,
    notes: notes ?? current.notes,
    date_dernier_contact: date_dernier_contact ?? current.date_dernier_contact,
    description_ia: description_ia ?? current.description_ia,
  };
  const normalizedStatus = normalizeStatus(status ?? current.status);
  console.log('[RH] PUT candidature', req.params.id, 'status=', normalizedStatus, 'body.status=', status);

  let employee_id = current.employee_id || null;
  let employee_created = false;
  if (normalizedStatus === 'embauche') {
    if (!next.nom || !next.prenom) return res.status(400).json({ error: 'nom et prenom requis pour embaucher un candidat' });
    const existingEmployee = findEmployeeForCandidate(next);
    if (existingEmployee) {
      employee_id = existingEmployee.id;
    } else {
      employee_id = createEmployeeFromCandidate(next);
      employee_created = true;
    }
  }

  dbRun('UPDATE rh_candidatures SET nom=?, prenom=?, email=?, telephone=?, poste=?, departement=?, notes=?, status=?, date_dernier_contact=?, employee_id=?, description_ia=? WHERE id=?',
    [next.nom, next.prenom, next.email || null, next.telephone || null, next.poste || null, next.departement || null, next.notes || null, normalizedStatus, next.date_dernier_contact || null, employee_id, next.description_ia || null, req.params.id]);
  res.json({ success: true, employee_id, employee_created });
});

router.delete('/candidatures/:id', roleMiddleware('admin'), (req, res) => {
  dbRun('DELETE FROM rh_candidatures WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// Génération d'un avis IA sur un CV (description_ia)
router.post('/candidatures/:id/avis-ia', roleMiddleware('admin', 'rh'), async (req, res) => {
  const current = dbGet('SELECT * FROM rh_candidatures WHERE id=?', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Candidature introuvable' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.includes('VOTRE_CLE_API_GROQ_ICI') || apiKey.includes('a_remplacer')) {
    return res.status(500).json({ error: 'Clé API Groq manquante. Configurez GROQ_API_KEY dans .env' });
  }

  const cvText = (current.notes || '').replace(/^Extraction automatique depuis la saisie IA\s*:\s*/i, '').trim();
  const poste = current.poste || 'non précisé';
  const nom = `${current.prenom || ''} ${current.nom || ''}`.trim() || 'Candidat';

  const systemPrompt = `Tu es un assistant RH expert en évaluation de candidatures. Tu dois rédiger une description synthétique et critique d'un CV en français, en 3 à 4 phrases maximum, structurée EXACTEMENT ainsi :

Points forts : (résume les compétences clés, diplômes majeurs ou entreprises reconnues)
Adéquation au poste : (compare l'expérience du candidat avec le poste visé ; indique si le profil est junior, intermédiaire ou senior)
Avis / Recommandation : (phrase d'évaluation neutre et professionnelle)

Règles :
- Reste factuel, neutre et professionnel.
- Si les informations sont limitées, indique-le clairement sans inventer.
- Ne dépasse jamais 4 phrases au total.`;

  const userPrompt = `Candidat : ${nom}
Poste visé : ${poste}
Contenu du CV / notes :\n${cvText || '(aucun contenu fourni)'}`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 400,
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: 'Erreur Groq: ' + (err.error?.message || response.status) });
    }
    const data = await response.json();
    const description = data.choices?.[0]?.message?.content?.trim();
    if (!description) return res.status(500).json({ error: 'Réponse IA vide' });

    dbRun('UPDATE rh_candidatures SET description_ia=? WHERE id=?', [description, req.params.id]);
    res.json({ success: true, description_ia: description });
  } catch (e) {
    res.status(500).json({ error: 'Erreur génération avis IA: ' + e.message });
  }
});

// ─── Formations ───────────────────────────────────────────────────────────────
// IMPORTANT: déclarées AVANT /:id pour ne pas être capturées par le routeur générique

router.get('/formations', (req, res) => {
  const rows = dbQuery(`SELECT rf.*, (SELECT COUNT(*) FROM formation_participants fp WHERE fp.formation_id=rf.id) as participants FROM rh_formations rf ORDER BY rf.created_at DESC`);
  res.json(rows);
});

router.post('/formations', roleMiddleware('admin', 'rh'), (req, res) => {
  try {
    const { titre, description, formateur, date_debut, date_fin, cout } = req.body;
    if (!titre) return res.status(400).json({ error: 'titre requis' });
    const id = uuidv4();
    dbRun('INSERT INTO rh_formations (id, titre, description, formateur, date_debut, date_fin, cout) VALUES (?,?,?,?,?,?,?)',
      [id, titre, description || null, formateur || null, date_debut || null, date_fin || null, Number(cout) || 0]);
    const created = dbGet('SELECT * FROM rh_formations WHERE id=?', [id]);
    res.status(201).json({ id, ...(created || {}) });
  } catch (e) {
    res.status(500).json({ error: 'Erreur création formation: ' + e.message });
  }
});

router.put('/formations/:id', roleMiddleware('admin', 'rh'), (req, res) => {
  try {
    const { titre, description, formateur, date_debut, date_fin, cout, status } = req.body;
    dbRun('UPDATE rh_formations SET titre=?, description=?, formateur=?, date_debut=?, date_fin=?, cout=?, status=? WHERE id=?',
      [titre, description || null, formateur || null, date_debut || null, date_fin || null, Number(cout) || 0, status || 'planifiee', req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur mise à jour formation: ' + e.message });
  }
});

router.delete('/formations/:id', roleMiddleware('admin'), (req, res) => {
  dbRun('DELETE FROM formation_participants WHERE formation_id=?', [req.params.id]);
  dbRun('DELETE FROM rh_formations WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

router.get('/formations/:id/participants', (req, res) => {
  const rows = dbQuery('SELECT * FROM formation_participants WHERE formation_id=?', [req.params.id]);
  res.json(rows);
});

router.post('/formations/:id/participants', roleMiddleware('admin', 'rh'), (req, res) => {
  try {
    const { employe_id } = req.body;
    if (!employe_id) return res.status(400).json({ error: 'employe_id requis' });
    const id = uuidv4();
    dbRun('INSERT INTO formation_participants (id, formation_id, employe_id) VALUES (?,?,?)', [id, req.params.id, employe_id]);
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Erreur ajout participant: ' + e.message });
  }
});

router.delete('/formations/:id/participants/:participantId', roleMiddleware('admin'), (req, res) => {
  dbRun('DELETE FROM formation_participants WHERE id=? AND formation_id=?', [req.params.participantId, req.params.id]);
  res.json({ success: true });
});

// ─── Employés ─────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { search, status } = req.query;
  let sql = 'SELECT * FROM employes WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (nom LIKE ? OR prenom LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY nom, prenom';
  res.json(dbQuery(sql, params));
});

router.get('/:id', (req, res) => {
  const emp = dbGet('SELECT * FROM employes WHERE id=?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Employé introuvable' });
  emp.contrats = dbQuery('SELECT * FROM contrats WHERE employe_id=? ORDER BY date_debut DESC', [req.params.id]);
  emp.absences = dbQuery('SELECT * FROM absences WHERE employe_id=? ORDER BY date_debut DESC LIMIT 50', [req.params.id]);
  emp.paies = dbQuery('SELECT * FROM paies WHERE employe_id=? ORDER BY mois DESC LIMIT 12', [req.params.id]);
  res.json(emp);
});

router.post('/', roleMiddleware('admin', 'rh'), (req, res) => {
  try {
    const { nom, prenom, email, telephone, date_naissance, adresse, poste, departement, date_arrivee, salaire_base } = req.body;
    if (!nom || !prenom) return res.status(400).json({ error: 'nom et prenom requis' });
    const id = uuidv4();
    dbRun(`INSERT INTO employes (id,nom,prenom,email,telephone,date_naissance,adresse,poste,departement,date_arrivee,salaire_base)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, nom, prenom, email, telephone, date_naissance, adresse, poste, departement, date_arrivee, salaire_base || 0]);
    res.status(201).json({ id, nom, prenom });
  } catch (e) {
    res.status(500).json({ error: 'Erreur création employé: ' + e.message });
  }
});

router.put('/:id', roleMiddleware('admin', 'rh'), (req, res) => {
  const { nom, prenom, email, telephone, date_naissance, adresse, poste, departement, date_arrivee, salaire_base, status } = req.body;
  dbRun(`UPDATE employes SET nom=?,prenom=?,email=?,telephone=?,date_naissance=?,adresse=?,poste=?,departement=?,date_arrivee=?,salaire_base=?,status=? WHERE id=?`,
    [nom, prenom, email, telephone, date_naissance, adresse, poste, departement, date_arrivee, salaire_base, status, req.params.id]);
  res.json({ success: true });
});

router.delete('/:id', roleMiddleware('admin'), (req, res) => {
  dbRun('DELETE FROM absences WHERE employe_id=?', [req.params.id]);
  dbRun('DELETE FROM paies WHERE employe_id=?', [req.params.id]);
  dbRun('DELETE FROM contrats WHERE employe_id=?', [req.params.id]);
  dbRun('DELETE FROM employes WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

router.post('/:id/contrat', roleMiddleware('admin', 'rh'), (req, res) => {
  const { type, date_debut, date_fin, salaire, poste } = req.body;
  const id = uuidv4();
  dbRun('INSERT INTO contrats (id,employe_id,type,date_debut,date_fin,salaire,poste) VALUES (?,?,?,?,?,?,?)',
    [id, req.params.id, type, date_debut, date_fin, salaire, poste]);
  res.status(201).json({ id });
});

router.post('/:id/absence', roleMiddleware('admin', 'rh'), (req, res) => {
  const { type, date_debut, date_fin, motif } = req.body;
  const id = uuidv4();
  dbRun('INSERT INTO absences (id,employe_id,type,date_debut,date_fin,motif) VALUES (?,?,?,?,?,?)',
    [id, req.params.id, type, date_debut, date_fin, motif]);
  res.status(201).json({ id });
});

router.post('/:id/paie', roleMiddleware('admin', 'rh', 'comptable'), (req, res) => {
  try {
    const { mois, salaire_brut, retenues, primes, net_a_payer, heures } = req.body;
    const id = uuidv4();
    dbRun('INSERT INTO paies (id,employe_id,mois,salaire_brut,retenues,primes,net_a_payer,heures) VALUES (?,?,?,?,?,?,?,?)',
      [id, req.params.id, mois, salaire_brut, retenues || 0, primes || 0, net_a_payer || salaire_brut, heures || '151.67']);
    res.status(201).json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Erreur enregistrement paie: ' + e.message });
  }
});

// (routes /formations déplacées plus haut pour éviter le conflit avec /:id)

function normalizeStatus(status) {
  const value = String(status || 'nouveau_cv').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (value.includes('embauche') || value.includes('engage') || value.includes('retenu') || value.includes('hired')) return 'embauche';
  if (value.includes('offre') || value.includes('envoy') || value.includes('sent')) return 'offre_envoyee';
  if (value.includes('entretien') || value.includes('contact') || value.includes('interview')) return 'entretien';
  if (value.includes('refus') || value.includes('rejet') || value.includes('rejected')) return 'refuse';
  if (value.includes('nouveau') || value.includes('nouveau') || value.includes('new')) return 'nouveau_cv';
  return 'nouveau_cv';
}

function findEmployeeForCandidate(candidate) {
  if (candidate.email) {
    const byEmail = dbGet('SELECT * FROM employes WHERE email=?', [candidate.email]);
    if (byEmail) return byEmail;
  }
  return dbGet('SELECT * FROM employes WHERE nom=? AND prenom=?', [candidate.nom, candidate.prenom]);
}

function createEmployeeFromCandidate(candidate) {
  const id = uuidv4();
  dbRun(`INSERT INTO employes (id,nom,prenom,email,telephone,date_naissance,adresse,poste,departement,date_arrivee,salaire_base,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, candidate.nom, candidate.prenom, candidate.email || null, candidate.telephone || null, null, null, candidate.poste || null, '', frDateToIso(candidate.date_dernier_contact), 0, 'actif']);
  return id;
}

function frDateToIso(date) {
  if (!date || !/^\d{2}\/\d{2}\/\d{4}$/.test(date)) return new Date().toISOString().slice(0, 10);
  const [day, month, year] = date.split('/');
  return `${year}-${month}-${day}`;
}

export default router;
