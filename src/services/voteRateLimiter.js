/**
 * voteRateLimiter.js – yksinkertainen muistissa pidettävä IP-kohtainen
 * nopeusrajoitin äänestyksille (anomaliaseurannan ensimmäinen taso).
 *
 * Havaitsee poikkeavan äänestysmäärän lyhyessä ajassa samasta IP-osoitteesta,
 * mikä voi viitata organisoituun VPN-/datacenter-pohjaiseen äänisumutukseen.
 *
 * Huom: tila on prosessikohtainen (Map muistissa). Jos backend joskus
 * skaalataan useammalle instanssille, tämä pitää korvata jaetulla tilalla
 * (esim. Redis).
 */

const WINDOW_MS = 10 * 60 * 1000; // 10 minuuttia
const MAX_VOTES_PER_WINDOW = 15;

/** @type {Map<string, number[]>} ip -> äänestysajan aikaleimat (ms) */
const hits = new Map();

/**
 * Kirjaa uuden äänestysyrityksen annetulta IP-osoitteelta ja kertoo onko
 * yläraja ylittynyt.
 *
 * @param {string} ip
 * @returns {boolean} true jos IP on ylittänyt sallitun äänestysmäärän ikkunan aikana
 */
function isRateLimited(ip) {
  if (!ip) return false;

  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  return recent.length > MAX_VOTES_PER_WINDOW;
}

// Siivoa vanhentuneet merkinnät säännöllisesti jotta Map ei kasva rajattomasti.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of hits) {
    const fresh = timestamps.filter((t) => now - t < WINDOW_MS);
    if (fresh.length === 0) hits.delete(ip);
    else hits.set(ip, fresh);
  }
}, WINDOW_MS);
cleanupTimer.unref();

module.exports = { isRateLimited };
