const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;
const cookieParser = require('cookie-parser');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const forge = require('node-forge');
require('dotenv').config();

const app = express();

// Nonce unique par reponse. Il permet d'autoriser uniquement les scripts
// injectes par notre propre page HTML, sans ouvrir tout le meme domaine.
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(18).toString('base64');
  next();
});

// ============================================================
// Validation stricte de l'environnement
// ============================================================
const REQUIRED_ENV = ['JWT_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key] || process.env[key].includes('a_remplacer')) {
    console.error(`ERREUR: ${key} n'est pas configuré dans .env`);
    process.exit(1);
  }
}
if (process.env.ADMIN_PASSWORD === 'admin123') {
  console.error('ERREUR: Veuillez changer ADMIN_PASSWORD dans .env (mot de passe trop faible)');
  process.exit(1);
}

const isDev = process.env.NODE_ENV !== 'production';
const PORT = parseInt(process.env.PORT) || 3001;
const HTTPS_PORT = parseInt(process.env.HTTPS_PORT) || 3443;
const JWT_SECRET = process.env.JWT_SECRET;
function boundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] || String(fallback), 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}
const GLOBAL_RATE_LIMIT = boundedInteger('HTTP_GLOBAL_RATE_LIMIT', 60000, 1000, 500000);
const TARGET_CONCURRENT_USERS = boundedInteger('TARGET_CONCURRENT_USERS', 100, 10, 1000);
const AUDIT_RETENTION_DAYS = boundedInteger('AUDIT_RETENTION_DAYS', 365, 30, 3650);
if (JWT_SECRET.length < 32) {
  console.error('ERREUR: JWT_SECRET doit contenir au moins 32 caracteres');
  process.exit(1);
}
if (!isDev && !process.env.ALLOWED_ORIGINS) {
  console.error('ERREUR: ALLOWED_ORIGINS doit être configuré en production');
  process.exit(1);
}
if (!isDev && process.env.FORCE_HTTPS === 'true' && !process.env.PUBLIC_URL) {
  console.error('ERREUR: PUBLIC_URL doit etre configure avec FORCE_HTTPS');
  process.exit(1);
}
if (!isDev && (!process.env.DATA_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY.length < 32)) {
  console.error('ERREUR: DATA_ENCRYPTION_KEY doit contenir au moins 32 caracteres en production');
  process.exit(1);
}

// ============================================================
// Security Headers (Helmet strict)
// ============================================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'strict-dynamic'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
      ],
      scriptSrcElem: [
        "'strict-dynamic'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
      ],
      scriptSrcAttr: ["'none'"],
      styleSrc: [
        "'self'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
      ],
      styleSrcElem: [
        "'self'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
      ],
      // React utilise encore des attributs style dynamiques. Cette exception
      // CSP3 reste limitee aux attributs et ne s'applique plus aux feuilles CSS.
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      // API et WebSocket utilisent toujours l'origine courante. Aucun endpoint
      // HTTP externe ne peut donc etre contacte depuis le navigateur.
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      workerSrc: ["'self'", "blob:"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  // Un navigateur ignore HSTS sur HTTP local, mais le header reste disponible
  // derriere un reverse proxy HTTPS (Cloudflare, Caddy, Nginx, etc.).
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
  frameguard: { action: 'deny' },
  dnsPrefetchControl: { allow: false },
}));

app.disable('x-powered-by');
app.use((req, res, next) => {
  // Reduit les indices techniques exposes par le serveur d'origine.
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()');
  next();
});

// ============================================================
// CORS strict
// ============================================================
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin && isDev) return cb(null, true);
    if (!origin) return cb(null, false);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    if (isDev) {
      try {
        const hostname = new URL(origin).hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) || hostname.endsWith('.trycloudflare.com')) {
          return cb(null, true);
        }
      } catch {}
    }
    cb(new Error('Origine non autorisée'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
  maxAge: 86400,
}));

