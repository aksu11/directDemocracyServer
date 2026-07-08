const geoip = require('geoip-lite');

/**
 * geoIp.js – IP-osoitteen maantieteellinen tunnistus (toinen suojauskerros
 * käyttäjän itsensä ilmoittaman maan lisäksi, ks. data/geography.js).
 *
 * Tämä ei estä VPN:n käyttöä, mutta nostaa kynnystä ja mahdollistaa
 * äänten maajakauman seurannan admin-paneelista (ks. routes/admin.js
 * GET /polls/:pollId/geo).
 */

/**
 * Palauttaa IP-osoitteen ISO 3166-1 alpha-2 -maakoodin, tai null jos
 * osoitetta ei tunnisteta (esim. yksityinen/paikallinen osoite tai
 * tuntematon IP geoip-tietokannassa).
 *
 * @param {string} ip - esim. req.ip (voi olla IPv4, IPv6 tai IPv4-mapped IPv6)
 * @returns {string|null}
 */
function lookupCountry(ip) {
  if (!ip || typeof ip !== 'string') return null;

  // IPv4-mapped IPv6-osoitteet (esim. "::ffff:1.2.3.4") -> pelkkä IPv4-osa,
  // koska geoip-lite ei tunnista mapattua muotoa.
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  const geo = geoip.lookup(normalized);
  return geo?.country || null;
}

module.exports = { lookupCountry };
