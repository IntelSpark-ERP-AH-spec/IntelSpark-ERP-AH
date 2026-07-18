import crypto from 'crypto';

const PREFIX = 'enc:v1';
const AAD = Buffer.from('intelsheets:secret:v1', 'utf8');

function keyMaterial() {
  const material = process.env.DATA_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
  if (material.length < 32) {
    throw new Error('DATA_ENCRYPTION_KEY doit contenir au moins 32 caracteres');
  }
  return crypto.createHash('sha256').update(material, 'utf8').digest();
}

export function isEncryptedSecret(value) {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:`);
}

export function encryptSecret(value) {
  if (value === null || value === undefined || value === '') return '';
  if (isEncryptedSecret(value)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptSecret(value) {
  if (value === null || value === undefined || value === '') return '';
  if (!isEncryptedSecret(value)) return String(value);
  const parts = value.split(':');
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== PREFIX) {
    throw new Error('Format secret chiffre invalide');
  }
  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const ciphertext = Buffer.from(parts[4], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(), iv);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function upgradeSecret(value) {
  if (!value || isEncryptedSecret(value)) return value || '';
  return encryptSecret(value);
}
