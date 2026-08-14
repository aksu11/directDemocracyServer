const express = require('express');
const router = express.Router();
const { Expo } = require('expo-server-sdk');
const { getDb } = require('../services/firebase');
const { deviceAuth } = require('../middleware/deviceAuth');
const { appCheck } = require('../middleware/appCheck');
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
 *   birthYear  {number}  – syntymävuosi (vaaditaan). Käytetään vain poliittisesti
 *                           merkittyjen äänestysten (isPolitical: true) ikärajan
 *                           tarkistukseen – emme tallenna tarkempaa syntymäaikaa,
 *                           mikä riittää ikärajan toteamiseen (tietojen minimointi).
 */
router.post('/', appCheck, deviceAuth, async (req, res) => {
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

  // birthYear vaaditaan. Ilman sitä käyttäjä ei voi äänestää poliittisissa
  // äänestyksissä eikä saa niistä push-ilmoituksia (ks. data/geography.js
  // hasMinimumAge palauttaa false kun syntymävuotta ei tunneta) - ja tämä
  // tapahtuisi täysin hiljaisesti, ilman että käyttäjälle kerrotaan syytä.
  if (birthYear === undefined || birthYear === null || birthYear === '') {
    return res.status(400).json({ error: 'birthYear vaaditaan.' });
  }

  const birthYearValue = Number(birthYear);
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(birthYearValue) || birthYearValue < currentYear - 120 || birthYearValue > currentYear) {
    return res.status(400).json({ error: 'birthYear täytyy olla validi syntymävuosi.' });
  }

  try {
    const db = getDb();
    const userRef = db.collection('users').doc(deviceHash);

    // Syntymävuosi saa asettua vain kerran per laite - jos dokumentissa on jo
    // birthYear, uutta arvoa EI hyväksytä vaikka client lähettäisi sellaisen
    // (esim. suoralla API-kutsulla ohi Asetukset-näytön kertaluontoisen UI:n).
    // Muuten ikärajan (isPolitical-äänestykset) tarkoitus menettäisi merkityksensä,
    // koska käyttäjä voisi muuttaa syntymävuottaan aina halutessaan äänestää.
    let birthYearToSet = birthYearValue;
    const existing = await userRef.get();
    if (existing.exists && existing.data().birthYear) {
      birthYearToSet = undefined;
    }

    // merge: true sallii sijainnin päivittämisen myöhemmin
    await userRef.set(
      {
        country: countryCode,
        platform: platformValue,
        ...(birthYearToSet !== undefined && { birthYear: birthYearToSet }),
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
router.post('/me', appCheck, deviceAuth, async (req, res) => {
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

/**
 * POST /api/register/push-token
 * Tallentaa laitteen Expo push -tokenin ja käyttäjän valinnan ilmoituksista
 * (oletuksena päällä). Kutsutaan sovelluksen käynnistyessä (tokenin päivitys)
 * ja asetuksista kytkintä käytettäessä.
 *
 * Body:
 *   deviceId   {string}  – sama kuin muissa /register-kutsuissa
 *   isEmulator {boolean}
 *   pushToken  {string|null} – valinnainen. Merkkijono tallentaa uuden Expo push -tokenin,
 *                           `null` nollaa tallennetun tokenin eksplisiittisesti (esim. kun
 *                           käyttöjärjestelmän ilmoituslupaa ei ole myönnetty eikä tokenia
 *                           siis voida hankkia), ja kentän jättäminen kokonaan pois tarkoittaa
 *                           ettei tokenia päivitetä (esim. pelkkää enabled-arvoa vaihdettaessa).
 *   enabled    {boolean} – vaaditaan. false = älä lähetä ilmoituksia tälle laitteelle.
 */
router.post('/push-token', appCheck, deviceAuth, async (req, res) => {
  const { pushToken, enabled } = req.body;
  const deviceHash = req.deviceHash;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) vaaditaan.' });
  }

  if (pushToken !== undefined && pushToken !== null) {
    if (typeof pushToken !== 'string' || !Expo.isExpoPushToken(pushToken)) {
      return res.status(400).json({ error: 'pushToken ei ole validi Expo push -token.' });
    }
  }

  try {
    const db = getDb();
    await db.collection('users').doc(deviceHash).set(
      {
        notificationsEnabled: enabled,
        // pushToken === undefined -> ei koskea kenttään lainkaan (merge:true säilyttää vanhan).
        // pushToken === null      -> nollataan eksplisiittisesti (kirjoitetaan null, ei jätetä pois).
        // pushToken === string    -> tallennetaan uusi token.
        ...(pushToken !== undefined && {
          pushToken,
          pushTokenUpdatedAt: pushToken ? new Date() : null,
        }),
      },
      { merge: true }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error('POST /register/push-token error:', err);
    return res.status(500).json({ error: 'Push-tokenin tallennus epäonnistui.' });
  }
});

/**
 * DELETE /api/register
 * GDPR-oikeus tietojen poistamiseen: poistaa laitteen rekisteröintitiedot
 * (users-kokoelma, eli maa/ikä/alusta). Annettuja ääniä EI poisteta, ei edes
 * käynnissä olevista äänestyksistä – kerran annettu ääni kuuluu pysyvästi
 * äänestyksen tulokseen, eikä sitä saa muuttaa jälkikäteen (myös päättyneiden
 * äänestysten tulosten pitää pysyä muuttumattomina).
 *
 * Body: { deviceId, isEmulator }
 */
router.delete('/', appCheck, deviceAuth, async (req, res) => {
  const deviceHash = req.deviceHash;

  try {
    const db = getDb();
    await db.collection('users').doc(deviceHash).delete();

    return res.json({ deleted: true });
  } catch (err) {
    console.error('DELETE /register error:', err);
    return res.status(500).json({ error: 'Tietojen poisto epäonnistui.' });
  }
});

module.exports = router;