app.set('trust proxy', isDev ? false : Number.parseInt(process.env.TRUST_PROXY || '1', 10));
if (!isDev && process.env.FORCE_HTTPS === 'true') {
  app.use((req, res, next) => {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    if (req.secure || forwardedProto === 'https') return next();
    const publicOrigin = new URL(process.env.PUBLIC_URL).origin;
    return res.redirect(308, `${publicOrigin}${req.originalUrl}`);
  });
}
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true, limit: '500kb' }));
app.use(cookieParser());
app.use('/api/', (req, res, next) => {
  const requestId = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 128);
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ============================================================
// Session sécurisée
// ============================================================
// ============================================================
// Global rate limiting
// ============================================================
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: GLOBAL_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes, réessayez plus tard' },
});
app.use('/api/', globalLimiter);

const loginIpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Trop de tentatives depuis cette connexion' },
});

const loginAccountLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans 5 minutes.' },
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const username = String(req.body?.username || 'inconnu').trim().toLowerCase().slice(0, 64);
    return `${ipKeyGenerator(req.ip)}:${username}`;
  },
});
app.use('/api/auth/login', loginIpLimiter, loginAccountLimiter);

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  message: { error: 'Trop de requetes authentification' },
});
app.use('/api/auth', authLimiter);

// ============================================================
// Security logging middleware
// ============================================================
const { log, logAuth, logAction } = require('./src/securityLog');

app.use('/api/', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (res.statusCode >= 400) {
      log('HTTP', {
        ip: req.ip,
        user: req.user?.username || '-',
        msg: `${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`,
      });
    }
    if (duration > 5000) {
      log('SLOW', {
        ip: req.ip,
        user: req.user?.username || '-',
        msg: `${req.method} ${req.originalUrl} → ${duration}ms`,
      });
    }
  });
  next();
});

// ============================================================
// Import backend (unified ES module)
// ============================================================
let backendInitDone = false;
let reportSystemError = () => null;
let runSystemRecovery = () => ({ skipped: true, reason: 'not_initialized' });

