const express = require('express');
const router = express.Router();
const { getDb } = require('../services/firebase');
const { deviceAuth } = require('../middleware/deviceAuth');

/**
 * POST /api/register
 * Rekisteröi laitteen ja tallentaa sijainnin.
 * Voidaan kutsua uudelleen sijaintitietojen päivittämiseksi.
 *
 * Body:
 *   deviceId   {string}  – ANDROID_ID
 *   isEmulator {boolean} – isLikelyEmulator() tulos
 *   city       {string}  – kaupunki (esim. "Tampere")
 *   region     {string}  – maakunta (esim. "Pirkanmaa")
 *   country    {string}  – maa (esim. "Finland")
 */
router.post('/', deviceAuth, async (req, res) => {
  const { city, region, country } = req.body;
  const deviceHash = req.deviceHash;

  if (!city || !region || !country) {
    return res.status(400).json({ error: 'city, region ja country vaaditaan.' });
  }

  const cityTrim    = String(city).trim();
  const regionTrim  = String(region).trim();
  const countryTrim = String(country).trim();

  if (!cityTrim || !regionTrim || !countryTrim) {
    return res.status(400).json({ error: 'city, region ja country eivät saa olla tyhjiä.' });
  }

  try {
    const db = getDb();
    // merge: true sallii sijainnin päivittämisen myöhemmin
    await db.collection('users').doc(deviceHash).set(
      { city: cityTrim, region: regionTrim, country: countryTrim, registeredAt: new Date() },
      { merge: true }
    );

    return res.status(201).json({
      registered: true,
      location: { city: cityTrim, region: regionTrim, country: countryTrim },
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
