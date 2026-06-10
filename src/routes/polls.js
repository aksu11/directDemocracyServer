const express = require('express');
const router = express.Router();
const { getDb } = require('../services/firebase');
const { deviceAuth } = require('../middleware/deviceAuth');
const { isEligible } = require('../data/geography');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

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

    const polls = snapshot.docs.map((doc) => {
      const data = { id: doc.id, ...doc.data() };
      if (data.description) {
        try {
          const rawHtml = marked.parse(String(data.description));
          data.descriptionHtml = sanitizeHtml(rawHtml, {
            // Allow basic formatting + links, no images
            allowedTags: ['a','p','br','strong','b','em','i','ul','ol','li','blockquote','code','pre'],
            allowedAttributes: {
              a: ['href','target','rel']
            },
            transformTags: {
              'a': (tagName, attribs) => ({ tagName: 'a', attribs: Object.assign({}, attribs, { target: '_blank', rel: 'noopener noreferrer' }) })
            }
          });
        } catch (e) {
          data.descriptionHtml = null;
        }
      }
      return data;
    });
    return res.json(polls);
  } catch (err) {
    console.error('GET /polls error:', err);
    return res.status(500).json({ error: 'Failed to fetch polls.' });
  }
});

/**
 * GET /api/polls/:pollId
 * Returns a single poll with its options, vote counts and end time.
 */
router.get('/:pollId', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('polls').doc(req.params.pollId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    const poll = { id: doc.id, ...doc.data() };
    if (poll.description) {
      try {
        poll.descriptionHtml = sanitizeHtml(marked.parse(String(poll.description)), {
          allowedTags: ['a','p','br','strong','b','em','i','ul','ol','li','blockquote','code','pre'],
          allowedAttributes: { a: ['href','target','rel'] },
          transformTags: { 'a': (tagName, attribs) => ({ tagName: 'a', attribs: Object.assign({}, attribs, { target: '_blank', rel: 'noopener noreferrer' }) }) }
        });
      } catch (e) {
        poll.descriptionHtml = null;
      }
    }

    return res.json(poll);
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
      .map((data) => {
        if (data.description) {
          try {
            data.descriptionHtml = sanitizeHtml(marked.parse(String(data.description)), {
              allowedTags: ['a','p','br','strong','b','em','i','ul','ol','li','blockquote','code','pre'],
              allowedAttributes: { a: ['href','target','rel'] },
              transformTags: { 'a': (tagName, attribs) => ({ tagName: 'a', attribs: Object.assign({}, attribs, { target: '_blank', rel: 'noopener noreferrer' }) }) }
            });
          } catch (e) {
            data.descriptionHtml = null;
          }
        }
        return data;
      });

    return res.json(polls);
  } catch (err) {
    console.error('POST /polls/eligible error:', err);
    return res.status(500).json({ error: 'Haku epäonnistui.' });
  }
});

module.exports = router;