async function mountBackendRoutes() {
  const { initDB, dbQuery, dbRun, dbGet } = await import('./backend/db.js');
  await initDB();

  // Security middleware from backend
  const { setCsrfToken, csrfMiddleware, auditMiddleware, authMiddleware: secureAuthMiddleware } = await import('./backend/auth.js');
  const { metricsMiddleware, metricsHandler, startMonitoring, recordSystemError } = await import('./backend/monitoring.js');
  const { runSelfHealingCycle } = await import('./backend/system-self-healing.js');
  const { startSiteAgentAutonomy } = await import('./backend/site-agent-autonomy.js');
  reportSystemError = recordSystemError;
  runSystemRecovery = runSelfHealingCycle;

  // Routes (auth first, no CSRF on login)
  const authRoutesBE = (await import('./backend/routes/auth.js')).default;
  const usersRoutes = (await import('./backend/routes/users.js')).default;
  const stockRoutes = (await import('./backend/routes/stock.js')).default;
  const rhRoutes = (await import('./backend/routes/rh.js')).default;
  const comptaRoutes = (await import('./backend/routes/compta.js')).default;
  const clientsRoutes = (await import('./backend/routes/clients.js')).default;
  const dataRoutes = (await import('./backend/routes/data.js')).default;
  const dashboardRoutes = (await import('./backend/routes/dashboard.js')).default;
  const warehouseRoutes = (await import('./backend/routes/warehouse.js')).default;
  const vehiculesRoutes = (await import('./backend/routes/vehicules.js')).default;
  const maintenanceRoutes = (await import('./backend/routes/maintenance.js')).default;
  const atelierRoutes = (await import('./backend/routes/atelier.js')).default;
  const fournisseursRoutes = (await import('./backend/routes/fournisseurs.js')).default;
  const commandesRoutes = (await import('./backend/routes/commandes.js')).default;
  const notificationsRoutes = (await import('./backend/routes/notifications.js')).default;
  const echeancierRoutes = (await import('./backend/routes/echeancier.js')).default;
  const backupRoutes = (await import('./backend/routes/backup.js')).default;
  const reportingRoutes = (await import('./backend/routes/reporting.js')).default;
  const pneusRoutes = (await import('./backend/routes/pneus.js')).default;
  const messagesRoutes = (await import('./backend/routes/messages.js')).default;
  const mailRoutes = (await import('./backend/routes/mail.js')).default;
  const systemRoutes = (await import('./backend/routes/system.js')).default;
  const pluginsRoutes = (await import('./backend/routes/plugins.js')).default;
  const siteAgentRoutes = (await import('./backend/routes/site-agent.js')).default;
  const { reloadPlugins } = await import('./backend/plugin-manager.js');
  await reloadPlugins();

  app.use('/api', metricsMiddleware);
  app.get('/api/metrics', metricsHandler);
  stopMonitoring = startMonitoring({
    onCriticalAlert: (alert) => runSystemRecovery({ alertIds: [alert.id] }),
  });
  stopSiteAgentAutonomy = startSiteAgentAutonomy();
  app.use('/api', setCsrfToken);
  app.use('/api', (req, res, next) => {
    if (req.path === '/auth/login' && req.method === 'POST') return next();
    return csrfMiddleware(req, res, next);
  });

  app.use('/api/auth', authRoutesBE);

  // Audit trail (log all mutations) — only for authenticated routes
  app.use('/api/', auditMiddleware);

  app.use('/api/users', usersRoutes);
  app.use('/api/stock', stockRoutes);
  app.use('/api/rh', rhRoutes);
  app.use('/api/compta', comptaRoutes);
  app.use('/api/clients', clientsRoutes);
  app.use('/api/data', dataRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/warehouse', warehouseRoutes);
  app.use('/api/vehicules', vehiculesRoutes);
  app.use('/api/maintenance', maintenanceRoutes);
  app.use('/api/atelier', atelierRoutes);
  app.use('/api/fournisseurs', fournisseursRoutes);
  app.use('/api/commandes', commandesRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/echeancier', echeancierRoutes);
  app.use('/api/backup', backupRoutes);
  app.use('/api/reporting', reportingRoutes);
  app.use('/api/pneus', pneusRoutes);
  app.use('/api/messages', messagesRoutes);
  app.use('/api/mail', mailRoutes);
  app.use('/api/system', systemRoutes);
  app.use('/api/plugins', pluginsRoutes);
  app.use('/api/site-agent', siteAgentRoutes);

  // Mount legacy src routes
  const userDataRoutes = require('./src/userDataRoutes');
  const csrfMiddlewareLegacy = require('./src/csrfMiddleware');

  app.use('/api/user-data', secureAuthMiddleware, csrfMiddlewareLegacy, userDataRoutes);

  app.use(globalErrorHandler);
  backendInitDone = true;
}

// ============================================================
// AI Assistant endpoint (with strict validation)
// ============================================================
const authMw = require('./src/authMiddleware');
const csrfMiddlewareLegacy = require('./src/csrfMiddleware');
const { buildAssistantMessages } = require('./src/aiPrompt');

app.post('/api/ai', csrfMiddlewareLegacy, authMw, (req, res, next) => {
  if (req.user.permissions?.includes('*') || req.user.permissions?.includes('ai:use')) return next();
  return res.status(403).json({ error: 'Permission insuffisante' });
}, async (req, res) => {
  const { prompt, context } = req.body;

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Le prompt est vide.' });
  }
  if (prompt.length > 4000) {
    return res.status(400).json({ error: 'Prompt trop long (max 4000 caractères)' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.includes('VOTRE_CLE_API_GROQ_ICI') || apiKey.includes('a_remplacer')) {
    return res.status(500).json({ error: 'Clé API Groq manquante. Configurez GROQ_API_KEY dans .env' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: buildAssistantMessages(prompt, context),
        temperature: 0.3,
        max_tokens: 1024,
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      log('AI_ERROR', { msg: `Groq API: ${response.status} ${JSON.stringify(errorData).slice(0, 200)}` });
      return res.status(response.status).json({ error: 'Erreur avec le service Groq.' });
    }

    const data = await response.json();
    if (data.choices && data.choices[0]) {
      return res.json({ response: data.choices[0].message.content });
    }
    throw new Error('Format de réponse inattendu');
  } catch (error) {
    log('AI_ERROR', { msg: error.message });
    return res.status(500).json({ error: 'Une erreur interne est survenue.' });
  }
});

// ============================================================
// Health endpoint
// ============================================================
app.get('/api/health', (req, res) => {
  const memory = process.memoryUsage();
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    version: '2.0.0',
    uptime: process.uptime(),
    target_concurrent_users: TARGET_CONCURRENT_USERS,
    websocket_connections: websocketServer?.clients?.size || 0,
    memory_rss_mb: Math.round(memory.rss / 1024 / 1024),
    heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
  });
});

app.get('/api/ready', (req, res) => {
  const ready = backendInitDone && Boolean(server?.listening || process.env.NODE_ENV !== 'production');
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'starting', database: backendInitDone ? 'ready' : 'starting' });
});

