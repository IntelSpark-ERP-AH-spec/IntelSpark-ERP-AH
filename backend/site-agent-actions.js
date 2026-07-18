import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbQuery, dbRun } from './db.js';
import { getRuntimeConfig, setRuntimeConfig } from './runtime-config.js';

export const MANAGEABLE_PAGES = [
  'chiffrage', 'catalogue', 'stock', 'clients', 'pipeline', 'echeancier', 'reporting', 'hist', 'status', 'saved',
  'received_documents', 'magasin_reception', 'magasin_preparation', 'magasin_importation', 'magasin_expedition',
  'magasin_gestion', 'compta_journaux_achats', 'compta_journaux_ventes', 'compta_journaux_banque',
  'compta_journaux_od', 'compta_journaux_salaires', 'compta_journaux_tva', 'pcge', 'cpc', 'grand_livre',
  'fec_marocain', 'tva_taxes', 'rh_recrutement', 'rh_admin_paie', 'suivi_temps', 'temps_absences', 'notes_frais',
  'bulletins', 'rh_developpement', 'rh_relations', 'vehicules', 'maintenance', 'atelier', 'pneus', 'fournisseurs',
  'commandes_achat', 'reporting_global',
];

const ROLES = ['admin', 'commercial', 'magasinier', 'rh', 'comptable', 'financier', 'technicien', 'employe'];

export const ACTION_CATALOG = {
  set_system_announcement: { label: 'Modifier annonce système', risk: 'medium' },
  set_maintenance_mode: { label: 'Changer mode maintenance', risk: 'high' },
  set_page_availability: { label: 'Changer disponibilité page', risk: 'high' },
  revoke_user_sessions: { label: 'Révoquer sessions utilisateur', risk: 'medium' },
  set_user_active: { label: 'Changer accès utilisateur', risk: 'high' },
  resolve_system_alert: { label: 'Résoudre alerte système', risk: 'low' },
  notify_role: { label: 'Notifier équipe', risk: 'medium' },
};

function cleanText(value, maximum) {
  const text = String(value || '').trim();
  if (!text || text.length > maximum) throw new Error('Texte action invalide');
  return text;
}

function booleanValue(value, field) {
  if (typeof value !== 'boolean') throw new Error(`${field} booléen requis`);
  return value;
}

export function normalizeAction(type, rawPayload = {}) {
  const definition = ACTION_CATALOG[type];
  if (!definition) throw new Error('Type action non autorisé');
  const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload) ? rawPayload : {};

  switch (type) {
    case 'set_system_announcement':
      return { definition, payload: { message: String(payload.message || '').trim().slice(0, 500) } };
    case 'set_maintenance_mode':
      return { definition, payload: { enabled: booleanValue(payload.enabled, 'enabled') } };
    case 'set_page_availability': {
      const pageId = cleanText(payload.page_id, 64);
      if (!MANAGEABLE_PAGES.includes(pageId)) throw new Error('Page non contrôlable');
      return { definition, payload: { page_id: pageId, enabled: booleanValue(payload.enabled, 'enabled') } };
    }
    case 'revoke_user_sessions':
      return { definition, payload: { username: cleanText(payload.username, 120) } };
    case 'set_user_active':
      return { definition, payload: { username: cleanText(payload.username, 120), active: booleanValue(payload.active, 'active') } };
    case 'resolve_system_alert':
      return { definition, payload: { alert_id: cleanText(payload.alert_id, 120) } };
    case 'notify_role': {
      const role = cleanText(payload.role, 40);
      if (role !== 'all' && !ROLES.includes(role)) throw new Error('Rôle destinataire invalide');
      return {
        definition,
        payload: {
          role,
          title: cleanText(payload.title, 120),
          message: cleanText(payload.message, 1000),
        },
      };
    }
    default:
      throw new Error('Action inconnue');
  }
}

export function serializeAction(row) {
  if (!row) return row;
  let payload = {};
  let result = null;
  try { payload = JSON.parse(row.payload_json || '{}'); } catch {}
  try { result = row.result_json ? JSON.parse(row.result_json) : null; } catch {}
  const { payload_json, result_json, ...action } = row;
  return { ...action, payload, result };
}

