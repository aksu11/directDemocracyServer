const Joi = require('joi');

/**
 * Firestore-dokumentti-ID:n muototarkistus: ei tyhjä, enintään 1500 tavua
 * (Firestoren raja mitattuna UTF-8-tavuina), ei sisällä '/'-merkkiä eikä ole
 * tarkalleen '.' tai '..' (Firestoren .doc()-metodi tulkitsee nämä polkuina
 * eikä yksittäisinä dokumentti-ID:inä, ja heittää muuten synkronisen virheen).
 */
const firestoreIdRule = Joi.string()
  .trim()
  .min(1)
  .max(1500, 'utf8')
  .invalid('.', '..')
  .pattern(/^[^/]+$/)
  .messages({
    'string.pattern.base': '{{#label}} on virheellinen.',
    'any.invalid': '{{#label}} on virheellinen.',
  });

/**
 * Predikaattimuoto firestoreIdRule:sta reiteille, jotka eivät voi käyttää
 * JSON:ia palauttavaa validate()-middlewarea (share.js, shareImage.js).
 */
function isValidFirestoreId(value) {
  return firestoreIdRule.required().validate(value).error == null;
}

module.exports = { firestoreIdRule, isValidFirestoreId };
