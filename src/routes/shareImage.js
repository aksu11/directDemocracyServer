const express = require('express');
const router = express.Router();
const { getDb } = require('../services/firebase');
const { ENDED_COLLECTION } = require('../services/pollArchive');
const { withPercentages } = require('../services/pollFormat');
const { renderEndedPollImage } = require('../services/resultImage');

// Päättyneen äänestyksen tulokset eivät enää muutu, joten kuva riittää
// renderöidä kerran per äänestys ja pitää muistissa - ei tarvetta ajastimelle
// tai levylle tallentamiselle. Yläraja estää muistin kasvamisen rajattomasti,
// jos jaettuja päättyneitä äänestyksiä kertyy paljon ajan myötä.
const cache = new Map();
const MAX_CACHE_ENTRIES = 300;

function cacheImage(pollId, buffer) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(pollId, buffer);
}

/**
 * GET /share-image/ended/:pollId
 *
 * Päättyneen äänestyksen tulosnäkymä PNG-kuvana, jota käytetään og:image-tagina
 * kun jaettava linkki osoittaa jo päättyneeseen äänestykseen (ks. routes/share.js).
 */
router.get('/share-image/ended/:pollId', async (req, res) => {
  const { pollId } = req.params;

  try {
    let image = cache.get(pollId);
    if (!image) {
      const db = getDb();
      const doc = await db.collection(ENDED_COLLECTION).doc(pollId).get();
      if (!doc.exists) return res.status(404).end();

      const poll = withPercentages(doc.data());
      image = await renderEndedPollImage(poll);
      cacheImage(pollId, image);
    }

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(image);
  } catch (err) {
    console.error('GET /share-image/ended/:pollId error:', err);
    return res.status(500).end();
  }
});

module.exports = router;
