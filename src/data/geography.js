/**
 * geography.js – EU/Schengen-maaluettelot ja äänestysalueen tarkistus.
 *
 * Maat luetaan geography.json-tiedostosta, jota voi päivittää
 * ilman koodimuutoksia kun uusia maita liittyy.
 *
 * Äänestyksen laajuus (scope):
 *   'world'    – kaikki rekisteröityneet käyttäjät
 *   'schengen' – Schengen-alueen maat
 *   'eu'       – EU-maat
 *   'country'  – tietty maa  (scopeCountry vaaditaan)
 *   'region'   – tietty maakunta  (scopeCountry + scopeRegion vaaditaan)
 *   'city'     – tietty kaupunki  (scopeCountry + scopeRegion + scopeCity vaaditaan)
 */

const path = require('path');
const geoData = require(path.join(__dirname, 'geography.json'));

// Liitot ovat kaikki JSON:n avaimet (paitsi _comment)
const ALLIANCES = Object.fromEntries(
  Object.entries(geoData).filter(([k]) => !k.startsWith('_'))
);

// Vanhat exportit yhteensopivuuden vuoksi
const EU_COUNTRIES       = ALLIANCES.eu       || [];
const SCHENGEN_COUNTRIES = ALLIANCES.schengen  || [];

// Dynaamiset scope-arvot: liittojen nimet + paikalliset tasot
const GEOGRAPHIC_SCOPES = ['world', 'country', 'region', 'city'];
const ALLIANCE_SCOPES   = Object.keys(ALLIANCES);
const VALID_SCOPES      = [...GEOGRAPHIC_SCOPES, ...ALLIANCE_SCOPES];

/** Normalisoi merkkijonon vertailua varten (lowercase + trim). */
function norm(str) {
  return String(str || '').trim().toLowerCase();
}

/**
 * Tarkistaa onko käyttäjä oikeutettu äänestämään kyseisessä äänestyksessä.
 *
 * @param {{ country: string, region: string, city: string }} user
 * @param {{ scope: string, scopeCountry?: string, scopeRegion?: string, scopeCity?: string }} poll
 * @returns {boolean}
 */
function isEligible(user, poll) {
  switch (poll.scope) {
    case 'world':
      return true;
    case 'country':
      return norm(user.country) === norm(poll.scopeCountry);
    case 'region':
      return (
        norm(user.country) === norm(poll.scopeCountry) &&
        norm(user.region)  === norm(poll.scopeRegion)
      );
    case 'city':
      return (
        norm(user.country) === norm(poll.scopeCountry) &&
        norm(user.region)  === norm(poll.scopeRegion)  &&
        norm(user.city)    === norm(poll.scopeCity)
      );
    default:
      // Dynaaminen liittotarkistus: onko käyttäjän maa kyseisen liiton jäsen?
      if (ALLIANCES[poll.scope]) {
        return ALLIANCES[poll.scope].some((c) => norm(c) === norm(user.country));
      }
      return false;
  }
}

/**
 * Validoi äänestyksen scope-kentät.
 * Palauttaa virheviestin tai null jos ok.
 */
function validateScope(scope, scopeCountry, scopeRegion, scopeCity) {
  if (!VALID_SCOPES.includes(scope)) {
    return `scope täytyy olla jokin seuraavista: ${VALID_SCOPES.join(', ')}`;
  }
  if (['country', 'region', 'city'].includes(scope) && !scopeCountry) {
    return 'scopeCountry vaaditaan tällä scope-tasolla.';
  }
  if (['region', 'city'].includes(scope) && !scopeRegion) {
    return 'scopeRegion vaaditaan tällä scope-tasolla.';
  }
  if (scope === 'city' && !scopeCity) {
    return 'scopeCity vaaditaan scope=city:llä.';
  }
  return null;
}

module.exports = { EU_COUNTRIES, SCHENGEN_COUNTRIES, VALID_SCOPES, isEligible, validateScope };
