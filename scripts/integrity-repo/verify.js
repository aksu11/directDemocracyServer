#!/usr/bin/env node
/**
 * Itsenäinen hash-ketjun varmennusskripti.
 *
 * Tämä tiedosto ei riipu mistään yksityisestä koodista - kaikki tarvittava
 * laskentalogiikka on tässä yhdessä tiedostossa, ja se hakee kaiken datan
 * Direct Democracy -sovelluksen JULKISESTA rajapinnasta. Tarkoitus on että
 * KUKA TAHANSA voi kloonata tämän repon ja ajaa tämän skriptin todistaakseen
 * itselleen, riippumatta mihinkään - myös sovelluksen omaan väitteeseen
 * "verification.valid" -kentästä API-vastauksessa - ettei äänestyksen
 * tulosta ole muokattu sen sulkeutumisen jälkeen.
 *
 * Tarkistaa:
 *   1. jokaisen ketjumerkinnän hash täsmää sen omasta sisällöstä laskettuun
 *      arvoon (dataa ei ole muutettu jälkikäteen),
 *   2. jokaisen merkinnän prevHash täsmää edellisen merkinnän hashiin
 *      (mitään merkintää ei ole poistettu tai lisätty ketjun keskelle),
 *   3. ketjun viimeinen hash täsmää äänestyksen julkisesti näytettyyn
 *      chainHead-arvoon (ketju ei ole katkaistu ennenaikaisesti), ja
 *   4. viimeinen merkintä on tyyppiä "poll_closed" ja sen finalOptions
 *      täsmää äänestyksen julkaistuihin lopputuloksiin.
 *
 * Käyttö:
 *   node verify.js <pollId> [baseUrl]
 *
 * Esim: node verify.js abc123
 *       node verify.js abc123 https://directdemocracy-4yjp.onrender.com
 */

const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://directdemocracy-4yjp.onrender.com';

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Deterministinen JSON-serialisointi (avaimet aakkosjärjestyksessä) - täsmää sovelluksen omaan toteutukseen. */
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

function computeEntryHash(prevHash, seq, event) {
  return sha256Hex(`${prevHash}|${seq}|${canonicalize(event)}`);
}

function verifyChain(chain) {
  let prevHash = null;
  for (const entry of chain) {
    if (prevHash !== null && entry.prevHash !== prevHash) {
      return { valid: false, brokenAtSeq: entry.seq };
    }
    if (computeEntryHash(entry.prevHash, entry.seq, entry.event) !== entry.hash) {
      return { valid: false, brokenAtSeq: entry.seq };
    }
    prevHash = entry.hash;
  }
  return { valid: true, brokenAtSeq: null };
}

async function main() {
  const [, , pollId, baseUrlArg] = process.argv;
  if (!pollId) {
    console.error('Käyttö: node verify.js <pollId> [baseUrl]');
    process.exit(1);
  }
  const baseUrl = (baseUrlArg || DEFAULT_BASE_URL).replace(/\/$/, '');

  const [pollRes, chainRes] = await Promise.all([
    fetch(`${baseUrl}/api/polls/ended/${encodeURIComponent(pollId)}`),
    fetch(`${baseUrl}/api/polls/ended/${encodeURIComponent(pollId)}/chain`),
  ]);

  if (!pollRes.ok || !chainRes.ok) {
    console.error(`Haku epäonnistui (poll: ${pollRes.status}, chain: ${chainRes.status}).`);
    process.exit(1);
  }

  const poll = await pollRes.json();
  const { chainHead, chain } = await chainRes.json();

  console.log(`Äänestys: "${poll.question}" (${pollId})`);
  console.log(`Ketjussa ${chain.length} merkintää, sovelluksen väittämä chainHead.hash = ${chainHead && chainHead.hash}`);

  const { valid, brokenAtSeq } = verifyChain(chain);
  if (!valid) {
    console.error(`✗ KETJU RIKKI seq=${brokenAtSeq} kohdalla - hashit eivät täsmää.`);
    process.exit(1);
  }

  const lastEntry = chain[chain.length - 1];
  if (!lastEntry || lastEntry.hash !== (chainHead && chainHead.hash)) {
    console.error('✗ Ketjun itse laskettu viimeinen hash ei täsmää API:n väittämään chainHead-arvoon - ketju on katkaistu tai API valehtelee.');
    process.exit(1);
  }

  if (!lastEntry.event || lastEntry.event.type !== 'poll_closed') {
    console.error('✗ Ketjun viimeinen merkintä ei ole "poll_closed" - tulos ei ole lukittu ketjuun.');
    process.exit(1);
  }

  const finalOptions = lastEntry.event.finalOptions || [];
  const publishedByOption = new Map(poll.options.map((o) => [o.id, o]));
  const totalVotes = finalOptions.reduce((sum, o) => sum + o.votes, 0);

  for (const opt of finalOptions) {
    const published = publishedByOption.get(opt.id);
    if (!published) {
      console.error(`✗ Vaihtoehtoa ${opt.id} ei löydy julkaistusta tuloksesta.`);
      process.exit(1);
    }
    const expectedPercentage = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
    if (published.percentage !== expectedPercentage) {
      console.error(
        `✗ Vaihtoehdon ${opt.id} julkaistu prosenttiosuus (${published.percentage}%) ei täsmää ketjuun lukittuihin äänimääriin (odotettu ${expectedPercentage}%).`
      );
      process.exit(1);
    }
  }

  console.log('✓ Ketju on eheä: mitään merkintää ei ole muutettu, poistettu tai lisätty, ja julkaistu tulos täsmää ketjuun lukittuihin äänimääriin.');
  console.log('');
  console.log(`Vertaa vielä itse yllä tulostettua chainHead-arvoa tämän repon anchors/-kansion aiemmin`);
  console.log(`julkaistuihin arvoihin tälle pollId:lle - jos ne täsmäävät joka päivä sulkeutumisen jälkeen,`);
  console.log(`tulosta ei ole muokattu myöskään ilman tätä skriptiäkään havaittavasti.`);
}

main().catch((err) => {
  console.error('Varmennus epäonnistui:', err);
  process.exit(1);
});
