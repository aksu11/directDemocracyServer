const express = require('express');
const router = express.Router();
const { getDb } = require('../services/firebase');
const { deviceAuth } = require('../middleware/deviceAuth');
const { isEligible } = require('../data/geography');

/**
 * POST /api/votes
 * Cast a vote on a poll.
 *
 * Body:
 *   deviceId   {string}  – ANDROID_ID from the client
 *   isEmulator {boolean} – result of client-side isLikelyEmulator()
 *   pollId     {string}  – Firestore document ID of the poll
 *   optionId   {number}  – index of the chosen option
 */
router.post('/', deviceAuth, async (req, res) => {
  const { pollId, optionId } = req.body;
  const deviceHash = req.deviceHash;

  if (pollId === undefined || optionId === undefined) {
    return res.status(400).json({ error: 'pollId and optionId are required.' });
  }

  const db = getDb();

  try {
    const pollRef = db.collection('polls').doc(String(pollId));
    const pollDoc = await pollRef.get();

    if (!pollDoc.exists) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    const poll = pollDoc.data();

    if (!poll.endsAt || poll.endsAt.toDate() <= new Date()) {
      return res.status(410).json({ error: 'This poll has ended.' });
    }

    // Tarkista käyttäjän sijainti ja äänestyksen laajuus
    const userDoc = await db.collection('users').doc(deviceHash).get();
    if (!userDoc.exists) {
      return res.status(403).json({ error: 'Laite ei ole rekisteröity. Rekisteröidy ensin.' });
    }
    if (!isEligible(userDoc.data(), poll)) {
      return res.status(403).json({ error: 'Et ole oikeutettu äänestämään tässä äänestyksessä.' });
    }

    const optIdx = Number(optionId);
    if (!Number.isInteger(optIdx) || optIdx < 0 || optIdx >= poll.options.length) {
      return res.status(400).json({ error: 'Invalid optionId.' });
    }

    // Check for duplicate vote using the device hash as the document ID
    const voteRef = db.collection('polls').doc(String(pollId)).collection('votes').doc(deviceHash);
    const existingVote = await voteRef.get();

    if (existingVote.exists) {
      return res.status(409).json({ error: 'You have already voted in this poll.' });
    }

    // Atomic write: record the vote and increment the option counter
    const batch = db.batch();

    batch.set(voteRef, {
      optionId: optIdx,
      votedAt: new Date(),
    });

    const updatedOptions = poll.options.map((opt) =>
      opt.id === optIdx ? { ...opt, votes: opt.votes + 1 } : opt
    );
    batch.update(pollRef, { options: updatedOptions });

    await batch.commit();

    return res.status(201).json({ message: 'Vote recorded.' });
  } catch (err) {
    console.error('POST /votes error:', err);
    return res.status(500).json({ error: 'Failed to record vote.' });
  }
});

/**
 * GET /api/votes/results/:pollId
 * Returns the current vote counts for a poll.
 */
router.get('/results/:pollId', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('polls').doc(req.params.pollId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    const { question, options } = doc.data();
    return res.json({ pollId: doc.id, question, options });
  } catch (err) {
    console.error('GET /votes/results error:', err);
    return res.status(500).json({ error: 'Failed to fetch results.' });
  }
});

module.exports = router;
