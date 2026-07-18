import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { dbRun } from './db.js';

function requiredConfig() {
  const bucket = process.env.S3_BACKUP_BUCKET;
  const region = process.env.S3_BACKUP_REGION;
  if (!bucket || !region) throw new Error('S3_BACKUP_BUCKET et S3_BACKUP_REGION requis');
  return { bucket, region };
}

function s3Client(region) {
  const options = { region };
  if (process.env.S3_BACKUP_ENDPOINT) {
    options.endpoint = process.env.S3_BACKUP_ENDPOINT;
    options.forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
  }
  if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    options.credentials = {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    };
  }
  return new S3Client(options);
}

function checksumFile(filepath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filepath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function uploadOffsiteBackup(filepath, filename = path.basename(filepath)) {
  const { bucket, region } = requiredConfig();
  if (!fs.existsSync(filepath)) throw new Error('Sauvegarde locale introuvable');
  const stats = fs.statSync(filepath);
  const checksum = await checksumFile(filepath);
  const prefix = String(process.env.S3_BACKUP_PREFIX || 'intelsheets').replace(/^\/+|\/+$/g, '');
  const day = new Date().toISOString().slice(0, 10);
  const remoteKey = `${prefix}/${day}/${filename}`;
  const id = uuidv4();

  try {
    const client = s3Client(region);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: remoteKey,
      Body: fs.createReadStream(filepath),
      ContentLength: stats.size,
      ContentType: 'application/vnd.sqlite3',
      ServerSideEncryption: process.env.S3_SERVER_SIDE_ENCRYPTION || 'AES256',
      Metadata: { sha256: checksum, source: 'intelsheets' },
    }));
    dbRun(`INSERT INTO offsite_backups
      (id, filename, provider, remote_key, checksum_sha256, size_bytes, status)
      VALUES (?, ?, 's3', ?, ?, ?, 'success')`, [id, filename, remoteKey, checksum, stats.size]);
    return { id, filename, provider: 's3', remote_key: remoteKey, checksum_sha256: checksum, size_bytes: stats.size };
  } catch (error) {
    dbRun(`INSERT INTO offsite_backups
      (id, filename, provider, remote_key, checksum_sha256, size_bytes, status, error)
      VALUES (?, ?, 's3', ?, ?, ?, 'error', ?)`, [id, filename, remoteKey, checksum, stats.size, error.message]);
    throw error;
  }
}
