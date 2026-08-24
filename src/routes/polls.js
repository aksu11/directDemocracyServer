const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { getDb } = require('../services/firebase');
const { deviceAuth } = require('../middleware/deviceAuth');
const { validate } = require('../middleware/validate');
const { firestoreIdRule } = require('../schemas/common');
const { isEligible } = require('../data/geography');
const { ENDED_COLLECTION } = require('../services/pollArchive');
const { getActiveBanner } = require('../services/banners');
const { withPercentages } = require('../services/pollFormat');
const { verifyChain } = require('../services/hashChain');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

marked.setOptions({ mangle: false, headerIds: false });

const pollIdParamSchema = Joi.object({ pollId: firestoreIdRule.required() }).unknown(true);

/** Muuntaa Markdown-kuvauksen sanitoiduksi HTML:ksi. */
function renderDescriptionHtml(description) {
  try {
    return sanitizeHtml(marked.parse(String(description)), {
      // Allow basic formatting + links, no images
      allowedTags: ['a', 'p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre'],
      allowedAttributes: { a: ['href', 'target', 'rel'] },
      transformTags: {
        a: (tagName, attribs) => ({ tagName: 'a', attribs: Object.assign({}, attribs, { target: '_blank', rel: 'noopener noreferrer' }) }),
      },
    });
  } catch (e) {
    return null;
  }
}

function withDescriptionHtml(data) {
  if (data.description) {
    data.descriptionHtml = renderDescriptionHtml(data.description);
  }
  return data;
}

/**
 * GET /api/polls
 * Returns all currently open polls (endsAt > now).
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await db
      .collection('polls')
      .where('endsAt', '>', new Date())
      .orderBy('endsAt', 'asc')
      .get();

    const polls = snapshot.docs.map((doc) => withDescriptionHtml({ id: doc.id, ...doc.data() }));
    return res.json(polls);
  } catch (err) {
    console.error('GET /polls error:', err);
    return res.status(500).json({ error: 'Failed to fetch polls.' });
  }
});

/**
 * GET /api/polls/ended
 * Palauttaa päättyneet (arkistoidut) äänestykset uusimmasta vanhimpaan,
 * jotta puhelinsovelluksella voi selata vanhoja äänestyksiä ja niiden tuloksia.
 */
router.get('/ended', async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await db
      .collection(ENDED_COLLECTION)
      .orderBy('endsAt', 'desc')
      .get();

    const polls = snapshot.docs.map((doc) => withPercentages(withDescriptionHtml({ id: doc.id, ...doc.data() })));
    return res.json(polls);
  } catch (err) {
    console.error('GET /polls/ended error:', err);
    return res.status(500).json({ error: 'Päättyneiden äänestysten haku epäonnistui.' });
  }
});

/**
 * POST /api/polls/ended/eligible
 * Palauttaa päättyneet äänestykset joihin laite olisi ollut oikeutettu osallistumaan.
 *
 * Body: { deviceId, isEmulator }
 */
router.post('/ended/eligible', deviceAuth, async (req, res) => {
  try {
    const db = getDb();

    const userDoc = await db.collection('users').doc(req.deviceHash).get();
    if (!userDoc.exists) {
      return res.status(403).json({ error: 'Laite ei ole rekisteröity. Rekisteröidy ensin /api/register -reitillä.' });
    }
    const user = userDoc.data();

    const snapshot = await db
      .collection(ENDED_COLLECTION)
      .orderBy('endsAt', 'desc')
      .get();

    const polls = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((poll) => isEligible(user, poll))
      .map(withDescriptionHtml)
      .map(withPercentages);

    return res.json(polls);
  } catch (err) {
    console.error('POST /polls/ended/eligible error:', err);
    return res.status(500).json({ error: 'Haku epäonnistui.' });
  }
});

/**
 * GET /api/polls/ended/:pollId
 * Returns a single archived (ended) poll with its final results.
 */
router.get('/ended/:pollId', validate(pollIdParamSchema, 'params'), async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection(ENDED_COLLECTION).doc(req.params.pollId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    return res.json(withPercentages(withDescriptionHtml({ id: doc.id, ...doc.data() })));
  } catch (err) {
    console.error('GET /polls/ended/:pollId error:', err);
    return res.status(500).json({ error: 'Failed to fetch poll.' });
  }
});