export function createActionProposal({ type, payload, reason, source = 'ai', createdBy = null }) {
  const normalized = normalizeAction(type, payload);
  const cleanReason = cleanText(reason || 'Action proposée par responsable IA.', 1000);
  const id = uuidv4();
  dbRun(`INSERT INTO site_agent_actions
    (id, type, label, reason, payload_json, risk, source, created_by)
    VALUES (?,?,?,?,?,?,?,?)`,
  [id, type, normalized.definition.label, cleanReason, JSON.stringify(normalized.payload), normalized.definition.risk,
    source === 'manual' ? 'manual' : 'ai', createdBy]);
  return serializeAction(dbGet('SELECT * FROM site_agent_actions WHERE id = ?', [id]));
}

export function listActions(limit = 100) {
  return dbQuery(`SELECT * FROM site_agent_actions
    ORDER BY CASE status WHEN 'proposed' THEN 0 ELSE 1 END, created_at DESC LIMIT ?`, [Math.min(Math.max(Number(limit) || 100, 1), 200)])
    .map(serializeAction);
}

export function actionCapabilities() {
  return {
    pages: MANAGEABLE_PAGES,
    disabled_pages: getRuntimeConfig('disabled_pages', []),
    roles: ['all', ...ROLES],
    users: dbQuery(`SELECT username, role, active FROM users WHERE role != 'admin' ORDER BY username LIMIT 500`),
    alerts: dbQuery(`SELECT id, severity, source, message, created_at FROM system_alerts
      WHERE resolved = 0 ORDER BY created_at DESC LIMIT 100`),
  };
}

function userTarget(username) {
  const user = dbGet('SELECT id, username, role, active FROM users WHERE lower(username) = lower(?)', [username]);
  if (!user) throw new Error('Utilisateur introuvable');
  if (user.role === 'admin') throw new Error('Comptes administrateurs protégés');
  return user;
}

export function executeAction(action, admin) {
  const normalized = normalizeAction(action.type, action.payload);
  const payload = normalized.payload;
  let result;

  switch (action.type) {
    case 'set_system_announcement':
      result = setRuntimeConfig('system_announcement', payload.message, admin.id);
      break;
    case 'set_maintenance_mode':
      result = setRuntimeConfig('maintenance_mode', payload.enabled, admin.id);
      break;
    case 'set_page_availability': {
      const disabled = new Set(getRuntimeConfig('disabled_pages', []));
      if (payload.enabled) disabled.delete(payload.page_id);
      else disabled.add(payload.page_id);
      const disabledPages = MANAGEABLE_PAGES.filter((page) => disabled.has(page));
      setRuntimeConfig('disabled_pages', disabledPages, admin.id);
      result = { page_id: payload.page_id, enabled: payload.enabled, disabled_pages: disabledPages };
      break;
    }
    case 'revoke_user_sessions': {
      const user = userTarget(payload.username);
      dbRun('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [user.id]);
      result = { username: user.username, sessions_revoked: true };
      break;
    }
    case 'set_user_active': {
      const user = userTarget(payload.username);
      dbRun('UPDATE users SET active = ?, token_version = token_version + 1 WHERE id = ?', [payload.active ? 1 : 0, user.id]);
      result = { username: user.username, active: payload.active };
      break;
    }
    case 'resolve_system_alert': {
      const update = dbRun(`UPDATE system_alerts SET resolved = 1, resolved_by = ?, resolved_at = datetime('now')
        WHERE id = ? AND resolved = 0`, [admin.id, payload.alert_id]);
      if (!update.changes) throw new Error('Alerte introuvable ou déjà résolue');
      result = { alert_id: payload.alert_id, resolved: true };
      break;
    }
    case 'notify_role': {
      const recipients = payload.role === 'all'
        ? dbQuery('SELECT id FROM users WHERE active = 1')
        : dbQuery('SELECT id FROM users WHERE active = 1 AND role = ?', [payload.role]);
      for (const recipient of recipients) {
        dbRun(`INSERT INTO notifications (id, user_id, type, title, message) VALUES (?,?,?,?,?)`,
          [uuidv4(), recipient.id, 'site_agent', payload.title, payload.message]);
      }
      result = { role: payload.role, recipients: recipients.length };
      break;
    }
    default:
      throw new Error('Action non exécutable');
  }

  dbRun(`INSERT INTO audit_log
    (id, user_id, username, action, resource, resource_id, details, severity)
    VALUES (?,?,?,?,?,?,?,?)`,
  [uuidv4(), admin.id, admin.username, 'SITE_AGENT_ACTION_EXECUTED', 'site_agent', action.id,
    JSON.stringify({ type: action.type, result }).slice(0, 2000), action.risk === 'high' ? 'warning' : 'info']);
  return result;
}
