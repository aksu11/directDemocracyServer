const { getDb } = require('./firebase');
const { canonicalize, sha256Hex } = require('./hashChain');
const { ENDED_COLLECTION } = require('./pollArchive');

/**
 * Julkaisee hash-ketjujen (ks. services/hashChain.js) nykytilan JULKISEEN
 * GitHub-repoon, jota tämä palvelin ei muuten hallitse (ei voi hiljaisesti
 * muokata tai poistaa vanhoja commiteja) - tämä on kevyt korvike Bitcoin-
 * ankkuroinnille: jos joku (myös ylläpitäjä itse) muuttaisi jälkikäteen
 * Firestoreen tallennettuja äänestystuloksia, uusi chainHead-hash ei enää
 * täsmäisi tähän repoon aiemmin committattuun arvoon, ja ristiriita olisi
 * kenen tahansa nähtävissä repon commit-historiasta.
 *
 * Vaatii ympäristömuuttujat:
 *   GITHUB_INTEGRITY      – fine-grained personal access token, oikeudet
 *                           rajattu YHTEEN repoon, "Contents: Read and write"
 *   GITHUB_INTEGRITY_REPO – "omistaja/repo", esim. "aksu11/directdemocracy-integrity"
 */

const GITHUB_API_BASE = 'https://api.github.com';

function getConfig() {
  const token = process.env.GITHUB_INTEGRITY;
  const repo = process.env.GITHUB_INTEGRITY_REPO;
  if (!token || !repo) return null;
  return { token, repo };
}

function githubRequest(config, path, options = {}) {
  return fetch(`${GITHUB_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'DirectDemocracy-integrity-anchor',
      ...(options.headers || {}),
    },
  });
}

/**
 * Kerää jokaisen äänestyksen (aktiivinen tai päättynyt) nykyisen
 * chainHead-hashin, ihmisluettavaan muotoon muotoiltuna. Kentät on
 * tarkoituksella litistetty ja nimetty niin, että kuka tahansa GitHubissa
 * commitin avaava ymmärtää mistä äänestyksestä on kyse ilman että pitää
 * tuntea sisäistä chainHead-{seq,hash}-rakennetta.
 */
async function collectChainHeads() {
  const db = getDb();
  const [activeSnapshot, endedSnapshot] = await Promise.all([
    db.collection('polls').get(),
    db.collection(ENDED_COLLECTION).get(),
  ]);

  const polls = [];
  const addFrom = (snapshot, status) => {
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (!data.chainHead || !data.chainHead.hash) return;
      polls.push({
        pollId: doc.id,
        question: data.question,
        status,
        // "closedAt" päättyneille (jo toteutunut), "endsAt" aktiivisille
        // (vielä tuleva ajoitettu päättymisaika) - ei sama kenttä
        // molemmille, koska merkitys on eri.
        ...(status === 'ended'
          ? { closedAt: data.endsAt ? data.endsAt.toDate().toISOString() : null }
          : { endsAt: data.endsAt ? data.endsAt.toDate().toISOString() : null }),
        chainHead: data.chainHead.hash,
        sequenceLength: data.chainHead.seq,
      });
    });
  };
  addFrom(activeSnapshot, 'active');
  addFrom(endedSnapshot, 'ended');

  // Deterministinen järjestys, jotta rootHash on toistettavissa riippumatta
  // Firestore-kyselyn palautusjärjestyksestä.
  polls.sort((a, b) => (a.pollId < b.pollId ? -1 : a.pollId > b.pollId ? 1 : 0));
  return polls;
}

function buildSnapshot(polls, generatedAt) {
  const rootHash = sha256Hex(canonicalize(polls.map((p) => ({ pollId: p.pollId, hash: p.chainHead }))));
  return { generatedAt: generatedAt.toISOString(), rootHash, polls };
}

/**
 * Kirjoittaa (tai päivittää, jos ajetaan useasti samana päivänä esim.
 * palvelimen uudelleenkäynnistyksen takia) päivän ankkuritiedoston repoon.
 *
 * @returns {Promise<object|null>} julkaistu snapshot, tai null jos konfiguraatio
 *   puuttuu tai äänestyksiä ei vielä ole.
 */
async function publishIntegrityAnchor() {
  const config = getConfig();
  if (!config) {
    console.warn('GITHUB_INTEGRITY / GITHUB_INTEGRITY_REPO puuttuu ympäristömuuttujista - ohitetaan hash-ketjun ulkoinen ankkurointi.');
    return null;
  }

  const polls = await collectChainHeads();
  if (polls.length === 0) return null;

  const generatedAt = new Date();
  const snapshot = buildSnapshot(polls, generatedAt);
  const dateStr = generatedAt.toISOString().slice(0, 10);
  const path = `anchors/${dateStr}.json`;
  const content = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8').toString('base64');

  const existing = await githubRequest(config, `/repos/${config.repo}/contents/${path}`);
  let sha;
  if (existing.status === 200) {
    sha = (await existing.json()).sha;
  } else if (existing.status !== 404) {
    throw new Error(`GitHub-tiedoston tarkistus epäonnistui (${existing.status}): ${await existing.text().catch(() => '')}`);
  }

  const putRes = await githubRequest(config, `/repos/${config.repo}/contents/${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Integrity anchor ${dateStr} — ${polls.length} poll(s), root ${snapshot.rootHash.slice(0, 12)}…`,
      content,
      ...(sha && { sha }),
    }),
  });

  if (!putRes.ok) {
    throw new Error(`GitHub-kirjoitus epäonnistui (${putRes.status}): ${await putRes.text().catch(() => '')}`);
  }

  return snapshot;
}

module.exports = { publishIntegrityAnchor, collectChainHeads, buildSnapshot };
