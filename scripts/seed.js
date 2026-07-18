const bcrypt = require('bcryptjs');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function seed() {
  const { getDb } = require('../src/db');
  const db = getDb();

  const existing = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (existing) {
    console.log('Un admin existe déjà (id=' + existing.id + ').');
    console.log('Pour réinitialiser : supprimez le fichier data/intelsheets.db');
    return;
  }

  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hashed = await bcrypt.hash(password, 10);

  db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run('admin', hashed, 'admin');
  console.log('✅ Admin créé : admin / ' + password);
  console.log('⚠️  Changez le mot de passe en modifiant ADMIN_PASSWORD dans .env, puis relancez ce script.');
}

seed().catch(console.error);
