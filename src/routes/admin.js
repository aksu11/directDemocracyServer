const express = require('express');
const router = express.Router();
const { getDb } = require('../services/firebase');
const { adminAuth } = require('../middleware/adminAuth');
const { getLastCreatedAt, setLastCreatedAt } = require('../services/admins');
const { validateScope } = require('../data/geography');
const { isValidCountryCode } = require('../data/countryCodes');
const { ENDED_COLLECTION } = require('../services/pollArchive');
const { setActiveBanner, resolveImageUrl } = require('../services/banners');
const { getAppStatus, setAppStatus } = require('../services/appStatus');
const { sendNewPollNotification } = require('../services/pushNotifications');

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
    // Lähetä push-ilmoitus kiinnostuneille käyttäjille - ei odoteta valmiiksi eikä
    // virhe saa estää vastauksen palautusta admin-sivulle.
    sendNewPollNotification(pollData, ref.id).catch((e) => console.warn('sendNewPollNotification failed', e));
    return res.status(201).json({ id: ref.id, ...pollData });
  } catch (err) {
    console.error('POST /admin/polls error:', err);
    return res.status(500).json({ error: 'Äänestyksen luonti epäonnistui.' });
  }
});

/**
 * GET /api/admin/banners
 * Palauttaa listan bannereista valintaa varten (vain superadmin).
 * Banner-kuvat on tallennettu Firebase Storageen, ja Firestoren 'banners'-
 * kokoelma sisältää linkit niihin (imageUrl, linkUrl, isActive).
 */
router.get('/banners', adminAuth, async (req, res) => {
  if (req.adminRole !== 'superadmin') {
    return res.status(403).json({ error: 'Vain superadmin voi hallita bannereita.' });
  }

  try {
    const db = getDb();
    const snapshot = await db.collection('banners').get();
    const banners = await Promise.all(snapshot.docs.map(async (doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        imageUrl: await resolveImageUrl(data.imageUrl),
        linkUrl: data.linkUrl || null,
        isActive: data.isActive === true,
      };
    }));
    return res.json(banners);
  } catch (err) {
    console.error('GET /admin/banners error:', err);
    return res.status(500).json({ error: 'Bannereiden haku epäonnistui.' });
  }
});

/**
 * POST /api/admin/banners/:id/activate
 * Asettaa annetun bannerin sovelluksessa näytettäväksi aktiiviseksi banneriksi
 * ja poistaa aktiivisuuden muilta bannereilta (vain yksi kerrallaan). Vain
 * superadmin voi vaihtaa banneria.
 */
router.post('/banners/:id/activate', adminAuth, async (req, res) => {
  if (req.adminRole !== 'superadmin') {
    return res.status(403).json({ error: 'Vain superadmin voi hallita bannereita.' });
  }

  try {
    const banner = await setActiveBanner(req.params.id);
    return res.json(banner);
  } catch (err) {
    console.error('POST /admin/banners/:id/activate error:', err);
    return res.status(400).json({ error: err.message || 'Bannerin aktivointi epäonnistui.' });
  }
});

/**
 * GET /api/admin/status
 * Palauttaa sovelluksen huoltokatkotilan admin-sivua varten (vain superadmin).
 */
router.get('/status', adminAuth, async (req, res) => {
  if (req.adminRole !== 'superadmin') {
    return res.status(403).json({ error: 'Vain superadmin voi hallita huoltokatkoja.' });
  }

  try {
    const status = await getAppStatus();
    return res.json(status);
  } catch (err) {
    console.error('GET /admin/status error:', err);
    return res.status(500).json({ error: 'Tilan haku epäonnistui.' });
  }
});

/**
 * POST /api/admin/status
 * Päivittää sovelluksen huoltokatkotilan (vain superadmin).
 * Body: { maintenanceMode: boolean, message: string, announceFrom?: ISO string|null, estimatedEnd?: ISO string|null }
 *
 * - announceFrom: milloin ennakkoilmoitus alkaa näkyä sovelluksen äänestyslistan
 *   bannerin paikalla (huoltokatko ei vielä käynnissä).
 * - maintenanceMode: kun true, sovellus näyttää lukitusnäytön "message"-viestillä
 *   koko äänestyslistan sijaan (käytetään kun palvelin on oikeasti pois käytöstä).
 */
router.post('/status', adminAuth, async (req, res) => {
  if (req.adminRole !== 'superadmin') {
    return res.status(403).json({ error: 'Vain superadmin voi hallita huoltokatkoja.' });
  }

  const { maintenanceMode, message, announceFrom, estimatedEnd } = req.body;

  if (maintenanceMode === true && (!message || !String(message).trim())) {
    return res.status(400).json({ error: 'Viesti vaaditaan kun huoltokatko on käynnissä.' });
  }

  try {
    const status = await setAppStatus({ maintenanceMode, message, announceFrom, estimatedEnd });
    return res.json(status);
  } catch (err) {
    console.error('POST /admin/status error:', err);
    return res.status(500).json({ error: 'Tilan päivitys epäonnistui.' });
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

/**
 * GET /api/admin/polls/:pollId/geo
 * Palauttaa äänestyksen äänten maajakauman IP-pohjaisen maatunnistuksen
 * perusteella (ks. services/geoIp.js ja routes/votes.js). Auttaa
 * havaitsemaan poikkeamia (esim. epätavallisen suuri osuus ääniä muualta
 * kuin äänestyksen scopeCountry-maasta). Toimii sekä aktiivisille että
 * päättyneille (arkistoiduille) äänestyksille.
 */
router.get('/polls/:pollId/geo', adminAuth, async (req, res) => {
  try {
    const db = getDb();

    let pollRef = db.collection('polls').doc(req.params.pollId);
    let pollDoc = await pollRef.get();
    if (!pollDoc.exists) {
      pollRef = db.collection(ENDED_COLLECTION).doc(req.params.pollId);
      pollDoc = await pollRef.get();
    }
    if (!pollDoc.exists) {
      return res.status(404).json({ error: 'Poll not found.' });
    }

    const votesSnapshot = await pollRef.collection('votes').get();
    const counts = {};
    let unknownCount = 0;

    votesSnapshot.docs.forEach((doc) => {
      const country = doc.data().ipCountry;
      if (!country) {
        unknownCount += 1;
      } else {
        counts[country] = (counts[country] || 0) + 1;
      }
    });

    const countries = Object.entries(counts)
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    return res.json({
      pollId: req.params.pollId,
      scope: pollDoc.data().scope,
      scopeCountry: pollDoc.data().scopeCountry || null,
      total: votesSnapshot.size,
      unknownCount,
      countries,
    });
  } catch (err) {
    console.error('GET /admin/polls/:pollId/geo error:', err);
    return res.status(500).json({ error: 'Maajakauman haku epäonnistui.' });
  }
});

module.exports = router;
