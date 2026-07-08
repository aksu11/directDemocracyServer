const express = require('express');
const router = express.Router();
const { getAppStatus } = require('../services/appStatus');

/**
 * GET /api/status
 * Julkinen endpoint, jota sovellus tarkistaa käynnistyessä (ja aina kun se
 * palaa foregroundiin) selvittääkseen onko huoltokatko käynnissä tai tulossa.
 * Ei vaadi kirjautumista, koska tämän täytyy toimia myös silloin kun muu
 * backend on juuri palautumassa huoltokatkosta.
 */
router.get('/', async (req, res) => {
  try {
    const status = await getAppStatus();
    return res.json(status);
  } catch (err) {
    console.error('GET /status error:', err);
    // Statuksen haku ei koskaan saa estää sovelluksen käyttöä - jos haku
    // epäonnistuu, oletetaan ettei huoltokatkoa ole.
    return res.json({ maintenanceMode: false, message: '', announceFrom: null, estimatedEnd: null });
  }
});

module.exports = router;
