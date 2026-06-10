/**
 * admins.js – lukee ja kirjoittaa admins.json-tiedostoa.
 *
 * admins.json-rakenne:
 * {
 *   "matti": { "hash": "$2b$12$...", "role": "superadmin" },
 *   "liisa": { "hash": "$2b$12$...", "role": "admin" }
 * }
 *
 * Roolit: "admin" | "superadmin"
 * Tiedosto luodaan tyhjänä jos sitä ei ole.
 */

const bcrypt = require('bcrypt');
const { getDb } = require('./firebase');

const BCRYPT_ROUNDS = 12;

// Firestore collection name for admins
const ADMINS_COLLECTION = 'admins';

/** Lisää tai päivittää adminin. role = 'admin' | 'superadmin' */
async function upsertAdmin(username, plainPassword, role = 'admin') {
  if (!['admin', 'superadmin'].includes(role)) {
    throw new Error('Rooli täytyy olla "admin" tai "superadmin".');
  }
  const hash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
  const db = getDb();
  const docRef = db.collection(ADMINS_COLLECTION).doc(String(username).trim().toLowerCase());
  await docRef.set({ hash, role }, { merge: true });
  return hash;
}

/** Tarkistaa käyttäjänimen ja salasanan. Palauttaa roolin tai null. */
async function verifyAdmin(username, plainPassword) {
  const db = getDb();
  const doc = await db.collection(ADMINS_COLLECTION).doc(String(username).trim().toLowerCase()).get();
  if (!doc.exists) return null;
  const entry = doc.data();
  const match = await bcrypt.compare(plainPassword, entry.hash);
  return match ? entry.role : null;
}

async function getAdminEntry(username) {
  const db = getDb();
  const doc = await db.collection(ADMINS_COLLECTION).doc(String(username).trim().toLowerCase()).get();
  return doc.exists ? doc.data() : null;
}

async function setAdminField(username, key, value) {
  const db = getDb();
  const docRef = db.collection(ADMINS_COLLECTION).doc(String(username).trim().toLowerCase());
  const obj = {};
  obj[key] = value;
  await docRef.set(obj, { merge: true });
}

async function getLastCreatedAt(username) {
  const entry = await getAdminEntry(username);
  return entry && entry.lastCreatedAt ? entry.lastCreatedAt : null;
}

async function setLastCreatedAt(username, isoString) {
  await setAdminField(username, 'lastCreatedAt', isoString);
}

module.exports = { upsertAdmin, verifyAdmin, getAdminEntry, setAdminField, getLastCreatedAt, setLastCreatedAt };
