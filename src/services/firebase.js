const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

let db;

function initFirebase() {
  if (getApps().length > 0) return;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? require(require('path').resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH))
    : JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  initializeApp({
    credential: cert(serviceAccount),
  });

  db = getFirestore();
}

function getDb() {
  if (!db) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return db;
}

module.exports = { initFirebase, getDb };
