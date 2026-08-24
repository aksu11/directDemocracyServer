const { getDb } = require('./firebase');
const { buildChainEntry, toChainHead } = require('./hashChain');

/** Kokoelma johon päättyneet äänestykset siirretään. */
const ENDED_COLLECTION = 'paattyneet';

/**
 * Siirtää kaikki päättyneet äänestykset (endsAt <= now) "polls"-kokoelmasta
 * ENDED_COLLECTION-kokoelmaan äänimäärineen, jotta puhelinsovelluksella voi
 * selata vanhoja äänestyksiä ja niiden tuloksia.
 *
 * Ennen siirtoa jokaisen äänestyksen hash-ketjuun (ks. services/hashChain.js)
 * lisätään "poll_closed"-merkintä, joka sitoo lopulliset äänimäärät ketjuun -
 * kukaan ei siis voi enää tässä tai myöhemmässä vaiheessa muokata tuloksia
 * ilman että ketju rikkoutuisi havaittavasti. Merkintä lisätään ilman
 * transaktiota, koska tämä on ainoa taustatyö joka kirjoittaa äänestykseen
 * endsAt-ajan jälkeen (uudet äänet on jo hylätty routes/votes.js:ssä).
 *
 * @returns {Promise<{ archived: number }>}
 */
async function archiveEndedPolls() {
  const db = getDb();
  const snapshot = await db.collection('polls').where('endsAt', '<=', new Date()).get();

  let archived = 0;
  for (const doc of snapshot.docs) {
    const pollData = doc.data();
    const votesSnapshot = await doc.ref.collection('votes').get();

    const closedEntry = buildChainEntry(doc.id, pollData.chainHead, {
      type: 'poll_closed',
      pollId: doc.id,
      finalOptions: pollData.options.map((o) => ({ id: o.id, label: o.label, votes: o.votes })),
      totalVotes: votesSnapshot.size,
      closedAt: new Date().toISOString(),
    });
    await doc.ref.collection('chain').doc(String(closedEntry.seq)).set(closedEntry);
    const finalChainHead = toChainHead(closedEntry);

    // Chain-lukeminen vasta poll_closed-merkinnän kirjoituksen jälkeen, jotta
    // se sisältyy mukaan arkistoon kopioitavaan ketjuun.
    const chainSnapshot = await doc.ref.collection('chain').get();

    const batch = db.batch();
    const archiveRef = db.collection(ENDED_COLLECTION).doc(doc.id);

    batch.set(archiveRef, { ...pollData, chainHead: finalChainHead });
    votesSnapshot.docs.forEach((voteDoc) => {
      batch.set(archiveRef.collection('votes').doc(voteDoc.id), voteDoc.data());
      batch.delete(voteDoc.ref);
    });
    chainSnapshot.docs.forEach((chainDoc) => {
      batch.set(archiveRef.collection('chain').doc(chainDoc.id), chainDoc.data());
      batch.delete(chainDoc.ref);
    });
    batch.delete(doc.ref);

    await batch.commit();
    archived += 1;
  }

  return { archived };
}

module.exports = { archiveEndedPolls, ENDED_COLLECTION };
