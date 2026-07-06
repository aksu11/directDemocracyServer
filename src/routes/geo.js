const express = require('express');
const router = express.Router();
const { GEOGRAPHIC_SCOPES } = require('../data/geography');
const { COUNTRIES } = require('../data/countryCodes');

/**
 * GET /api/geo/scopes
 * Palauttaa kaikki sallitut scope-arvot admin-sivun pudotusvalikkoa varten.
 */
router.get('/scopes', (req, res) => {
  res.json({ geographic: GEOGRAPHIC_SCOPES });
});

/**
 * GET /api/geo/countries
 * Palauttaa ISO 3166-1 alpha-2 -maakoodit suomenkielisin nimin
 * admin-sivun maavalitsinta varten. Sama lista jota /api/register käyttää
 * validointiin, joten äänestyksen scopeCountry täsmää aina käyttäjän
 * rekisteröimään maakoodiin.
 */
router.get('/countries', (req, res) => {
  res.json({ countries: COUNTRIES });
});

module.exports = router;
