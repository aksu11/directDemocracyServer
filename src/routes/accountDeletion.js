const express = require('express');
const router = express.Router();

const APP_NAME = 'Suora Demokratia (Direct Democracy)';

/**
 * GET /account-deletion (ja alias /poista-tili)
 *
 * Googlen Play Console -tietosuojaosion ("Poista tilin URL-osoite") vaatima
 * julkinen sivu. Sovelluksessa ei ole perinteistä käyttäjätiliä eikä mitään
 * henkilöä yksilöivää tietoa (ei nimeä, sähköpostia, puhelinnumeroa) – laite
 * tunnistetaan vain sen itsensä tuntemalla salatulla (SHA-256) laitetunnisteella.
 * Tämän vuoksi ainoa toimiva poistotapa on sovelluksen sisäinen "Poista tietoni"
 * -toiminto (ks. routes/register.js DELETE /) – ulkopuolinen taho ei voi
 * jälkikäteen yhdistää ketään nimeen/sähköpostiin tallennettuun tietueeseen.
 */
router.get(['/account-deletion', '/poista-tili'], (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderPage());
});

function renderPage() {
  return `<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tilin ja tietojen poistaminen – ${APP_NAME}</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; line-height: 1.55; color: #1a1a1a; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .lead { color: #555; margin-top: 0; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2.5rem 0; }
</style>
</head>
<body>
  <h1>Tilin ja tietojen poistaminen</h1>
  <p class="lead">${APP_NAME}</p>

  <p>Anonyymit äänet eivät sisällä mitään henkilöä yksilöivää tietoa (ei nimeä,
  sähköpostia tai muuta tunnistetta), joten niitä ei voida hakea tai poistaa
  nimen/sähköpostin perusteella jälkikäteen. Suosittelemme käyttämään
  sovelluksen sisäistä "Poista tietoni" -toimintoa asetuksista ennen
  sovelluksen poistamista laitteelta, koska vain sovellus itse osaa tunnistaa
  oman laitteensa tiedot.</p>

  <hr />

  <h1>Account &amp; Data Deletion (English)</h1>
  <p class="lead">${APP_NAME}</p>

  <p>Anonymous votes do not contain any personally identifying information (no
  name, email, or other identifier), so they cannot be looked up or deleted
  based on a name/email afterwards. We recommend using the app's built-in
  "Delete my data" feature in Settings before removing the app from your
  device, since only the app itself can identify its own device's data.</p>
</body>
</html>`;
}

module.exports = router;
