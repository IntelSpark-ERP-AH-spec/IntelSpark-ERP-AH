import { parentPort, workerData } from 'node:worker_threads';
import pg from 'pg';

const { Client } = pg;
const encoder = new TextEncoder();
const client = new Client({
  connectionString: workerData.connectionString,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: workerData.connectionTimeoutMillis,
});
const ready = client.connect();

function respond(buffer, status, payload) {
  const control = new Int32Array(buffer, 0, 2);
  const data = new Uint8Array(buffer, 8);
  let bytes = encoder.encode(JSON.stringify(payload));
  if (bytes.length > data.length) {
    status = 2;
    bytes = encoder.encode(JSON.stringify({ message: 'Résultat PostgreSQL trop volumineux' }));
  }
  data.set(bytes);
  Atomics.store(control, 1, bytes.length);
  Atomics.store(control, 0, status);
  Atomics.notify(control, 0);
}

parentPort.on('message', async ({ action, sql, params, buffer }) => {
  try {
    await ready;
    if (action === 'close') {
      await client.end();
      respond(buffer, 1, { rows: [] });
      return;
    }
    const result = await client.query(sql, params || []);
    const rows = Array.isArray(result) ? result.flatMap((entry) => entry.rows || []) : (result.rows || []);
    respond(buffer, 1, { rows });
  } catch (error) {
    respond(buffer, 2, {
      message: String(error?.message || 'Erreur PostgreSQL').replace(/postgresql:\/\/\S+/gi, '[redacted]'),
      code: error?.code || 'POSTGRES_ERROR',
    });
  }
});
