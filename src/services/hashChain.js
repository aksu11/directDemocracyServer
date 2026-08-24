const crypto = require('crypto');

/**
 * Kevyt, Firestore-sisäinen hash-ketju äänestysten tuloksille.
 *
 * Jokainen äänestykseen liittyvä tapahtuma (äänen kirjaus, äänestyksen
 * sulkeutuminen) tallennetaan omaksi ketjumerkinnäkseen polls/{id}/chain-
 * alikokoelmaan. Jokainen merkintä sisältää edellisen merkinnän hashin
 * (prevHash), joten yksikin jälkikäteinen muutos historiaan rikkoisi kaikki
 * sitä seuraavat hashit havaittavasti. Äänestyksen "chainHead" (nykyisen
 * ketjun pään hash) tallennetaan pollDocumenttiin, ja se voidaan julkaista
 * julkisesti paljastamatta ketjun sisältöä (äänimääriä) ennen äänestyksen
 * päättymistä.
 */

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Deterministinen JSON-serialisointi (avaimet aakkosjärjestyksessä), jotta
 * sama tapahtumaolio tuottaa aina saman hashin riippumatta avainten
 * lisäysjärjestyksestä.
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * Ketjun "genesis"-hash yhdelle äänestykselle. Sitoo mukaan äänestyksen
 * alkuperäiset tiedot (kysymys, vaihtoehdot, laajuus, päättymisaika), jotta
 * niitäkään ei voi muuttaa jälkikäteen paljastamatta ketjun rikkoutumista.
 */
function genesisHash(pollId, meta) {
  return sha256Hex(canonicalize({ type: 'genesis', pollId, ...(meta || {}) }));
}

function computeEntryHash(prevHash, seq, event) {
  return sha256Hex(`${prevHash}|${seq}|${canonicalize(event)}`);
}

/**
 * Rakentaa seuraavan ketjumerkinnän annetun nykyisen ketjun pään perusteella.
 * Ei itsessään kirjoita mitään Firestoreen - kutsuja päättää tallennustavan
 * (transaktion sisällä tai suoraan), jotta funktio toimii sekä
 * äänestyksen kirjaamisessa (transaktio) että arkistoinnissa (taustatyö).
 *
 * @param {string} pollId
 * @param {{seq: number, hash: string}|undefined|null} currentChainHead
 * @param {object} event - julkaisematon tapahtumadata (esim. optionId, seq, aikaleima)
 * @returns {{seq: number, prevHash: string, hash: string, event: object, createdAt: Date}}
 */
function buildChainEntry(pollId, currentChainHead, event) {
  // Vanhoilla (ennen tätä ominaisuutta luoduilla) äänestyksillä ei ole
  // chainHead-kenttää lainkaan - niille ketju alkaa tästä ensimmäisestä
  // merkinnästä ilman genesis-metadataa.
  const prevHash = currentChainHead && currentChainHead.hash ? currentChainHead.hash : genesisHash(pollId);
  const seq = currentChainHead && Number.isInteger(currentChainHead.seq) ? currentChainHead.seq + 1 : 1;
  const hash = computeEntryHash(prevHash, seq, event);
  return { seq, prevHash, hash, event, createdAt: new Date() };
}

/** Poimii ketjumerkinnästä pollDocumenttiin tallennettavan "chainHead"-kentän. */
function toChainHead(entry) {
  return { seq: entry.seq, hash: entry.hash, updatedAt: entry.createdAt };
}

/**
 * Tarkistaa yhden äänestyksen koko ketjun eheyden: jokaisen merkinnän
 * prevHash täsmää edellisen merkinnän hashiin, ja jokaisen merkinnän oma
 * hash täsmää sen omasta sisällöstä laskettuun arvoon. Käytetään sekä
 * palvelimen omassa GET-reitissä että itsenäisessä varmennusskriptissä
 * (scripts/verifyChain.js), jotta laskentalogiikka on identtinen.
 *
 * @param {Array<{seq:number, prevHash:string, hash:string, event:object}>} chain - seq-järjestyksessä
 * @returns {{valid: boolean, brokenAtSeq: number|null}}
 */
function verifyChain(chain) {
  let prevHash = null;
  for (const entry of chain) {
    if (prevHash !== null && entry.prevHash !== prevHash) {
      return { valid: false, brokenAtSeq: entry.seq };
    }
    const expectedHash = computeEntryHash(entry.prevHash, entry.seq, entry.event);
    if (expectedHash !== entry.hash) {
      return { valid: false, brokenAtSeq: entry.seq };
    }
    prevHash = entry.hash;
  }
  return { valid: true, brokenAtSeq: null };
}

module.exports = {
  sha256Hex,
  canonicalize,
  genesisHash,
  computeEntryHash,
  buildChainEntry,
  toChainHead,
  verifyChain,
};
