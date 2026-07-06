/**
 * geography.js – äänestysalueen tarkistus.
 *
 * Äänestyksen laajuus (scope):
 *   'world'    – kaikki rekisteröityneet käyttäjät
 *   'country'  – tietty maa  (scopeCountry vaaditaan)
 *
 * Yksinkertaisuuden vuoksi äänestykset rajataan enintään maatasolle.
 * Kaupunki-, maakunta- ja liittokohtaiset (EU, Schengen, NATO, ym.)
 * äänestykset on poistettu. Käyttäjä rekisteröi laitteensa vain maan
 * kanssa, ja backend estää kaksoisäänestyksen laitetunnuksen (deviceHash)
 * perusteella.
 */

const GEOGRAPHIC_SCOPES = ['world', 'country'];
const VALID_SCOPES      = [...GEOGRAPHIC_SCOPES];

/** Poliittisesti merkittyjen äänestysten (isPolitical: true) vähimmäisikä. */
const MIN_POLITICAL_AGE = 18;

/** Normalisoi merkkijonon vertailua varten (lowercase + trim). */
function norm(str) {
  return String(str || '').trim().toLowerCase();
}

/**
 * Tarkistaa täyttääkö käyttäjä annetun vähimmäisiän syntymävuoden perusteella.
 * Palauttaa false jos syntymävuotta ei tunneta (ei rekisteröity sitä).
 *
 * @param {{ birthYear?: number }} user
 * @param {number} minAge
 * @returns {boolean}
 */
function hasMinimumAge(user, minAge) {
  if (!user || !user.birthYear) return false;
  const age = new Date().getFullYear() - Number(user.birthYear);
  return age >= minAge;
}

/**
 * Tarkistaa onko käyttäjä oikeutettu äänestämään kyseisessä äänestyksessä.
 *
 * @param {{ country: string, birthYear?: number }} user
 * @param {{ scope: string, scopeCountry?: string, isPolitical?: boolean }} poll
 * @returns {boolean}
 */
function isEligible(user, poll) {
  if (poll.isPolitical === true && !hasMinimumAge(user, MIN_POLITICAL_AGE)) {
    return false;
  }
  switch (poll.scope) {
    case 'world':
      return true;
    case 'country':
      return norm(user.country) === norm(poll.scopeCountry);
    default:
      return false;
  }
}

/**
 * Validoi äänestyksen scope-kentät.
 * Palauttaa virheviestin tai null jos ok.
 */
function validateScope(scope, scopeCountry) {
  if (!VALID_SCOPES.includes(scope)) {
    return `scope täytyy olla jokin seuraavista: ${VALID_SCOPES.join(', ')}`;
  }
  if (scope === 'country' && !scopeCountry) {
    return 'scopeCountry vaaditaan tällä scope-tasolla.';
  }
  return null;
}

module.exports = { GEOGRAPHIC_SCOPES, VALID_SCOPES, MIN_POLITICAL_AGE, isEligible, validateScope, hasMinimumAge };
