import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbRun } from './db.js';
import { getRuntimeConfig } from './runtime-config.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.includes('a_remplacer')) {
  throw new Error('JWT_SECRET must be a strong secret in environment');
}

const TOKEN_EXPIRY = '12h';
const REFRESH_EXPIRY = '7d';
const MAX_LOGIN_ATTEMPTS = 10;
const LOCKOUT_DURATION_MINUTES = 5;
const JWT_ISSUER = 'intelsheets';
const JWT_AUDIENCE = 'intelsheets-web';

export const VALID_ROLES = ['admin', 'commercial', 'magasinier', 'rh', 'comptable', 'financier', 'technicien', 'employe'];

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return 'Le mot de passe doit contenir entre 12 et 128 caractères.';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Le mot de passe doit contenir une minuscule, une majuscule, un chiffre et un caractère spécial.';
  }
  return null;
}

// ============================================================
// Token management
// ============================================================
export function generateToken(user) {
  const jti = crypto.randomBytes(16).toString('hex');
  return jwt.sign(
    {
      jti,
      id: user.id,
      username: user.username,
      role: user.role,
      department: user.department,
      permissions: getRolePermissions(user.role),
      tokenVersion: Number(user.token_version || 0),
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256' }
  );
}

export function generateRefreshToken(user) {
  return jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_EXPIRY, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithm: 'HS256' }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function isTokenBlacklisted(jti) {
  const entry = dbGet('SELECT expires_at FROM sessions_blacklist WHERE jti = ?', [jti]);
  return !!entry;
}

export function blacklistToken(jti, expiresAt) {
  const expiry = expiresAt ? new Date(expiresAt * 1000).toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  dbRun('INSERT OR IGNORE INTO sessions_blacklist (jti, expires_at) VALUES (?, ?)', [jti, expiry]);
}

export function cleanupBlacklist() {
  dbRun("DELETE FROM sessions_blacklist WHERE julianday(expires_at) < julianday('now')");
}

// ============================================================
// Permissions by role
// ============================================================
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

function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.employe;
}

export function hasPermission(user, permission) {
  if (user.permissions?.includes('*')) return true;
  return user.permissions?.includes(permission) || false;
}

// ============================================================
// Auth middleware
// ============================================================
export function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Authentification requise' });
  }
  try {
    const decoded = verifyToken(token);
    if (isTokenBlacklisted(decoded.jti)) {
      return res.status(401).json({ error: 'Session révoquée' });
    }
    const currentUser = dbGet('SELECT id, username, role, department, active, token_version FROM users WHERE id = ?', [decoded.id]);
    if (!currentUser || !currentUser.active) {
      return res.status(401).json({ error: 'Compte indisponible' });
    }
    if (Number(decoded.tokenVersion || 0) !== Number(currentUser.token_version || 0)) {
      return res.status(401).json({ error: 'Session révoquée' });
    }
    if (currentUser.role !== 'admin' && getRuntimeConfig('maintenance_mode', false)) {
      return res.status(503).json({
        error: 'Maintenance en cours',
        announcement: getRuntimeConfig('system_announcement', ''),
        code: 'MAINTENANCE_MODE',
      });
    }
    req.user = {
      ...decoded,
      username: currentUser.username,
      role: currentUser.role,
      department: currentUser.department,
      permissions: getRolePermissions(currentUser.role),
    };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
}

export function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return next();
  try {
    const decoded = verifyToken(token);
    if (!isTokenBlacklisted(decoded.jti)) {
      const currentUser = dbGet('SELECT id, username, role, department, active, token_version FROM users WHERE id = ?', [decoded.id]);
      if (currentUser?.active && Number(decoded.tokenVersion || 0) === Number(currentUser.token_version || 0)) {
        req.user = { ...decoded, ...currentUser, permissions: getRolePermissions(currentUser.role) };
      }
    }
  } catch {}
  next();
}

export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
    if (req.user.permissions?.includes('*')) return next();
    const has = permissions.some(p => req.user.permissions?.includes(p));
    if (!has) {
      return res.status(403).json({ error: 'Permission refusée' });
    }
    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Rôle non autorisé' });
    }
    next();
  };
}

export const roleMiddleware = requireRole;

export function requireDepartment(...departments) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
    if (!departments.includes(req.user.department)) {
      return res.status(403).json({ error: 'Département non autorisé' });
    }
    next();
  };
}

// ============================================================
// Login rate limiting (per-user)
// ============================================================
export function checkLoginLockout(username) {
  const user = dbGet('SELECT login_attempts, locked_until FROM users WHERE username = ?', [username]);
  if (!user) return false;
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return true;
  }
  if (user.locked_until && new Date(user.locked_until) <= new Date()) {
    dbRun('UPDATE users SET login_attempts = 0, locked_until = NULL WHERE username = ?', [username]);
  }
  return false;
}

export function recordLoginAttempt(username, success) {
  if (success) {
    dbRun('UPDATE users SET login_attempts = 0, locked_until = NULL, last_login = datetime(\'now\') WHERE username = ?', [username]);
  } else {
    const user = dbGet('SELECT login_attempts FROM users WHERE username = ?', [username]);
    const attempts = (user?.login_attempts || 0) + 1;
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString();
      dbRun('UPDATE users SET login_attempts = ?, locked_until = ? WHERE username = ?', [attempts, lockUntil, username]);
    } else {
      dbRun('UPDATE users SET login_attempts = ? WHERE username = ?', [attempts, username]);
    }
  }
}

// ============================================================
// CSRF Middleware (double-submit cookie pattern)
// ============================================================
export function csrfMiddleware(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const csrfCookie = req.cookies?.['XSRF-TOKEN'];
  const csrfHeader = req.headers['x-csrf-token'];

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return res.status(403).json({ error: 'CSRF token invalide' });
  }
  next();
}

export function setCsrfToken(req, res, next) {
  if (!req.cookies?.['XSRF-TOKEN']) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('XSRF-TOKEN', token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
    });
  }
  next();
}

// ============================================================
// Audit trail middleware
// ============================================================
export function auditMiddleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const originalJson = res.json.bind(res);
  res.json = function (body) {
    const status = res.statusCode;
    if (status >= 200 && status < 300) {
      logAudit({
        userId: req.user?.id,
        username: req.user?.username,
        action: `${req.method} ${req.originalUrl}`,
        resource: req.originalUrl.split('/')[2] || 'unknown',
        resourceId: req.params?.id || req.body?.id,
        details: JSON.stringify({
          method: req.method,
          query: req.query,
          body: sanitizeAuditBody(req.body),
        }).slice(0, 2000),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        severity: 'info',
      });
    }
    return originalJson(body);
  };
  next();
}

function sanitizeAuditBody(body) {
  if (!body || typeof body !== 'object') return body;
  const sanitized = { ...body };
  const sensitive = ['password', 'currentPassword', 'newPassword', 'token', 'secret', 'smtp_pass', 'otp', 'prompt', 'content', 'memory'];
  for (const key of sensitive) {
    if (sanitized[key]) sanitized[key] = '***';
  }
  return sanitized;
}

export function logAudit(entry) {
  try {
    const id = uuidv4();
    dbRun(`INSERT INTO audit_log (id, user_id, username, action, resource, resource_id, details, ip, user_agent, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, entry.userId, entry.username, entry.action, entry.resource, entry.resourceId,
       entry.details, entry.ip, entry.userAgent, entry.severity || 'info']);
  } catch {}
}
