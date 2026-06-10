/**
 * Script: migrateAdminsToFirestore.js
 * Copies existing admins from admins.json into Firestore `admins` collection.
 * Usage: node scripts/migrateAdminsToFirestore.js
 * Note: ensure FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON is set in .env
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getDb } = require('../src/services/firebase');

async function main() {
  const file = path.join(__dirname, '..', 'admins.json');
  if (!fs.existsSync(file)) {
    console.error('admins.json not found at', file);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const db = getDb();
  const batch = db.batch();
  const now = new Date().toISOString();
  Object.keys(raw).forEach((username) => {
    const entry = raw[username];
    const docRef = db.collection('admins').doc(username);
    const data = {
      hash: entry.hash,
      role: entry.role || 'admin',
      lastCreatedAt: entry.lastCreatedAt || null,
      migratedAt: now
    };
    batch.set(docRef, data, { merge: true });
    console.log('Queued', username);
  });
  await batch.commit();
  console.log('Migration complete.');
}

main().catch(e => { console.error(e); process.exit(1); });
