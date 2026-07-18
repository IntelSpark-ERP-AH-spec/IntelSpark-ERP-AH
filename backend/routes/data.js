import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbGet, dbQuery, dbRun, dbTransaction } from '../db.js';
import { authMiddleware } from '../auth.js';

const router = Router();
router.use(authMiddleware);

// Récupère la map user_data de l'utilisateur (objet JSON complet)
function usesKeyValueStorage() {
  return !dbGet("SELECT 1 AS found FROM pragma_table_info('user_data') WHERE name='data_json'");
}

async function getUserMap(userId) {
  try {
    if (usesKeyValueStorage()) {
      const map = {};
      for (const row of dbQuery('SELECT key, value FROM user_data WHERE user_id=?', [userId])) {
        try { map[row.key] = JSON.parse(row.value); }
        catch { map[row.key] = row.value; }
      }
      return map;
    }
    const row = dbGet('SELECT data_json FROM user_data WHERE user_id = ?', [userId]);
    if (row && row.data_json) {
      const parsed = JSON.parse(row.data_json);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    }
  } catch (e) {
    console.error('[user_data] parse error for', userId, e.message);
  }
  return {};
}

async function setUserMap(userId, map) {
  if (usesKeyValueStorage()) {
    dbTransaction(() => {
      dbRun('DELETE FROM user_data WHERE user_id=?', [userId]);
      for (const [key, value] of Object.entries(map || {})) {
        const storedValue = typeof value === 'string' ? value : JSON.stringify(value);
        dbRun("INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?,?,?,datetime('now'))", [userId, key, storedValue]);
      }
    });
    return;
  }
  const json = JSON.stringify(map || {});
  const existing = dbGet('SELECT id FROM user_data WHERE user_id = ?', [userId]);
  if (existing) {
    dbRun('UPDATE user_data SET data_json = ?, updated_at = datetime(\'now\') WHERE user_id = ?', [json, userId]);
  } else {
    dbRun('INSERT INTO user_data (id, user_id, data_json) VALUES (?, ?, ?)', [uuidv4(), userId, json]);
  }
}

const KEY_RE = /^[a-zA-Z0-9_]{1,50}$/;
const MAX_VALUE_BYTES = 5 * 1024 * 1024;

function parseStoredJson(value, fallback = null) {
  try { return value === null || value === undefined ? fallback : JSON.parse(value); }
  catch { return fallback; }
}

function getDocument(userId, key) {
  const row = dbGet('SELECT value_json FROM user_documents WHERE user_id = ? AND key = ?', [userId, key]);
  return row ? parseStoredJson(row.value_json) : undefined;
}

function setDocument(userId, key, value) {
  const json = JSON.stringify(value);
  dbRun(`INSERT INTO user_documents (user_id, key, value_json, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, key) DO UPDATE SET value_json=excluded.value_json, updated_at=datetime('now')`,
  [userId, key, json]);
}

function teamKeyFor(user) {
  return String(user.department || user.role || 'general').trim().toLowerCase();
}

