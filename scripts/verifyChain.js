#!/usr/bin/env node
/**
 * Itsenäinen hash-ketjun varmennusskripti.
 *
 * Hakee päättyneen äänestyksen koko hash-ketjun julkisesta API:sta ja laskee
 * sen eheyden UUDELLEEN paikallisesti, samalla logiikalla kuin palvelin
 * (services/hashChain.js) - tämä skripti EI luota palvelimen omaan
 * "verification"-kenttään, vaan todistaa riippumattomasti että:
 *
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
 *   node scripts/verifyChain.js <pollId> [baseUrl]
 *
 * Esim: node scripts/verifyChain.js abc123 https://directdemocracy.example.com
 * (baseUrl oletuksena http://localhost:3000)
 */

const { verifyChain } = require('../src/services/hashChain');

async function main() {
  const [, , pollId, baseUrlArg] = process.argv;
  if (!pollId) {
    console.error('Käyttö: node scripts/verifyChain.js <pollId> [baseUrl]');
    process.exit(1);
  }
  const baseUrl = (baseUrlArg || 'http://localhost:3000').replace(/\/$/, '');

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
  console.log(`Ketjussa ${chain.length} merkintää, julkaistu chainHead.hash = ${chainHead && chainHead.hash}`);

  const { valid, brokenAtSeq } = verifyChain(chain);
  if (!valid) {
    console.error(`✗ KETJU RIKKI seq=${brokenAtSeq} kohdalla - hashit eivät täsmää.`);
    process.exit(1);
  }

  const lastEntry = chain[chain.length - 1];
  if (!lastEntry || lastEntry.hash !== (chainHead && chainHead.hash)) {
    console.error('✗ Ketjun viimeinen hash ei täsmää julkaistuun chainHead-arvoon - ketju on katkaistu.');
    process.exit(1);
  }

  if (!lastEntry.event || lastEntry.event.type !== 'poll_closed') {
    console.error('✗ Ketjun viimeinen merkintä ei ole "poll_closed" - tulos ei ole lukittu ketjuun.');
    process.exit(1);
  }

  const finalOptions = lastEntry.event.finalOptions || [];
  const publishedByOption = new Map(poll.options.map((o) => [o.id, o]));
  for (const opt of finalOptions) {
    const published = publishedByOption.get(opt.id);
    if (!published) {
      console.error(`✗ Vaihtoehtoa ${opt.id} ei löydy julkaistusta tuloksesta.`);
      process.exit(1);
    }
    const totalVotes = finalOptions.reduce((sum, o) => sum + o.votes, 0);
    const expectedPercentage = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
    if (published.percentage !== expectedPercentage) {
      console.error(
        `✗ Vaihtoehdon ${opt.id} julkaistu prosenttiosuus (${published.percentage}%) ei täsmää ketjuun lukittuihin äänimääriin (odotettu ${expectedPercentage}%).`
      );
      process.exit(1);
    }
  }

  console.log('✓ Ketju on eheä: mitään merkintää ei ole muutettu, poistettu tai lisätty, ja julkaistu tulos täsmää ketjuun lukittuihin äänimääriin.');
}

main().catch((err) => {
  console.error('Varmennus epäonnistui:', err);
  process.exit(1);
});
