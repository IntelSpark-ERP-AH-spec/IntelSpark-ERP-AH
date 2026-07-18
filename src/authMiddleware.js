const jwt = require('jsonwebtoken');
const { getDb } = require('./db');

const ROLE_PERMISSIONS = {
  admin: ['*'],
  commercial: ['clients:read', 'clients:write', 'stock:read', 'documents:read', 'documents:write', 'dashboard:read', 'ai:use'],
  magasinier: ['stock:read', 'stock:write', 'warehouse:read', 'warehouse:write', 'stock:mouvements'],
  rh: ['rh:read', 'rh:write', 'rh:paies', 'rh:candidatures', 'rh:formations'],
  comptable: ['compta:read', 'compta:write', 'documents:read', 'clients:read'],
  financier: ['compta:read', 'compta:write', 'reporting:read'],
  technicien: ['atelier:read', 'atelier:write', 'vehicules:read', 'maintenance:read', 'maintenance:write'],
  employe: ['dashboard:read', 'profile:read', 'profile:write'],
};

function authMiddleware(req, res, next) {
  const token = req.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: 'intelsheets',
      audience: 'intelsheets-web',
    });
    const db = getDb();
    const revoked = db.prepare('SELECT 1 FROM sessions_blacklist WHERE jti = ?').get(decoded.jti);
    if (revoked) return res.status(401).json({ error: 'Session revoquee' });

    const currentUser = db.prepare('SELECT id, username, role, department, active, token_version FROM users WHERE id = ?').get(decoded.id);
    if (!currentUser || !currentUser.active) return res.status(401).json({ error: 'Compte indisponible' });
    if (Number(decoded.tokenVersion || 0) !== Number(currentUser.token_version || 0)) {
      return res.status(401).json({ error: 'Session expiree' });
    }
    req.user = {
      ...currentUser,
      permissions: ROLE_PERMISSIONS[currentUser.role] || ROLE_PERMISSIONS.employe,
      jti: decoded.jti,
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Session invalide ou expirée' });
  }
}

module.exports = authMiddleware;