/**
 * GET /api/polls/ended/:pollId/chain
 * Palauttaa päättyneen äänestyksen koko hash-ketjun (jokainen äänestys-
 * tapahtuma sekä lopullisen tuloksen sitova "poll_closed"-merkintä), jotta
 * kuka tahansa voi itse tarkistaa laskennan eheyden: jokaisen merkinnän
 * prevHash täsmää edelliseen hashiin, jokaisen merkinnän oma hash täsmää sen
 * sisällöstä laskettuun arvoon, ja ketjun viimeinen hash täsmää äänestyksen
 * julkisesti näytettyyn chainHead-arvoon (ks. GET /api/polls/ended/:pollId).
 * Julkaistaan vain päättyneille äänestyksille - aktiivisen äänestyksen
 * ketjun sisältö paljastaisi äänijakauman ennen äänestyksen sulkeutumista.
 */
router.get('/ended/:pollId/chain', validate(pollIdParamSchema, 'params'), async (req, res) => {
  try {
    const db = getDb();
    const pollRef = db.collection(ENDED_COLLECTION).doc(req.params.pollId);
    const pollDoc = await pollRef.get();

    if (!pollDoc.exists) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    const chainSnapshot = await pollRef.collection('chain').orderBy('seq', 'asc').get();
    const chain = chainSnapshot.docs.map((d) => d.data());
    const { valid, brokenAtSeq } = verifyChain(chain);

    return res.json({
      pollId: req.params.pollId,
      chainHead: pollDoc.data().chainHead || null,
      chain,
      verification: { valid, brokenAtSeq },
    });
  } catch (err) {
    console.error('GET /polls/ended/:pollId/chain error:', err);
    return res.status(500).json({ error: 'Ketjun haku epäonnistui.' });
  }
});

/**
 * GET /api/polls/banner
 * Palauttaa sovelluksessa n\u00e4ytett\u00e4v\u00e4n aktiivisen bannerin (kuva Firebase
 * Storagessa, linkki + aktiivisuus Firestoren 'banners'-kokoelmassa), tai
 * null jos yht\u00e4\u00e4n banneria ei ole t\u00e4ll\u00e4 hetkell\u00e4 aktiivinen.
 */
router.get('/banner', async (req, res) => {
  try {
    const banner = await getActiveBanner();
    return res.json(banner);
  } catch (err) {
    console.error('GET /polls/banner error:', err);
    return res.status(500).json({ error: 'Bannerin haku ep\u00e4onnistui.' });
  }
});

/**
 * GET /api/polls/:pollId
 * Returns a single poll with its options, vote counts and end time.
 */
router.get('/:pollId', validate(pollIdParamSchema, 'params'), async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('polls').doc(req.params.pollId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    return res.json(withDescriptionHtml({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.error('GET /polls/:pollId error:', err);
    return res.status(500).json({ error: 'Failed to fetch poll.' });
  }
});

/**
 * POST /api/polls/eligible
 * Palauttaa avoimet äänestykset joihin laite on oikeutettu osallistumaan.
 *
 * Body: { deviceId, isEmulator }
 */
router.post('/eligible', deviceAuth, async (req, res) => {
  try {
    const db = getDb();

    const userDoc = await db.collection('users').doc(req.deviceHash).get();
    if (!userDoc.exists) {
      return res.status(403).json({ error: 'Laite ei ole rekisteröity. Rekisteröidy ensin /api/register -reitillä.' });
    }
    const user = userDoc.data();

    const snapshot = await db
      .collection('polls')
      .where('endsAt', '>', new Date())
      .orderBy('endsAt', 'asc')
      .get();

    const polls = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((poll) => isEligible(user, poll))
      .map(withDescriptionHtml);

    return res.json(polls);
  } catch (err) {
    console.error('POST /polls/eligible error:', err);
    return res.status(500).json({ error: 'Haku epäonnistui.' });
  }
});

module.exports = router;