// ============================================================
// Frontend static files
// ============================================================
const frontendDist = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, {
    // index.html doit passer par sendSecuredIndex pour recevoir son nonce CSP.
    index: false,
    maxAge: isDev ? 0 : '1y',
    immutable: !isDev,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    },
  }));
  function sendSecuredIndex(req, res, next) {
    fs.readFile(path.join(frontendDist, 'index.html'), 'utf8', (error, html) => {
      if (error) return next(error);
      const nonce = res.locals.cspNonce;
      const securedHtml = html.replace(/<script\b/g, `<script nonce="${nonce}"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.type('html').send(securedHtml);
    });
  }
  app.get('/', sendSecuredIndex);
  app.get('/*splat', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return sendSecuredIndex(req, res, next);
  });
}

// ============================================================
// Global error handler (no stack traces in production)
// ============================================================
function globalErrorHandler(err, req, res, next) {
  log('ERROR', { ip: req.ip, msg: err.message });
  try {
    const alert = reportSystemError(err, {
      method: req.method,
      path: req.path,
      request_id: req.requestId,
      status: err.status || 500,
    });
    if (alert?.id) queueMicrotask(() => {
      try { runSystemRecovery({ alertIds: [alert.id] }); }
      catch (recoveryError) { console.error('Correction automatique échouée:', recoveryError?.message || recoveryError); }
    });
  } catch (monitoringError) {
    console.error('Enregistrement erreur système impossible:', monitoringError?.message || monitoringError);
  }
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Erreur interne du serveur',
  });
}

// ============================================================
// HTTPS with auto-signed cert
// ============================================================
const CERT_DIR = path.join(__dirname, 'certs');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');

function getOrCreateCert() {
  if (fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE)) {
    return {
      cert: fs.readFileSync(CERT_FILE, 'utf-8'),
      key: fs.readFileSync(KEY_FILE, 'utf-8'),
    };
  }

  if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(16).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
    { name: 'subjectAltName', altNames: [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
    ]},
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  fs.writeFileSync(CERT_FILE, certPem);
  fs.writeFileSync(KEY_FILE, keyPem);

  return { cert: certPem, key: keyPem };
}

// ============================================================
// Start server
// ============================================================
let server;
let auxiliaryServer;
let websocketServer;
let backupTimer;
let maintenanceTimer;
let stopMonitoring;
let stopSiteAgentAutonomy;
let stopMailSync;

function handleServerListenError(error, port) {
  if (error?.code === 'EADDRINUSE') {
    console.log(`Le serveur est déjà actif sur le port ${port}. Aucun second démarrage nécessaire.`);
    process.exit(0);
  }
  console.error(`Impossible d'écouter sur le port ${port}:`, error);
  process.exit(1);
}

function configureHttpServer(instance) {
  instance.keepAliveTimeout = 65_000;
  instance.headersTimeout = 66_000;
  instance.requestTimeout = 30_000;
  instance.maxHeadersCount = 100;
  instance.maxRequestsPerSocket = 1000;
  return instance;
}

async function startServer() {
  await mountBackendRoutes();

  const tlsCertPath = process.env.TLS_CERT_PATH;
  const tlsKeyPath = process.env.TLS_KEY_PATH;
  if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath)) {
    throw new Error('TLS_CERT_PATH et TLS_KEY_PATH doivent etre configures ensemble');
  }
  const useDirectTls = Boolean(tlsCertPath && tlsKeyPath);

  // HTTP
  if (!isDev && !useDirectTls) {
    server = configureHttpServer(http.createServer(app));
    server.once('error', (error) => handleServerListenError(error, PORT));
    server.listen(PORT, () => console.log(`HTTP interne production actif: ${PORT}`));
  } else if (!isDev) {
    auxiliaryServer = configureHttpServer(http.createServer((req, res) => {
      const host = req.headers.host?.replace(/:\d+$/, '') || 'localhost';
      const portSuffix = HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`;
      res.writeHead(308, { Location: `https://${host}${portSuffix}${req.url}` });
      res.end();
    }));
    auxiliaryServer.listen(PORT, () => {
      console.log(`HTTP → HTTPS (redirection) sur http://localhost:${PORT}`);
    });
  } else {
    auxiliaryServer = configureHttpServer(http.createServer(app));
    auxiliaryServer.once('error', (error) => handleServerListenError(error, PORT));
    auxiliaryServer.listen(PORT, () => {
      console.log(`HTTP (dev) sur http://localhost:${PORT}`);
    });
  }

  // HTTPS
  if (isDev || useDirectTls) {
    const tlsOptions = isDev
      ? getOrCreateCert()
      : { cert: fs.readFileSync(path.resolve(tlsCertPath)), key: fs.readFileSync(path.resolve(tlsKeyPath)) };
    server = configureHttpServer(https.createServer(tlsOptions, app));
    server.once('error', (error) => handleServerListenError(error, HTTPS_PORT));
    server.listen(HTTPS_PORT, () => {
    console.log(`HTTPS sur https://localhost:${HTTPS_PORT}`);
    if (isDev) console.log(`⚠️  Certificat auto-signé — ajoutez une exception dans le navigateur`);
    });
  }

  // WebSocket for real-time multi-user (must be after server is created)
  const { setupWebSocket } = await import('./backend/websocket.js');
  // En développement, utilisateurs et Vite passent par HTTP 3001.
  // En production, WebSocket suit le serveur principal exposé.
  const realtimeServer = isDev ? auxiliaryServer : server;
  websocketServer = await setupWebSocket(realtimeServer);
  const { startMailSyncService } = await import('./backend/mail-sync-service.js');
  stopMailSync = startMailSyncService();

  // Auto-backup every 6 hours
  const { scheduleBackup } = await import('./backend/backup-service.js');
  backupTimer = scheduleBackup();

  const { cleanupBlacklist } = await import('./backend/auth.js');
  const { dbRun } = await import('./backend/db.js');
  const runMaintenance = () => {
    cleanupBlacklist();
    dbRun("DELETE FROM audit_log WHERE created_at < datetime('now', ?)", [`-${AUDIT_RETENTION_DAYS} days`]);
  };
  runMaintenance();
  maintenanceTimer = setInterval(runMaintenance, 6 * 60 * 60 * 1000);
  maintenanceTimer.unref();
}

async function shutdown(signal) {
  console.log(`Arret controle: ${signal}`);
  if (backupTimer) clearInterval(backupTimer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  if (stopMonitoring) stopMonitoring();
  if (stopSiteAgentAutonomy) stopSiteAgentAutonomy();
  if (stopMailSync) stopMailSync();
  if (websocketServer) websocketServer.close();
  const closeServer = (instance) => new Promise((resolve) => {
    if (!instance?.listening) return resolve();
    instance.close(() => resolve());
    setTimeout(resolve, 5000).unref();
  });
  await Promise.all([closeServer(server), closeServer(auxiliaryServer)]);
  const { closeDB } = await import('./backend/db.js');
  closeDB();
  process.exit(0);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

startServer().catch(err => {
  console.error('Erreur au démarrage:', err);
  process.exit(1);
});

module.exports = app;
