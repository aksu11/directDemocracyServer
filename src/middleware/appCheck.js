const { getAppCheck } = require('firebase-admin/app-check');

/**
 * Middleware: todentaa Firebase App Check -tokenin (Play Integrity Androidilla,
 * App Attest/DeviceCheck iOS:llä). Tämä on ainoa palvelimen tarkistuksista, joka
 * oikeasti todistaa pyynnön tulevan aidosta, muokkaamattomasta sovelluksesta
 * aidolla laitteella eikä esim. Postmanista tai käsin rakennetusta HTTP-pyynnöstä
 * (deviceAuth-middlewaren deviceId/isEmulator-kentät ovat pelkkää clientin
 * itsensä ilmoittamaa tietoa, jonka Postmanista voi väärentää miten tahansa).
 *
 * Client lähettää tokenin X-Firebase-AppCheck-headerissa (RNFirebasen
 * getToken()-kutsun palauttama arvo).
 *
 * Rollout-tila: kunnes kaikki käyttäjät ovat päivittäneet App Check -tuella
 * varustettuun clienttiin, ENFORCE_APP_CHECK ei ole asetettu ("true"), jolloin
 * puuttuva/virheellinen token vain lokitetaan eikä hylkää pyyntöä. Kun uusi
 * versio on julkaistu ja käyttäjillä riittävän kauan, aseta
 * ENFORCE_APP_CHECK=true Renderin dashboardilla pyyntöjen hylkäämiseksi.
 */
async function appCheck(req, res, next) {
  const token = req.header('X-Firebase-AppCheck');
  const enforce = process.env.ENFORCE_APP_CHECK === 'true';

  if (!token) {
    if (enforce) {
      return res.status(401).json({ error: 'Puuttuva App Check -token.' });
    }
    console.warn(`App Check: token puuttuu pyynnöstä ${req.method} ${req.originalUrl} (ei vielä pakotettu).`);
    return next();
  }

  try {
    await getAppCheck().verifyToken(token);
    return next();
  } catch (err) {
    if (enforce) {
      console.warn(`App Check: tokenin todennus epäonnistui pyynnölle ${req.method} ${req.originalUrl}:`, err.message);
      return res.status(401).json({ error: 'Virheellinen App Check -token.' });
    }
    console.warn(`App Check: tokenin todennus epäonnistui (ei vielä pakotettu) pyynnölle ${req.method} ${req.originalUrl}:`, err.message);
    return next();
  }
}

module.exports = { appCheck };
