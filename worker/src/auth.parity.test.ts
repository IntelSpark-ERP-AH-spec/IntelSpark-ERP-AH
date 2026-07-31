/**
 * Optional live parity check between Express and Worker auth contracts.
 * Skipped unless EXPRESS_API_URL and WORKER_API_URL are both set.
 *
 * Example:
 *   EXPRESS_API_URL=http://127.0.0.1:3001 WORKER_API_URL=http://127.0.0.1:8787 npm test
 */
import { describe, expect, it } from 'vitest';

const expressBase = String(process.env.EXPRESS_API_URL || '').replace(/\/+$/, '');
const workerBase = String(process.env.WORKER_API_URL || '').replace(/\/+$/, '');
const enabled = Boolean(expressBase && workerBase);

async function readJson(response: Response) {
  const text = await response.text();
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, body: text };
  }
}

describe.skipIf(!enabled)('live Express vs Worker auth parity', () => {
  it('matches invalid login contract', async () => {
    const payload = JSON.stringify({ username: '', password: '' });
    const [expressRes, workerRes] = await Promise.all([
      fetch(`${expressBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: payload,
      }).then(readJson),
      fetch(`${workerBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: payload,
      }).then(readJson),
    ]);

    expect(workerRes.status).toBe(expressRes.status);
    expect(workerRes.body).toEqual(expressRes.body);
  });

  it('matches unknown-user login contract', async () => {
    const payload = JSON.stringify({ username: '__parity_missing__', password: 'WrongPass123!' });
    const [expressRes, workerRes] = await Promise.all([
      fetch(`${expressBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: payload,
      }).then(readJson),
      fetch(`${workerBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: payload,
      }).then(readJson),
    ]);

    expect(workerRes.status).toBe(expressRes.status);
    expect(workerRes.body).toEqual(expressRes.body);
  });
});
