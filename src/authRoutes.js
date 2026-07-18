const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('./db');
const { logAuth } = require('./securityLog');

const router = express.Router();

function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'inconnu';
}

// Délai progressif après échec (ralentit le brute force)
async function loginDelay(attempts) {
  const delay = Math.min(attempts * 500, 3000);
  await new Promise(r => setTimeout(r, delay));
}

// Connexion
router.post('/login', async (req, res) => {
  const ip = getClientIp(req);
  const { username, password } = req.body;

  if (!username || !password) {
    logAuth(ip, username || '-', false, 'Champs manquants');
    await loginDelay(1);
    return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis' });
  }

  if (username.length < 2 || username.length > 50) {
    logAuth(ip, username, false, 'Nom invalide');
    await loginDelay(1);
    return res.status(400).json({ error: 'Nom d\'utilisateur invalide' });
  }

  if (password.length < 4 || password.length > 128) {
    logAuth(ip, username, false, 'Mot de passe invalide');
    await loginDelay(1);
    return res.status(400).json({ error: 'Mot de passe invalide' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !(await bcrypt.compare(password, user.password))) {
    logAuth(ip, username, false, 'Identifiants incorrects');
    await loginDelay(2);
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  logAuth(ip, username, true, 'Connexion réussie');

  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// Déconnexion
router.post('/logout', (req, res) => {
  const ip = getClientIp(req);
  logAuth(ip, req.user?.username || '-', true, 'Déconnexion');
  res.json({ message: 'Déconnecté' });
});

// Vérifier la session
router.get('/me', (req, res) => {
  const token = req.headers?.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non connecté' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const db = getDb();
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
    res.json({ username: user.username, role: user.role });
  } catch {
    return res.status(401).json({ error: 'Session invalide ou expirée' });
  }
});

module.exports = router;
