const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { initFirebase, getDb } = require('../src/services/firebase');

(async () => {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: node scripts/deleteAdmin.js <username>');
    process.exitCode = 1;
    return;
  }

  try {
    initFirebase();
    const db = getDb();
    const id = String(username).trim().toLowerCase();
    const docRef = db.collection('admins').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      console.log(`Admin '${id}' does not exist.`);
      return;
    }
    await docRef.delete();
    console.log(`Deleted admin '${id}'.`);
  } catch (err) {
    console.error('Error deleting admin:', err);
    process.exitCode = 2;
  }
})();
