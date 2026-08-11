/**
 * Yleiset suomenkieliset virheviestit Joi-virhekoodeille. Käytetään aina kun
 * skeema ei itse määrittele tarkempaa viestiä samalle koodille (skeeman oma
 * .messages()-ohitus jää muuten käyttämättä, koska tässä asetetut viestit
 * ajetaan Joi:ssa ensin – ks. src/schemas/common.js:n firestoreIdRule tai
 * routes/admin.js:n scope/scopeCountry-kentät esimerkkeinä kenttäkohtaisesta
 * ohituksesta niille koodeille joita EI ole listattu tässä).
 */
const FI_MESSAGES = {
  'any.required': '{{#label}} vaaditaan.',
  'string.base': '{{#label}} täytyy olla tekstiä.',
  'string.empty': '{{#label}} ei voi olla tyhjä.',
  'string.max': '{{#label}} saa olla enintään {{#limit}} merkkiä.',
  'string.min': '{{#label}} täytyy olla vähintään {{#limit}} merkkiä.',
  'number.base': '{{#label}} täytyy olla numero.',
  'number.integer': '{{#label}} täytyy olla kokonaisluku.',
  'number.min': '{{#label}} täytyy olla vähintään {{#limit}}.',
  'boolean.base': '{{#label}} täytyy olla totuusarvo (true/false).',
  'array.base': '{{#label}} täytyy olla lista.',
  'array.min': '{{#label}} täytyy sisältää vähintään {{#limit}} alkiota.',
  'array.max': '{{#label}} saa sisältää enintään {{#limit}} alkiota.',
  'date.base': '{{#label}} täytyy olla validi päivämäärä.',
  'date.format': '{{#label}} täytyy olla ISO 8601 -muodossa.',
};

/**
 * Ajaa Joi-skeeman annettua dataa vasten ja palauttaa suomenkielisen
 * virheviestin (tai null) + koersoidun arvon. Käytetään validate()-middlewaren
 * sisällä, ja suoraan reiteillä jotka tarvitsevat validoinnin muualle kuin
 * heti reitin alkuun (ks. routes/admin.js:n POST /status, jossa
 * superadmin-tarkistuksen täytyy pysyä ennen bodyn validointia).
 */
function validateValue(schema, data) {
  const { error, value } = schema.validate(data, {
    abortEarly: true,
    convert: true,
    messages: FI_MESSAGES,
  });

  return {
    error: error ? (error.details[0]?.message || 'Pyynnön tiedot eivät kelpaa.') : null,
    value,
  };
}

/**
 * Middleware-tehdas: validoi req.body/req.params/req.query annettua
 * Joi-skeemaa vasten. Palauttaa 400 + suomenkielinen virheviesti jos
 * validointi epäonnistuu, muuten korvaa req[source]:n Joi:n koersoimalla
 * (trimmatulla/tyypitetyllä) arvolla ja jatkaa ketjua.
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = validateValue(schema, req[source] || {});

    if (error) {
      return res.status(400).json({ error });
    }

    req[source] = value;
    next();
  };
}

module.exports = { validate, validateValue };
