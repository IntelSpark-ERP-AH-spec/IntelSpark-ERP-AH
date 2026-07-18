import test from 'node:test';
import assert from 'node:assert/strict';
import { translateSql } from '../backend/postgres-compat.js';

test('convertit paramètres sans toucher aux chaînes', () => {
  assert.equal(
    translateSql("SELECT '?' AS literal, id FROM users WHERE id = ? AND role = ?"),
    "SELECT '?' AS literal, id FROM users WHERE id = $1 AND role = $2",
  );
});

test('convertit fonctions temporelles SQLite', () => {
  const sql = translateSql("DELETE FROM events WHERE datetime(created_at) < datetime('now', ?)", { returning: true });
  assert.match(sql, /created_at < to_char\(CURRENT_TIMESTAMP \+ \(\$1::text\)::interval/);
  assert.match(sql, /RETURNING \*$/);
});

test('convertit INSERT OR IGNORE', () => {
  assert.equal(
    translateSql('INSERT OR IGNORE INTO locks (id, value) VALUES (?, ?)', { returning: true }),
    'INSERT INTO locks (id, value) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
  );
});

test('convertit pragma_table_info', () => {
  const sql = translateSql("SELECT name FROM pragma_table_info('users')");
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /table_name = 'users'/);
});

test('convertit regroupements mensuels', () => {
  assert.equal(
    translateSql("SELECT strftime('%Y-%m', created_at) AS mois FROM messages"),
    "SELECT to_char((created_at)::timestamp, 'YYYY-MM') AS mois FROM messages",
  );
});
