import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PDF_DIR = (process.env.NETLIFY === 'true' || process.env.AWS_LAMBDA_FUNCTION_NAME)
  ? path.join('/tmp', 'message-pdfs')
  : path.resolve(MODULE_DIR, 'uploads', 'message-pdfs');
const PDF_UPLOAD_DIR = path.resolve(process.env.MESSAGE_PDF_DIR || DEFAULT_PDF_DIR);

mkdirSync(PDF_UPLOAD_DIR, { recursive: true });

export function messagePdfPath(fileId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(fileId || ''))) return null;
  return path.join(PDF_UPLOAD_DIR, `${fileId}.pdf`);
}

export function messagePdfExists(fileId) {
  const filePath = messagePdfPath(fileId);
  return Boolean(filePath && existsSync(filePath));
}

export function writeMessagePdf(fileId, bytes) {
  const filePath = messagePdfPath(fileId);
  if (!filePath) throw new Error('Identifiant PDF invalide');
  writeFileSync(filePath, bytes, { flag: 'wx' });
  return filePath;
}

export function deleteMessagePdf(fileId) {
  const filePath = messagePdfPath(fileId);
  if (!filePath || !existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}
