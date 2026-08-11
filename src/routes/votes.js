const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { getDb } = require('../services/firebase');
const { deviceAuth } = require('../middleware/deviceAuth');
const { appCheck } = require('../middleware/appCheck');
const { validate } = require('../middleware/validate');
const { firestoreIdRule } = require('../schemas/common');
const { isEligible, hasMinimumAge, MIN_POLITICAL_AGE } = require('../data/geography');
const { verifyGoogleIdToken } = require('../services/googleAuth');
const { lookupCountry } = require('../services/geoIp');
const { isRateLimited } = require('../services/voteRateLimiter');

const pollIdParamSchema = Joi.object({ pollId: firestoreIdRule.required() }).unknown(true);

// optionId:lle ei aseteta ylärajaa tässä, koska se riippuu poll.options.length:sta
// (haetaan Firestoresta alla) - dynaaminen yläraja tarkistetaan yhä käsin.
const castVoteBodySchema = Joi.object({
  pollId: firestoreIdRule.required(),
  optionId: Joi.number().integer().min(0).required(),
  googleIdToken: Joi.string().optional(),
}).unknown(true);

/**
 * POST /api/votes
 * Cast a vote on a poll.
 *
 * Body:
 *   deviceId      {string}  – ANDROID_ID from the client
 *   isEmulator    {boolean} – result of client-side isLikelyEmulator()
 *   pollId        {string}  – Firestore document ID of the poll
 *   optionId      {number}  – index of the chosen option
 *   googleIdToken {string}  – vaaditaan jos äänestys on merkitty requiresLogin: true
 */
router.post('/', appCheck, deviceAuth, validate(castVoteBodySchema, 'body'), async (req, res) => {
  const { pollId, optionId, googleIdToken } = req.body;
  const deviceHash = req.deviceHash;

  // Anomaliaseuranta: hylkää jos samasta IP-osoitteesta tulee poikkeavan
  // paljon äänestyksiä lyhyessä ajassa (esim. VPN-/datacenter-pohjainen
  // äänisumutus). Tarkistetaan ennen Firestore-kutsuja tarpeettomien
  // luku-/kirjoitusoperaatioiden välttämiseksi.
  if (isRateLimited(req.ip)) {
    console.warn(`Rate limit ylittyi IP-osoitteelle ${req.ip} äänestyksessä ${pollId}.`);
    return res.status(429).json({ error: 'Liian monta äänestystä lyhyessä ajassa. Yritä myöhemmin uudelleen.' });
  }

  // IP-pohjainen maatunnistus – ei estä ääntä, mutta tallennetaan jokaisen
  // äänen yhteyteen jotta admin voi tarkastella äänestyksen maajakaumaa
  // (ks. routes/admin.js GET /polls/:pollId/geo) ja tunnistaa poikkeamia.
  const ipCountry = lookupCountry(req.ip);

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
    if (poll.isPolitical === true && !hasMinimumAge(userDoc.data(), MIN_POLITICAL_AGE)) {
      return res.status(403).json({ error: `Tämä äänestys vaatii, että olet vähintään ${MIN_POLITICAL_AGE}-vuotias.` });
    }
    if (!isEligible(userDoc.data(), poll)) {
      return res.status(403).json({ error: 'Et ole oikeutettu äänestämään tässä äänestyksessä.' });
    }

    // Poliittisesti herkät äänestykset vaativat Google-kirjautumisen laitetunnisteen
    // lisäksi. Ääni tunnistetaan tällöin Google-tilin (googleUid) perusteella, jotta
    // yksi tili ei voi äänestää useasti eri laitteilta.
    let voteDocId = deviceHash;
    if (poll.requiresLogin === true) {
      let googleUid;
      try {
        ({ googleUid } = await verifyGoogleIdToken(googleIdToken));
      } catch (err) {
        return res.status(401).json({ error: 'Tämä äänestys vaatii Google-kirjautumisen.' });
      }
      voteDocId = `g_${googleUid}`;
    }

    const optIdx = Number(optionId);
    if (!Number.isInteger(optIdx) || optIdx < 0 || optIdx >= poll.options.length) {
      return res.status(400).json({ error: 'Invalid optionId.' });
    }

    // Check for duplicate vote using the device hash (or Google uid) as the document ID
    const voteRef = db.collection('polls').doc(String(pollId)).collection('votes').doc(voteDocId);
    const existingVote = await voteRef.get();

    if (existingVote.exists) {
      return res.status(409).json({ error: 'You have already voted in this poll.' });
    }

    // Atomic write: record the vote and increment the option counter
    const batch = db.batch();

    batch.set(voteRef, {
      optionId: optIdx,
      votedAt: new Date(),
      ipCountry: ipCountry || null,
      ...(poll.requiresLogin === true && { deviceHash }),
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
router.get('/results/:pollId', validate(pollIdParamSchema, 'params'), async (req, res) => {
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
