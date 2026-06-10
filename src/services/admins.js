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

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const ADMINS_FILE = path.join(__dirname, '..', '..', 'admins.json');
const BCRYPT_ROUNDS = 12;

function loadAdmins() {
  if (!fs.existsSync(ADMINS_FILE)) {
    fs.writeFileSync(ADMINS_FILE, JSON.stringify({}), 'utf8');
  }
  try {
    return JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAdmins(admins) {
  fs.writeFileSync(ADMINS_FILE, JSON.stringify(admins, null, 2), 'utf8');
}

/** Lisää tai päivittää adminin. role = 'admin' | 'superadmin' */
async function upsertAdmin(username, plainPassword, role = 'admin') {
  if (!['admin', 'superadmin'].includes(role)) {
    throw new Error('Rooli täytyy olla "admin" tai "superadmin".');
  }
  const admins = loadAdmins();
  const hash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
  admins[username.trim().toLowerCase()] = { hash, role };
  saveAdmins(admins);
  return hash;
}

/** Tarkistaa käyttäjänimen ja salasanan. Palauttaa roolin tai null. */
async function verifyAdmin(username, plainPassword) {
  const admins = loadAdmins();
  const entry = admins[username.trim().toLowerCase()];
  if (!entry) return null;
  const match = await bcrypt.compare(plainPassword, entry.hash);
  return match ? entry.role : null;
}

module.exports = { upsertAdmin, verifyAdmin };
