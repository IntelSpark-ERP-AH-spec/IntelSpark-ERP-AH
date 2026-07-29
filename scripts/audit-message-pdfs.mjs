import 'dotenv/config';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const pdfDirectory = path.resolve(
  process.env.MESSAGE_PDF_DIR || path.join(process.cwd(), 'backend', 'uploads', 'message-pdfs'),
);
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  const { rows } = await client.query(`
    select doc_id
    from messages
    where doc_type = 'PDF' and doc_id is not null
  `);
  const referenced = new Set(rows.map(row => `${row.doc_id}.pdf`));
  const files = (await readdir(pdfDirectory, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isFile() && /^[0-9a-f-]{36}\.pdf$/i.test(entry.name))
    .map(entry => entry.name);
  const orphans = files.filter(name => !referenced.has(name));

  console.log(JSON.stringify({
    database_pdf_records: referenced.size,
    local_pdf_files: files.length,
    orphan_pdf_files: orphans.length,
  }));
} catch (error) {
  console.error(JSON.stringify({ code: String(error?.code || 'PDF_AUDIT_ERROR') }));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
