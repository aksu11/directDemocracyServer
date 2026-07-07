const express = require('express');
const router = express.Router();

// Android-paketin nimi (sama kuin expo-app/app.json: expo.android.package).
const PACKAGE_NAME = 'fi.directdemocracy.app';

// Pilkulla erotettu lista SHA256-sertifikaattisormenjälkiä. Tarvitset yhden:
// - Kehitys/sisäinen testaus (ennen Play-julkaisua): `eas credentials -p android`
//   -> Keystore: Manage everything needed to build your project -> näyttää SHA256-sormenjäljen.
// - Tuotanto (Play Storessa Play App Signing käytössä): Play Console ->
//   Release -> Setup -> App integrity -> App signing key certificate -> SHA-256.
// Aseta arvo ANDROID_SHA256_FINGERPRINTS-ympäristömuuttujaan (Renderin dashboard),
// älä kovakoodaa sitä tähän. Jos muuttuja on tyhjä, tiedosto julkaistaan tyhjänä
// listana eikä App Links -verifiointi onnistu (linkit toimivat silti, mutta
// avautuvat aina selaimeen sovelluksen sijaan).
const FINGERPRINTS = (process.env.ANDROID_SHA256_FINGERPRINTS || '')
  .split(',')
  .map((f) => f.trim())
  .filter(Boolean);

router.get('/assetlinks.json', (req, res) => {
  const statements = FINGERPRINTS.length > 0 ? [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: PACKAGE_NAME,
      sha256_cert_fingerprints: FINGERPRINTS,
    },
  }] : [];

  res.type('application/json');
  res.json(statements);
});

module.exports = router;
