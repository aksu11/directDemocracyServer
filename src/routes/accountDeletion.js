const express = require('express');
const router = express.Router();
const { getDb } = require('../services/firebase');
const { verifyGoogleIdToken } = require('../services/googleAuth');
const { ENDED_COLLECTION } = require('../services/pollArchive');

// Yhteystiedot ja sovelluksen nimi tälle sivulle. Sama kehittäjän sähköposti
// kuin tietosuojaselosteessa (https://directdemocracy-zmon.onrender.com/#tietosuoja).
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'mikko.sukkela@mail.com';
const APP_NAME = 'Suora Demokratia (Direct Democracy)';

// Sama "Web application" -tyyppinen Google OAuth client id kuin
// expo-app/constants/config.ts (GOOGLE_CLIENT_IDS.webClientId). Tämä ei ole
// salaisuus – client id on tarkoitettu näkyväksi clientille (myös selaimelle).
// HUOM: tämän arvon täytyy olla mukana palvelimen GOOGLE_CLIENT_IDS-ympäristö-
// muuttujassa (ks. backend/src/services/googleAuth.js), jotta verifyGoogleIdToken
// hyväksyy tällä sivulla luodun ID-tokenin.
const GOOGLE_WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID
  || '611032277466-r35hgnailclitpu53cju0cu9f9536els.apps.googleusercontent.com';

/**
 * GET /account-deletion (ja alias /poista-tili)
 *
 * Googlen Play Console -tietosuojaosion ("Poista tilin URL-osoite") vaatima
 * julkinen sivu, joka kertoo miten käyttäjä voi pyytää tilinsä/tietojensa
 * poistamista.
 *
 * Sovelluksessa ei ole perinteistä käyttäjätiliä (ei sähköpostia/salasanaa) –
 * laite tunnistetaan vain salatulla (SHA-256) laitetunnisteella, jota emme voi
 * yhdistää nimeen tai sähköpostiosoitteeseen. Siksi:
 *  1. Ensisijainen ja aina toimiva tapa on sovelluksen sisäinen toiminto
 *     (Asetukset > "Poista tietoni", ks. routes/register.js DELETE /), koska
 *     vain laite itse tietää oman laitetunnisteensa.
 *  2. Niille, jotka ovat kirjautuneet Google-tilillä äänestääkseen jossakin
 *     kirjautumista vaativassa äänestyksessä, tämä sivu tarjoaa Google-
 *     kirjautumisen kautta tavan paikantaa ja poistaa laitteen rekisteröinti-
 *     tiedot ilman että käyttäjällä täytyy olla sovellus enää asennettuna
 *     (ks. POST /account-deletion/google alla).
 *  3. Käyttäjille, jotka eivät ole koskaan kirjautuneet Google-tilillä
 *     sovelluksessa, EI ole olemassa mitään tunnistetta (ei nimeä, ei
 *     sähköpostia) jonka avulla tukikaan voisi paikantaa heidän tietueensa
 *     manuaalisesti – tästä syystä sivu ei väitä sähköpostipyynnön toimivan
 *     tunnistautumiskeinona.
 */
router.get(['/account-deletion', '/poista-tili'], (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderPage());
});

/**
 * POST /account-deletion/google
 *
 * Body: { googleIdToken: string }
 *
 * Varmentaa Google ID-tokenin ja etsii kaikista äänestyksistä (avoimista ja
 * arkistoiduista) äänet, jotka on annettu tällä Google-tilillä
 * (äänen tunniste on aina muotoa "g_<googleUid>", ks. routes/votes.js).
 * Löytyneistä äänistä luetaan niihin tallennettu laitetunniste (deviceHash) ja
 * poistetaan sitä vastaava rekisteröintitietue (users/{deviceHash}) – täsmälleen
 * sama toiminto kuin DELETE /api/register tekee sovelluksen sisältä käsin.
 * Itse ääniä (optionId/votedAt) ei poisteta, koska annettu ääni kuuluu
 * pysyvästi äänestyksen tulokseen (sama periaate kuin DELETE /api/register:ssä).
 */
