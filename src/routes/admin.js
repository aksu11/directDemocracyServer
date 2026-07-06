const express = require('express');
const router = express.Router();
const { getDb } = require('../services/firebase');
const { adminAuth } = require('../middleware/adminAuth');
const { getLastCreatedAt, setLastCreatedAt } = require('../services/admins');
const { validateScope } = require('../data/geography');
const { isValidCountryCode } = require('../data/countryCodes');
const { ENDED_COLLECTION } = require('../services/pollArchive');

/**
 * GET /api/admin/verify
 * Kevyt endpoint salasanan tarkistamiseen admin-sivulta.
 */
router.get('/verify', adminAuth, (req, res) => {
  res.json({ ok: true, role: req.adminRole });
});

/**
 * POST /api/admin/polls
 * Luo uuden äänestyksen. Vaatii admin-salasanan.
 *
 * Body: { question: string, options: string[], endsAt: string (ISO 8601), requiresLogin?: boolean, isPolitical?: boolean }
 */
router.post('/polls', adminAuth, async (req, res) => {
  const { question, options, endsAt, scope, scopeCountry, description, requiresLogin, isPolitical } = req.body;

  if (!question || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'question ja vähintään 2 options vaaditaan.' });
  }

  const endsAtDate = endsAt ? new Date(endsAt) : null;
  if (!endsAtDate || isNaN(endsAtDate.getTime()) || endsAtDate <= new Date()) {
    return res.status(400).json({ error: 'endsAt vaaditaan ja sen täytyy olla tulevaisuudessa.' });
  }

  const scopeError = validateScope(scope, scopeCountry);
  if (scopeError) {
    return res.status(400).json({ error: scopeError });
  }

  let scopeCountryCode;
  if (scope === 'country') {
    scopeCountryCode = String(scopeCountry).trim().toUpperCase();
    if (!isValidCountryCode(scopeCountryCode)) {
      return res.status(400).json({ error: 'scopeCountry täytyy olla validi ISO 3166-1 alpha-2 -maakoodi.' });
    }
  }

  // Validate optional description (max 2000 chars)
  if (description && typeof description !== 'string') {
    return res.status(400).json({ error: 'Kuvaus täytyy olla tekstiä.' });
  }
  const descTrim = description ? String(description).trim() : null;
  if (descTrim && descTrim.length > 2000) {
    return res.status(400).json({ error: 'Kuvaus saa olla enintään 2000 merkkiä.' });
  }

  try {
    // Rate limit: one poll per admin per 7 days, exempt superadmins
    try {
      if (req.adminRole !== 'superadmin') {
        const lastIso = await getLastCreatedAt(req.adminUser);
        if (lastIso) {
          const last = new Date(lastIso);
          const diffMs = Date.now() - last.getTime();
          const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
          if (diffMs < sevenDaysMs) {
            const allowedAt = new Date(last.getTime() + sevenDaysMs);
            return res.status(429).json({ error: 'Voit luoda uuden äänestyksen kerran viikossa.', allowedAt: allowedAt.toISOString() });
          }
        }
      }
    } catch (e) {
      console.warn('Unable to check admin lastCreatedAt', e);
    }
    const db = getDb();
    const pollData = {
      question: question.trim(),
      options: options.map((label, i) => ({ id: i, label: String(label).trim(), votes: 0 })),
      scope,
      ...(descTrim && { description: descTrim }),
      ...(scopeCountryCode && { scopeCountry: scopeCountryCode }),
      requiresLogin: requiresLogin === true,
      // Poliittiseksi merkityt äänestykset vaativat äänestäjältä vähintään
      // MIN_POLITICAL_AGE (18) vuoden iän (ks. data/geography.js isEligible).
      isPolitical: isPolitical === true,
      createdAt: new Date(),
      endsAt: endsAtDate,
    };

    const ref = await db.collection('polls').add(pollData);
    // record creation time for admin
    try { await setLastCreatedAt(req.adminUser, new Date().toISOString()); } catch (e) { console.warn('Failed to set lastCreatedAt', e); }
    return res.status(201).json({ id: ref.id, ...pollData });
  } catch (err) {
    console.error('POST /admin/polls error:', err);
    return res.status(500).json({ error: 'Äänestyksen luonti epäonnistui.' });
  }
});

/**
 * GET /api/admin/polls/ended
 * Palauttaa päättyneet äänestykset todellisilla äänimäärillä (vain admin).
 * Julkinen /api/polls/ended-reitti näyttää muille vain prosenttiosuudet.
 */
router.get('/polls/ended', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const snapshot = await db
      .collection(ENDED_COLLECTION)
      .orderBy('endsAt', 'desc')
      .get();

    const polls = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.json(polls);
  } catch (err) {
    console.error('GET /admin/polls/ended error:', err);
    return res.status(500).json({ error: 'Päättyneiden äänestysten haku epäonnistui.' });
  }
});

/**
 * GET /api/admin/polls/ended/:pollId
 * Palauttaa yhden päättyneen äänestyksen todellisilla äänimäärillä (vain admin).
 */
router.get('/polls/ended/:pollId', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection(ENDED_COLLECTION).doc(req.params.pollId).get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    return res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error('GET /admin/polls/ended/:pollId error:', err);
    return res.status(500).json({ error: 'Äänestyksen haku epäonnistui.' });
  }
});

module.exports = router;
