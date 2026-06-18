const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { initFirebase, getDb } = require('../src/services/firebase');

(async () => {
  try {
    initFirebase();
    const db = getDb();
    const snap = await db.collection('admins').get();
    if (snap.empty) {
      console.log('No admins found.');
      return;
    }
    console.log('Admins:');
    snap.forEach(doc => {
      const data = doc.data();
      console.log(`- ${doc.id}:`, { role: data.role, lastCreatedAt: data.lastCreatedAt });
    });
  } catch (err) {
    console.error('Error listing admins:', err);
    process.exitCode = 2;
  }
})();