router.post('/account-deletion/google', async (req, res) => {
  const { googleIdToken } = req.body || {};

  let googleUid;
  try {
    ({ googleUid } = await verifyGoogleIdToken(googleIdToken));
  } catch (err) {
    return res.status(401).json({ error: 'Google-kirjautumisen varmennus epäonnistui.' });
  }

  try {
    const db = getDb();
    const voteDocId = `g_${googleUid}`;

    // Käydään läpi kaikki äänestykset (avoimet + arkistoidut) ja katsotaan
    // löytyykö niistä tällä Google-tilillä annettu ääni. listDocuments() ei lue
    // dokumenttien sisältöä, vain viitteet, joten tämä on halpa operaatio.
    const [pollRefs, endedRefs] = await Promise.all([
      db.collection('polls').listDocuments(),
      db.collection(ENDED_COLLECTION).listDocuments(),
    ]);

    const voteSnaps = await Promise.all(
      [...pollRefs, ...endedRefs].map((ref) => ref.collection('votes').doc(voteDocId).get())
    );

    const deviceHashes = new Set();
    voteSnaps.forEach((snap) => {
      if (snap.exists && snap.data().deviceHash) {
        deviceHashes.add(snap.data().deviceHash);
      }
    });

    if (deviceHashes.size === 0) {
      return res.json({
        deleted: false,
        message: 'Tähän Google-tiliin ei löytynyt poistettavia rekisteröintitietoja. '
          + 'Jos et ole varma, käytä sovelluksen sisäistä "Poista tietoni" -toimintoa.',
      });
    }

    const batch = db.batch();
    deviceHashes.forEach((hash) => batch.delete(db.collection('users').doc(hash)));
    await batch.commit();

    return res.json({ deleted: true, count: deviceHashes.size });
  } catch (err) {
    console.error('POST /account-deletion/google error:', err);
    return res.status(500).json({ error: 'Tietojen poisto epäonnistui.' });
  }
});

