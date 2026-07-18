import { Worker } from 'node:worker_threads';
const DATE_TIME_FORMAT = "'YYYY-MM-DD HH24:MI:SS'";

function replacePlaceholders(sql) {
  let index = 0;
  let quote = null;
  let output = '';

  for (let cursor = 0; cursor < sql.length; cursor += 1) {
    const char = sql[cursor];
    const next = sql[cursor + 1];
    if (quote) {
      output += char;
      if (char === quote) {
        if (next === quote) {
          output += next;
          cursor += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      output += char;
    } else if (char === '?') {
      index += 1;
      output += `$${index}`;
    } else {
      output += char;
    }
  }
  return output;
}

function appendReturning(sql) {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (!/^(INSERT|UPDATE|DELETE)\b/i.test(trimmed) || /\bRETURNING\b/i.test(trimmed)) return trimmed;
  return `${trimmed} RETURNING *`;
}

export function translateSql(source, { returning = false } = {}) {
  let sql = String(source || '').trim();
  sql = sql.replace(
    /pragma_table_info\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\)/gi,
    "(SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$1') AS pragma_table_info",
  );
  sql = sql.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT INTO');

  sql = sql.replace(/julianday\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');
  sql = sql.replace(/julianday\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/gi, '($1)::timestamp');

  sql = sql.replace(
    /datetime\(\s*'now'\s*,\s*\?\s*\)/gi,
    `to_char(CURRENT_TIMESTAMP + (?::text)::interval, ${DATE_TIME_FORMAT})`,
  );
  sql = sql.replace(
    /datetime\(\s*'now'\s*,\s*'([^']+)'\s*\)/gi,
    `to_char(CURRENT_TIMESTAMP + INTERVAL '$1', ${DATE_TIME_FORMAT})`,
  );
  sql = sql.replace(/datetime\(\s*'now'\s*\)/gi, `to_char(CURRENT_TIMESTAMP, ${DATE_TIME_FORMAT})`);
  sql = sql.replace(/datetime\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/gi, '$1');

  sql = sql.replace(
    /date\(\s*'now'\s*,\s*'([^']+)'\s*\)/gi,
    "to_char(CURRENT_DATE + INTERVAL '$1', 'YYYY-MM-DD')",
  );
  sql = sql.replace(/date\(\s*'now'\s*\)/gi, "to_char(CURRENT_DATE, 'YYYY-MM-DD')");

  sql = sql.replace(
    /strftime\(\s*'%Y-%m'\s*,\s*'now'\s*\)/gi,
    "to_char(CURRENT_TIMESTAMP, 'YYYY-MM')",
  );
  sql = sql.replace(
    /strftime\(\s*'%Y-%m'\s*,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/gi,
    "to_char(($1)::timestamp, 'YYYY-MM')",
  );

  if (/^INSERT\b/i.test(sql) && /\bINSERT\s+INTO\b/i.test(sql)
      && /\bOR\s+IGNORE\b/i.test(source) && !/\bON\s+CONFLICT\b/i.test(sql)) {
    sql = `${sql.replace(/;\s*$/, '')} ON CONFLICT DO NOTHING`;
  }
  sql = replacePlaceholders(sql);
  return returning ? appendReturning(sql) : sql.replace(/;\s*$/, '');
}

export function createPostgresAdapter(connectionString) {
  if (!connectionString) throw new Error('DATABASE_URL requis pour PostgreSQL');
  const queryTimeoutMillis = Math.max(1_000, Number(process.env.PG_QUERY_TIMEOUT_MS) || 30_000);
  const resultBufferBytes = Math.max(1024 * 1024, Number(process.env.PG_RESULT_BUFFER_BYTES) || 16 * 1024 * 1024);
  const worker = new Worker(new URL('./postgres-worker.js', import.meta.url), {
    workerData: { connectionString, connectionTimeoutMillis: 10_000 },
  });

  function invoke(payload) {
    const buffer = new SharedArrayBuffer(resultBufferBytes + 8);
    const control = new Int32Array(buffer, 0, 2);
    worker.postMessage({ ...payload, buffer });
    const waitResult = Atomics.wait(control, 0, 0, queryTimeoutMillis);
    if (waitResult === 'timed-out') throw new Error('Délai PostgreSQL dépassé');
    const length = Atomics.load(control, 1);
    const bytes = new Uint8Array(buffer, 8, length);
    const response = JSON.parse(new TextDecoder().decode(bytes));
    if (Atomics.load(control, 0) === 2) {
      const error = new Error(response.message || 'Erreur PostgreSQL');
      error.code = response.code;
      throw error;
    }
    return response.rows || [];
  }

  function query(sql, params = [], options = {}) {
    return invoke({ action: 'query', sql: translateSql(sql, options), params });
  }

  invoke({ action: 'query', sql: 'SELECT 1 AS ok', params: [] });

  return {
    engine: 'postgres',
    prepare(sql) {
      return {
        all: (...params) => query(sql, params),
        get: (...params) => query(sql, params)[0],
        run: (...params) => {
          const rows = query(sql, params, { returning: true });
          const insertedId = rows[0]?.id;
          return {
            changes: rows.length,
            lastInsertRowid: insertedId == null ? undefined : insertedId,
          };
        },
      };
    },
    exec(sql) {
      return invoke({ action: 'query', sql: translateSql(sql), params: [] });
    },
    transaction(fn) {
      return (...args) => {
        invoke({ action: 'query', sql: 'BEGIN', params: [] });
        try {
          const result = fn(...args);
          invoke({ action: 'query', sql: 'COMMIT', params: [] });
          return result;
        } catch (error) {
          try { invoke({ action: 'query', sql: 'ROLLBACK', params: [] }); } catch {}
          throw error;
        }
      };
    },
    pragma(statement, options = {}) {
      const normalized = String(statement || '').toLowerCase();
      if (normalized.startsWith('quick_check')) return options.simple ? 'ok' : [{ quick_check: 'ok' }];
      if (normalized.startsWith('wal_checkpoint')) return [{ busy: 0, log: 0, checkpointed: 0 }];
      return undefined;
    },
    close() {
      try { invoke({ action: 'close' }); } finally { worker.terminate(); }
    },
  };
}
