const express = require('express');
const router = express.Router();
const { getDb } = require('../services/firebase');
const { adminAuth } = require('../middleware/adminAuth');
const { getLastCreatedAt, setLastCreatedAt } = require('../services/admins');
const { validateScope } = require('../data/geography');

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
 * Body: { question: string, options: string[], endsAt: string (ISO 8601) }
 */
router.post('/polls', adminAuth, async (req, res) => {
  const { question, options, endsAt, scope, scopeCountry, scopeRegion, scopeCity, description } = req.body;

  if (!question || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'question ja vähintään 2 options vaaditaan.' });
  }

  const endsAtDate = endsAt ? new Date(endsAt) : null;
  if (!endsAtDate || isNaN(endsAtDate.getTime()) || endsAtDate <= new Date()) {
    return res.status(400).json({ error: 'endsAt vaaditaan ja sen täytyy olla tulevaisuudessa.' });
  }

  const scopeError = validateScope(scope, scopeCountry, scopeRegion, scopeCity);
  if (scopeError) {
    return res.status(400).json({ error: scopeError });
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
    // Rate limit: one poll per admin per 7 days
    try {
      const lastIso = getLastCreatedAt(req.adminUser);
      if (lastIso) {
        const last = new Date(lastIso);
        const diffMs = Date.now() - last.getTime();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        if (diffMs < sevenDaysMs) {
          const allowedAt = new Date(last.getTime() + sevenDaysMs);
          return res.status(429).json({ error: 'Voit luoda uuden äänestyksen kerran viikossa.', allowedAt: allowedAt.toISOString() });
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
      ...(scopeCountry && { scopeCountry: String(scopeCountry).trim() }),
      ...(scopeRegion  && { scopeRegion:  String(scopeRegion).trim()  }),
      ...(scopeCity    && { scopeCity:    String(scopeCity).trim()    }),
      createdAt: new Date(),
      endsAt: endsAtDate,
    };

    const ref = await db.collection('polls').add(pollData);
    // record creation time for admin
    try { setLastCreatedAt(req.adminUser, new Date().toISOString()); } catch (e) { console.warn('Failed to set lastCreatedAt', e); }
    return res.status(201).json({ id: ref.id, ...pollData });
  } catch (err) {
    console.error('POST /admin/polls error:', err);
    return res.status(500).json({ error: 'Äänestyksen luonti epäonnistui.' });
  }
});

module.exports = router;