function renderPage() {
  return `<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tilin ja tietojen poistaminen – ${APP_NAME}</title>
<script src="https://accounts.google.com/gsi/client" async defer></script>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; line-height: 1.55; color: #1a1a1a; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; }
  .lead { color: #555; margin-top: 0; }
  ol, ul { padding-left: 1.25rem; }
  li { margin-bottom: 0.4rem; }
  .box { background: #f4f4f6; border-radius: 10px; padding: 16px 20px; margin: 1rem 0; }
  a { color: #2952cc; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2.5rem 0; }
  .lang-en { color: #333; }
  #google-status { margin-top: 12px; font-size: 0.95rem; }
</style>
</head>
<body>
  <h1>Tilin ja tietojen poistaminen</h1>
  <p class="lead">${APP_NAME}</p>

  <p>${APP_NAME} ei käytä perinteistä käyttäjätiliä (ei sähköpostia eikä salasanaa).
  Laitteesi tunnistetaan sovelluksessa vain salatun (SHA-256) laitetunnisteen avulla,
  emmekä tallenna nimeä, sähköpostiosoitetta tai puhelinnumeroa. Tämän vuoksi tietojesi
  poistaminen onnistuu jommalla kummalla alla olevista tavoista.</p>

  <h2>1. Poista tiedot suoraan sovelluksesta (suositeltu, toimii aina)</h2>
  <div class="box">
    <p>Nopein ja varmin tapa poistaa tietosi pysyvästi:</p>
    <ol>
      <li>Avaa ${APP_NAME} -sovellus</li>
      <li>Siirry kohtaan <strong>Asetukset</strong></li>
      <li>Valitse <strong>”Poista tietoni”</strong> ja vahvista</li>
    </ol>
    <p>Tietosi poistetaan tällöin palvelimelta välittömästi.</p>
  </div>

  <h2>2. Jos olet kirjautunut sovelluksessa Google-tilillä</h2>
  <div class="box">
    <p>Jos olet aiemmin kirjautunut Google-tilillä sovelluksessa äänestääksesi
    jossakin kirjautumista vaativassa äänestyksessä, voit paikantaa ja poistaa
    laitteesi rekisteröintitiedot myös ilman sovellusta kirjautumalla samalla
    Google-tilillä tässä:</p>
    <div id="g_id_onload"
         data-client_id="${GOOGLE_WEB_CLIENT_ID}"
         data-callback="handleGoogleCredential">
    </div>
    <div class="g_id_signin" data-type="standard"></div>
    <p id="google-status"></p>
  </div>

  <h2>3. Jos et ole koskaan kirjautunut Google-tilillä sovelluksessa</h2>
  <p>Sovellus ei tallenna nimeä, sähköpostia eikä mitään muuta tunnistetta kuin
  salatun laitetunnisteen, joten emme valitettavasti pysty paikantamaan tai
  poistamaan tietojasi pelkän sähköpostiviestin perusteella – meillä ei ole
  mitään keinoa yhdistää viestiäsi mihinkään tallennettuun tietueeseen. Käytä
  tässä tapauksessa aina kohdan 1 sovelluksen sisäistä toimintoa. Yleisissä
  tietosuojaan liittyvissä kysymyksissä voit olla yhteydessä osoitteeseen
  <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>

  <h2>4. Mitä tietoja poistetaan</h2>
  <ul>
    <li>Laitetunniste (salattu tiiviste, ei alkuperäistä muotoa)</li>
    <li>Ilmoittamasi maa</li>
    <li>Ilmoittamasi syntymävuosi (jos annettu)</li>
    <li>Käyttöjärjestelmä/alusta (Android/iOS)</li>
    <li>Rekisteröitymisajankohta</li>
  </ul>

  <h2>5. Mitä säilytetään ja miksi</h2>
  <p>Jo annetut äänet säilytetään pysyvästi anonyymissä muodossa osana äänestysten
  julkisia tuloksia – myös poistopyynnön jälkeen. Tämä johtuu siitä, että kerran
  annettu ääni kuuluu äänestyksen lopulliseen tulokseen, eikä tuloksia voida muuttaa jälkikäteen.</p>
  <p>Rekisteröintitiedot (kohta 4) poistetaan automaattisesti viimeistään 12
  kuukauden kuluttua viimeisimmästä rekisteröitymisestä tai äänestyksestä, mikäli
  niitä ei poisteta aiemmin edellä kuvatulla tavalla.</p>

  <p>Lisätietoja tietojenkäsittelystä: <a href="https://directdemocracy-zmon.onrender.com/#tietosuoja">tietosuojaseloste</a>.</p>

  <hr />

  <div class="lang-en">
    <h1>Account &amp; Data Deletion (English)</h1>
    <p>${APP_NAME} does not use a traditional account system (no email/password).
    Your device is identified only by an encrypted (SHA-256) device identifier; we
    never store your name, email address, or phone number. That's why deletion works
    in one of the two ways below.</p>

    <h2>1. Delete your data in the app (recommended, always works)</h2>
    <p>Open the app → <strong>Settings</strong> → <strong>"Poista tietoni"</strong>
    (“Delete my data”) → confirm. Your data is deleted from the server immediately.</p>

    <h2>2. If you signed in with Google in the app</h2>
    <p>If you previously signed in with a Google account in the app to vote in a
    poll that required login, you can sign in with the same Google account above
    to locate and delete your device's registration data, even without the app.</p>

    <h2>3. If you never signed in with Google in the app</h2>
    <p>Since we don't store your name or email, we have no way to match a support
    email to any stored record. Please use the in-app method (section 1) instead.
    For general privacy questions, contact
    <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>

    <h2>4. Data deleted</h2>
    <ul>
      <li>Device identifier (hashed, never stored in raw form)</li>
      <li>Country you provided</li>
      <li>Birth year you provided (if any)</li>
      <li>Platform (Android/iOS)</li>
      <li>Registration timestamp</li>
    </ul>

    <h2>5. Data retained and why</h2>
    <p>Votes already cast remain permanently in anonymized form as part of public
    poll results, even after a deletion request, since a poll's outcome cannot be
    altered retroactively. Registration data (section 4) is automatically deleted
    at the latest 12 months after your last registration or vote, unless deleted
    earlier as described above.</p>
  </div>

  <script>
    async function handleGoogleCredential(response) {
      const statusEl = document.getElementById('google-status');
      statusEl.textContent = 'Käsitellään…';
      try {
        const res = await fetch('/account-deletion/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ googleIdToken: response.credential }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Tuntematon virhe.');
        if (data.deleted) {
          statusEl.textContent = 'Rekisteröintitietosi poistettiin onnistuneesti ('
            + data.count + ' laite' + (data.count === 1 ? '' : 'tta') + ').';
        } else {
          statusEl.textContent = data.message || 'Tiliisi ei löytynyt poistettavia tietoja.';
        }
      } catch (err) {
        statusEl.textContent = 'Virhe: ' + err.message;
      }
    }
  </script>
</body>
</html>`;
}

module.exports = router;
