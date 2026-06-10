const express = require('express');
const router = express.Router();
const { VALID_SCOPES, ALLIANCE_SCOPES, GEOGRAPHIC_SCOPES } = require('../data/geography');

/**
 * GET /api/geo/scopes
 * Palauttaa kaikki sallitut scope-arvot admin-sivun pudotusvalikkoa varten.
 */
router.get('/scopes', (req, res) => {
  res.json({ geographic: GEOGRAPHIC_SCOPES, alliances: ALLIANCE_SCOPES });
});

module.exports = router;