// ── Legacy : save / load complets ────────────────────────────────────────────
router.post('/save', async (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ error: 'Données invalides' });
    }
    const keys = Object.keys(data);
    if (keys.length > 100) return res.status(400).json({ error: `Trop de clés (max 100)` });
    for (const [k, v] of Object.entries(data)) {
      if (!KEY_RE.test(k)) return res.status(400).json({ error: `Nom de clé invalide: ${k}` });
      const jsonStr = JSON.stringify(v);
      if (jsonStr.length > MAX_VALUE_BYTES) return res.status(400).json({ error: `Valeur trop grande pour: ${k}` });
    }
    dbTransaction(() => {
      for (const [key, value] of Object.entries(data)) setDocument(req.user.id, key, value);
    });
    res.json({ success: true });
  } catch (e) {
    console.error('[user_data /save]', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/load', async (req, res) => {
  try {
    const map = await getUserMap(req.user.id);
    for (const row of dbQuery('SELECT key, value_json FROM user_documents WHERE user_id = ?', [req.user.id])) {
      map[row.key] = parseStoredJson(row.value_json);
    }
    res.json(map);
  } catch (e) {
    console.error('[user_data /load]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Endpoints optimisés par clé (utilisés par useUserDoc) ────────────────────
router.get('/doc/:key', async (req, res) => {
  try {
    if (!KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Clé invalide' });
    const stored = getDocument(req.user.id, req.params.key);
    if (stored !== undefined) return res.json(stored);
    const legacyMap = await getUserMap(req.user.id);
    const legacyValue = legacyMap[req.params.key];
    if (legacyValue !== undefined) setDocument(req.user.id, req.params.key, legacyValue);
    res.json(legacyValue !== undefined ? legacyValue : null);
  } catch (e) {
    console.error('[user_data /doc GET]', e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/doc/:key', async (req, res) => {
  try {
    if (!KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Clé invalide' });
    const value = req.body;
    const jsonStr = JSON.stringify(value);
    if (jsonStr.length > MAX_VALUE_BYTES) return res.status(400).json({ error: 'Valeur trop grande' });

    setDocument(req.user.id, req.params.key, value);
    res.json({ success: true });
  } catch (e) {
    console.error('[user_data /doc PUT]', e);
    res.status(500).json({ error: e.message });
  }
});

router.delete('/doc/:key', async (req, res) => {
  try {
    if (!KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Clé invalide' });
    dbRun('DELETE FROM user_documents WHERE user_id = ? AND key = ?', [req.user.id, req.params.key]);
    res.json({ success: true });
  } catch (e) {
    console.error('[user_data /doc DELETE]', e);
    res.status(500).json({ error: e.message });
  }
});

// Données synchronisées entre utilisateurs appartenant au même département.
router.get('/team/:key', (req, res) => {
  try {
    if (!KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Clé invalide' });
    const teamKey = teamKeyFor(req.user);
    const row = dbGet('SELECT value_json, updated_at, version FROM team_documents WHERE team_key = ? AND key = ?', [teamKey, req.params.key]);
    res.json(row
      ? { value: parseStoredJson(row.value_json), updated_at: row.updated_at, version: Number(row.version || 1), team: teamKey }
      : { value: null, version: 0, team: teamKey });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/team/:key', (req, res) => {
  try {
    if (!KEY_RE.test(req.params.key)) return res.status(400).json({ error: 'Clé invalide' });
    if (!req.body || typeof req.body !== 'object' || !Object.prototype.hasOwnProperty.call(req.body, 'value')) {
      return res.status(400).json({ error: 'value et expected_version requis' });
    }
    const expectedVersion = Number(req.body.expected_version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(400).json({ error: 'expected_version invalide' });
    }
    const json = JSON.stringify(req.body.value);
    if (json.length > MAX_VALUE_BYTES) return res.status(400).json({ error: 'Valeur trop grande' });
    const teamKey = teamKeyFor(req.user);
    const result = dbTransaction(() => {
      const current = dbGet('SELECT version FROM team_documents WHERE team_key = ? AND key = ?', [teamKey, req.params.key]);
      const currentVersion = Number(current?.version || 0);
      if (currentVersion !== expectedVersion) return { conflict: true, currentVersion };
      if (!current) {
        dbRun(`INSERT INTO team_documents (team_key, key, value_json, updated_by, version, updated_at)
          VALUES (?, ?, ?, ?, 1, datetime('now'))`, [teamKey, req.params.key, json, req.user.id]);
        return { version: 1 };
      }
      dbRun(`UPDATE team_documents SET value_json = ?, updated_by = ?, version = version + 1,
        updated_at = datetime('now') WHERE team_key = ? AND key = ? AND version = ?`,
      [json, req.user.id, teamKey, req.params.key, expectedVersion]);
      return { version: expectedVersion + 1 };
    });
    if (result.conflict) {
      return res.status(409).json({ error: 'Conflit de modification', current_version: result.currentVersion });
    }
    res.json({ success: true, team: teamKey, version: result.version });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
