const { verifyAdmin } = require('../services/admins');

/**
 * Middleware: suojaa admin-reitit käyttäjänimi + bcrypt-salasanalla.
 *
 * Asiakas lähettää tunnukset Authorization-headerissa Base64-enkoodattuna:
 *   Authorization: Basic base64(username:password)
 *
 * bcrypt-vertailu on sisäänrakennetusti timing-safe.
 */
async function adminAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';

  if (!authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Authorization header puuttuu.' });
  }

  let username, password;
  try {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) throw new Error('invalid format');
    username = decoded.slice(0, colonIdx);
    password = decoded.slice(colonIdx + 1);
  } catch {
    return res.status(400).json({ error: 'Virheellinen Authorization-header.' });
  }

  if (!username || !password) {
    return res.status(401).json({ error: 'Käyttäjänimi tai salasana puuttuu.' });
  }

  const role = await verifyAdmin(username, password);
  if (!role) {
    return res.status(403).json({ error: 'Väärä käyttäjänimi tai salasana.' });
  }

  req.adminUser = username;
  req.adminRole = role;
  next();
}

module.exports = { adminAuth };
