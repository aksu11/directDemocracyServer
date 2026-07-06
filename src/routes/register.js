const express = require('express');
const router = express.Router();
const { getDb } = require('../services/firebase');
const { deviceAuth } = require('../middleware/deviceAuth');
const { isValidCountryCode } = require('../data/countryCodes');

const VALID_PLATFORMS = ['android', 'ios'];

/**
 * POST /api/register
 * Rekisteröi laitteen ja tallentaa maan.
 * Voidaan kutsua uudelleen sijaintitiedon päivittämiseksi.
 *
 * Body:
 *   deviceId   {string}  – ANDROID_ID (tai iOS-vastine)
 *   isEmulator {boolean} – isLikelyEmulator() tulos
 *   country    {string}  – ISO 3166-1 alpha-2 -maakoodi (esim. "FI")
 *   platform   {string}  – "android" tai "ios" (valinnainen, oletus "android"
 *                           taaksepäin yhteensopivuuden vuoksi vanhoille clienteille)
 *   birthYear  {number}  – syntymävuosi (valinnainen). Käytetään vain poliittisesti
 *                           merkittyjen äänestysten (isPolitical: true) ikärajan
 *                           tarkistukseen – emme tallenna tarkempaa syntymäaikaa.
 */
router.post('/', deviceAuth, async (req, res) => {
  const { country, platform, birthYear } = req.body;
  const deviceHash = req.deviceHash;

  if (!country) {
    return res.status(400).json({ error: 'country vaaditaan.' });
  }

  const countryCode = String(country).trim().toUpperCase();

  if (!isValidCountryCode(countryCode)) {
    return res.status(400).json({ error: 'country täytyy olla validi ISO 3166-1 alpha-2 -maakoodi.' });
  }

  // platform on valinnainen (vanhat Android-clientit eivät vielä lähetä sitä),
  // mutta jos se annetaan, sen täytyy olla tunnettu arvo.
  let platformValue = 'android';
  if (platform !== undefined && platform !== null) {
    platformValue = String(platform).trim().toLowerCase();
    if (!VALID_PLATFORMS.includes(platformValue)) {
      return res.status(400).json({ error: 'platform täytyy olla "android" tai "ios".' });
    }
  }

  // birthYear on valinnainen, mutta jos se annetaan sen täytyy olla järkevä syntymävuosi.
  let birthYearValue;
  if (birthYear !== undefined && birthYear !== null && birthYear !== '') {
    birthYearValue = Number(birthYear);
    const currentYear = new Date().getFullYear();
    if (!Number.isInteger(birthYearValue) || birthYearValue < currentYear - 120 || birthYearValue > currentYear) {
      return res.status(400).json({ error: 'birthYear täytyy olla validi syntymävuosi.' });
    }
  }

  try {
    const db = getDb();
    // merge: true sallii sijainnin (ja syntymävuoden) päivittämisen myöhemmin
    await db.collection('users').doc(deviceHash).set(
      {
        country: countryCode,
        platform: platformValue,
        ...(birthYearValue !== undefined && { birthYear: birthYearValue }),
        registeredAt: new Date(),
      },
      { merge: true }
    );

    return res.status(201).json({
      registered: true,
      location: { country: countryCode },
      platform: platformValue,
    });
  } catch (err) {
    console.error('POST /register error:', err);
    return res.status(500).json({ error: 'Rekisteröinti epäonnistui.' });
  }
});

/**
 * POST /api/register/me
 * Palauttaa laitteen rekisteröintitiedot.
 *
 * Body: { deviceId, isEmulator }
 */
router.post('/me', deviceAuth, async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('users').doc(req.deviceHash).get();

    if (!doc.exists) {
      return res.status(404).json({ registered: false });
    }

    return res.json({ registered: true, ...doc.data() });
  } catch (err) {
    console.error('POST /register/me error:', err);
    return res.status(500).json({ error: 'Tietojen haku epäonnistui.' });
  }
});

module.exports = router;
