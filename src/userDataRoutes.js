const express = require('express');
const router = express.Router();
const { getUserData, setUserData, getAllUserDataKeys } = require('./db');
const { sanitizeObject, sanitize, validateEmail, validateICE, validatePhone, validatePrice, validateQty, validateString } = require('./sanitize');
const { logAction } = require('./securityLog');

function getIp(req) {
  return req.ip || req.connection?.remoteAddress || 'inconnu';
}

const ALLOWED_KEYS = new Set([
  'is_theme', 'is_lang', 'is_currency', 'is_font_size', 'is_font_family', 'is_font_color',
  'is_company_name', 'is_company_address', 'is_company_phone', 'is_company_email', 'is_footer', 'is_logo',
  'is_brands', 'is_data_reset_version',
  'is_catalog', 'is_items', 'is_leads', 'is_clients', 'is_saved_docs', 'is_history_log',
  'is_doc_num', 'is_doc_status', 'is_doc_date', 'is_validity_date', 'is_client', 'is_client_ice',
  'is_rep', 'is_supplier', 'is_order_ref', 'is_payment', 'is_due_date', 'is_parent_fact',
  'is_counter_DEV', 'is_counter_BL', 'is_counter_BC', 'is_counter_FACT', 'is_counter_AVOIR',
]);
const RESET_LOCKED_KEYS = new Set([
  'is_catalog', 'is_items', 'is_leads', 'is_clients', 'is_saved_docs', 'is_history_log',
  'is_doc_num', 'is_doc_status', 'is_doc_date', 'is_validity_date', 'is_client', 'is_client_ice',
  'is_rep', 'is_supplier', 'is_order_ref', 'is_payment', 'is_due_date', 'is_parent_fact',
  'is_counter_DEV', 'is_counter_BL', 'is_counter_BC', 'is_counter_FACT', 'is_counter_AVOIR',
]);

// Validation spécifique selon la clé
function validateValue(key, value) {
  if (key === 'is_catalog' && Array.isArray(value)) {
    for (const item of value) {
      if (item.priceHT !== undefined && !validatePrice(item.priceHT)) return 'Prix invalide';
      if (item.stockPhysique !== undefined && !validateQty(item.stockPhysique)) return 'Stock invalide';
      if (item.stockReserve !== undefined && !validateQty(item.stockReserve)) return 'Stock réservé invalide';
      if (item.minStock !== undefined && !validateQty(item.minStock)) return 'Stock min invalide';
      if (item.name && !validateString(item.name, 200)) return 'Nom d\'article trop long';
      if (item.ref && !validateString(item.ref, 50)) return 'Référence trop longue';
      if (item.supplier && !validateString(item.supplier, 100)) return 'Fournisseur trop long';
      if (item.oem && !validateString(item.oem, 100)) return 'OEM trop long';
      if (item.compatible && !validateString(item.compatible, 200)) return 'Compatibilité trop longue';
      if (item.emplacement && !validateString(item.emplacement, 50)) return 'Emplacement trop long';
      if (item.category && !validateString(item.category, 100)) return 'Catégorie trop longue';
    }
    return null;
  }
  if (key === 'is_clients' && Array.isArray(value)) {
    for (const c of value) {
      if (c.ice && !validateICE(c.ice)) return 'ICE client invalide (15 chiffres requis)';
      if (c.email && c.email && !validateEmail(c.email)) return 'Email client invalide';
      if (c.phone && !validatePhone(c.phone)) return 'Téléphone client invalide';
      if (c.limiteCredit !== undefined && !validatePrice(c.limiteCredit)) return 'Limite crédit invalide';
      if (c.encours !== undefined && !validatePrice(c.encours)) return 'En-cours invalide';
      if (c.name && !validateString(c.name, 200)) return 'Nom client trop long';
    }
    return null;
  }
  if (key === 'is_saved_docs' && Array.isArray(value)) {
    for (const d of value) {
      if (d.totalHT !== undefined && !validatePrice(d.totalHT)) return 'Montant document invalide';
    }
    return null;
  }
  if (key === 'is_company_email' && value && !validateEmail(value)) return 'Email société invalide';
  if (key === 'is_company_phone' && value && !validatePhone(value)) return 'Téléphone société invalide';
  if (key === 'is_company_name' && typeof value === 'string' && value.length > 200) return 'Nom société trop long';
  if (key === 'is_client_ice' && value && !validateICE(value)) return 'ICE client invalide';

  return null;
}

function sanitizeValue(key, value) {
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'object' && item !== null) {
        const clean = { ...item };
        for (const k of Object.keys(clean)) {
          if (typeof clean[k] === 'string') clean[k] = sanitize(clean[k]);
        }
        return clean;
      }
      return item;
    });
  }
  if (typeof value === 'string') return sanitize(value);
  return value;
}

// Sauvegarder les données
router.post('/sync', (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;
  const ip = getIp(req);
  const { data } = req.body;

  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Données invalides' });
  }

  const saved = [];
  const serverResetVersion = String(getUserData(userId)?.is_data_reset_version || '');
  const clientResetVersion = String(data.is_data_reset_version || '');
  const resetLocked = Boolean(serverResetVersion && serverResetVersion !== clientResetVersion);

  for (const [key, value] of Object.entries(data)) {
    if (!ALLOWED_KEYS.has(key)) continue;
    if (resetLocked && RESET_LOCKED_KEYS.has(key)) continue;

    const cleanValue = sanitizeValue(key, value);
    const validationError = validateValue(key, cleanValue);
    if (validationError) {
      logAction(ip, username, 'SYNC_REJECTED', `${key}: ${validationError}`);
      continue;
    }

    setUserData(userId, key, cleanValue);
    saved.push(key);
  }

  if (saved.length > 0) {
    logAction(ip, username, 'SYNC', `${saved.length} clés sauvegardées`);
  }

  res.json({ message: 'Données synchronisées', saved: saved.length });
});

// Charger les données
router.get('/load', (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;
  const ip = getIp(req);
  const data = getUserData(userId);
  logAction(ip, username, 'LOAD', `${Object.keys(data).length} clés chargées`);
  res.json(data);
});

module.exports = router;
