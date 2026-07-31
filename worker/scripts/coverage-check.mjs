#!/usr/bin/env node
/**
 * Coverage gate for P0/P1/P2 frontend routes vs Worker.
 * Prefer: npm run coverage:check (vitest).
 * This script mirrors the same report for CI logs without TypeScript loader.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(root, '..');
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitest', 'run', 'src/coverage.test.ts'],
  { cwd: workerRoot, stdio: 'inherit', shell: false },
);
process.exit(result.status ?? 1);
