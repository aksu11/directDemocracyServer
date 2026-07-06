const { getDb } = require('./firebase');

/** Kokoelma johon päättyneet äänestykset siirretään. */
const ENDED_COLLECTION = 'paattyneet';

/**
 * Siirtää kaikki päättyneet äänestykset (endsAt <= now) "polls"-kokoelmasta
 * ENDED_COLLECTION-kokoelmaan äänimäärineen, jotta puhelinsovelluksella voi
 * selata vanhoja äänestyksiä ja niiden tuloksia.
 *
 * @returns {Promise<{ archived: number }>}
 */
async function archiveEndedPolls() {
  const db = getDb();
  const snapshot = await db.collection('polls').where('endsAt', '<=', new Date()).get();

  let archived = 0;
  for (const doc of snapshot.docs) {
    const votesSnapshot = await doc.ref.collection('votes').get();

    const batch = db.batch();
    const archiveRef = db.collection(ENDED_COLLECTION).doc(doc.id);

    batch.set(archiveRef, doc.data());
    votesSnapshot.docs.forEach((voteDoc) => {
      batch.set(archiveRef.collection('votes').doc(voteDoc.id), voteDoc.data());
      batch.delete(voteDoc.ref);
    });
    batch.delete(doc.ref);

    await batch.commit();
    archived += 1;
  }

  return { archived };
}

module.exports = { archiveEndedPolls, ENDED_COLLECTION };
