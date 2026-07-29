import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

const root = process.cwd();
const environment = dotenv.parse(await readFile(path.join(root, '.env'), 'utf8'));
const sensitiveNames = [
  'DATABASE_URL',
  'JWT_SECRET',
  'SESSION_SECRET',
  'DATA_ENCRYPTION_KEY',
  'ADMIN_PASSWORD',
  'GROQ_API_KEY',
  'REDIS_URL',
  'SMTP_PASS',
  'IMAP_PASS',
  'S3_SECRET_ACCESS_KEY',
];

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(target));
    else files.push(target);
  }
  return files;
}

const distFiles = await filesBelow(path.join(root, 'frontend', 'dist'));
const candidates = [
  ...tracked.map(file => path.join(root, file)),
  ...distFiles,
];
const leaks = [];

for (const name of sensitiveNames) {
  const value = String(environment[name] || '');
  if (value.length < 8) continue;
  for (const file of candidates) {
    const content = await readFile(file).catch(() => null);
    if (content?.includes(Buffer.from(value))) {
      leaks.push({ variable: name, file: path.relative(root, file).replaceAll('\\', '/') });
    }
  }
}

console.log(JSON.stringify({
  checked_variables: sensitiveNames.filter(name => String(environment[name] || '').length >= 8).length,
  checked_files: candidates.length,
  leaks,
}));
if (leaks.length) process.exitCode = 1;
