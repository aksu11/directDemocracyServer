const express = require('express');
const router = express.Router();
const { getDb } = require('../services/firebase');
const { ENDED_COLLECTION } = require('../services/pollArchive');

// Tämän palvelimen oma julkinen https-osoite (sama domain joka pitää olla
// expo-app/app.json:in android.intentFilters-määrityksessä ja
// /.well-known/assetlinks.json:issa, jotta Android App Links -verifiointi toimii).
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://directdemocracy-4yjp.onrender.com').replace(/\/+$/, '');

// Minne käyttäjä ohjataan jos sovellusta ei ole asennettu (tai App Links ei
// osu). Android-laitteet ohjataan Play Kauppaan (asennus onnistuu suoraan),
// muut (desktop, iOS/Apple) esittelysivulle - Play Store -linkki ei auta heitä
// mitenkään. Kunnes sovellus on julkaistu Play Storessa, PLAY_STORE_URL on
// tyhjä ja kaikki päätyvät esittelysivulle. Vaihda PLAY_STORE_URL kun
// sovellus julkaistaan.
const PLAY_STORE_URL = (process.env.PLAY_STORE_URL || '').trim();
const LANDING_PAGE_URL = process.env.LANDING_PAGE_URL || 'https://directdemocracy-zmon.onrender.com/';

/** Android-laitteet Play Kauppaan (jos asetettu), kaikki muut esittelysivulle. */
function resolveFallbackUrl(userAgent) {
  const isAndroid = /Android/i.test(userAgent || '');
  return isAndroid && PLAY_STORE_URL ? PLAY_STORE_URL : LANDING_PAGE_URL;
}

// Kasvatetaan aina kun jakokuvien (dd-share.jpg TAI resultImage.js:n
// piirtämä päättyneen äänestyksen kuva) ulkoasu muuttuu. Facebook/WhatsApp
// yms. cachettaavat og:image-tiedoston omalla puolellaan pitkäksi aikaa eivätkä
// välttämättä hae sitä uudelleen vaikka sivun "Scrape Again" ajetaan - vain
// itse kuva-URL:n muuttuminen pakottaa tuoreen haun. Muista kasvattaa tätä
// aina kun kuvan ulkoasua muutetaan, olipa kyse staattisesta tai dynaamisesta
// kuvasta (ks. 2026-08-04: 300x300 QR-koodin lisäys jäi jumiin vanhaan
// cachettuun kuvaan ilman tätä).
const IMAGE_VERSION = 2;

// JPEG eikä PNG, koska WhatsApp hylkää hiljaisesti liian suuret og:image-tiedostot
// (alkuperäinen PNG oli ~1 MB, JPEG-pakkauksella ~100 KB).
const OG_IMAGE_URL = process.env.OG_IMAGE_URL || `${PUBLIC_BASE_URL}/share/dd-share.jpg?v=${IMAGE_VERSION}`;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderSharePage({ title, description, url, imageUrl, imageType, fallbackUrl }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeUrl = escapeHtml(url);
  const safeFallback = escapeHtml(fallbackUrl);
  const safeImage = escapeHtml(imageUrl || OG_IMAGE_URL);

  return `<!DOCTYPE html>
<html lang="fi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle} – Suora Demokratia</title>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Suora Demokratia" />
<meta property="og:title" content="${safeTitle}" />
<meta property="og:description" content="${safeDescription}" />
<meta property="og:image" content="${safeImage}" />
<meta property="og:image:type" content="${imageType || 'image/jpeg'}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="${safeUrl}" />
<meta name="twitter:card" content="summary_large_image" />
</head>
<body>
<p>Avataan Suora Demokratia -sovellusta…</p>
<p>Jos sovellus ei avautunut automaattisesti, <a href="${safeFallback}">jatka tästä</a>.</p>
<script>
  // JS-uudelleenohjaus meta-refreshin sijaan: some-crawlerit (Facebook/WhatsApp/
  // Twitter yms.) eivät suorita JavaScriptiä, joten ne pysähtyvät lukemaan tämän
  // sivun omat OG-tagit sen sijaan että seuraisivat uudelleenohjausta ja päätyisivät
  // lukemaan laskeutumissivun tagit (mikä aiemmin aiheutti väärän otsikon/kuvan).
  window.location.replace(${JSON.stringify(fallbackUrl)});
</script>
</body>
</html>`;
}

/** Hakee äänestyksen ensin avoimista, sitten arkistoiduista (päättyneistä). */
async function findPoll(pollId) {
  const db = getDb();
  const activeDoc = await db.collection('polls').doc(pollId).get();
  if (activeDoc.exists) return { id: activeDoc.id, ended: false, ...activeDoc.data() };

  const endedDoc = await db.collection(ENDED_COLLECTION).doc(pollId).get();
  if (endedDoc.exists) return { id: endedDoc.id, ended: true, ...endedDoc.data() };

  return null;
}

/**
 * GET /polls/:id ja GET /ended/:id
 *
 * Palvelinpuolella renderöity HTML Open Graph -tageilla Facebookin/WhatsAppin
 * esikatselua varten. Jos laitteella on sovellus asennettuna ja Android App
 * Links on verifioitu, käyttöjärjestelmä avaa suoraan sovelluksen eikä tämä
 * sivu koskaan lataudu selaimeen – tämä on siis vain fallback niille joilla
 * sovellusta ei ole.
 */
router.get(['/polls/:id', '/ended/:id'], async (req, res) => {
  const kind = req.path.startsWith('/ended') ? 'ended' : 'polls';
  const pollId = req.params.id;

  const fallbackUrl = resolveFallbackUrl(req.header('User-Agent'));

  try {
    const poll = await findPoll(pollId);
    const url = `${PUBLIC_BASE_URL}/${kind}/${pollId}`;

    if (!poll) {
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(renderSharePage({
        title: 'Äänestystä ei löytynyt',
        description: 'Suora Demokratia – suoran demokratian äänestyssovellus.',
        url,
        fallbackUrl,
      }));
    }

    const description = poll.ended
      ? 'Äänestys on päättynyt. Katso lopullinen tulos Suora Demokratia -sovelluksessa.'
      : (poll.description
        ? String(poll.description).slice(0, 200)
        : 'Osallistu äänestykseen Suora Demokratia -sovelluksessa.');

    // Päättyneelle äänestykselle jaetaan geneerisen maisemakuvan sijaan
    // renderöity tulosnäkymä (ks. routes/shareImage.js).
    const imageUrl = poll.ended ? `${PUBLIC_BASE_URL}/share-image/ended/${pollId}?v=${IMAGE_VERSION}` : undefined;
    const imageType = poll.ended ? 'image/png' : undefined;

    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(renderSharePage({ title: poll.question, description, url, imageUrl, imageType, fallbackUrl }));
  } catch (err) {
    console.error(`GET /${kind}/:id (share) error:`, err);
    return res.status(500).send('Internal server error.');
  }
});

module.exports = router;
