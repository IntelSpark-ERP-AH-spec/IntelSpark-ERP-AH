const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'security.log');

function ensureLogDir() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(event, details = {}) {
  try {
    ensureLogDir();
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${event} | IP: ${details.ip || '-'} | User: ${details.user || '-'} | ${details.msg || ''}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {
    // silencieux
  }
}

function logAuth(ip, username, success, msg = '') {
  log('AUTH', { ip, user: username, msg: `${success ? 'SUCCÈS' : 'ÉCHEC'} - ${msg}` });
}

function logAction(ip, username, action, details = '') {
  log('ACTION', { ip, user: username, msg: `${action} - ${details}` });
}

module.exports = { log, logAuth, logAction };
