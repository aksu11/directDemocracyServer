require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { initFirebase } = require('./services/firebase');
const { archiveEndedPolls } = require('./services/pollArchive');
const pollsRouter = require('./routes/polls');
const votesRouter = require('./routes/votes');
const adminRouter = require('./routes/admin');
const registerRouter = require('./routes/register');
const geoRouter      = require('./routes/geo');
const shareRouter    = require('./routes/share');
const shareImageRouter = require('./routes/shareImage');
const wellKnownRouter = require('./routes/wellKnown');
const statusRouter    = require('./routes/status');
const accountDeletionRouter = require('./routes/accountDeletion');

const ARCHIVE_INTERVAL_MS = 10 * 60 * 1000; // 10 min

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers – relax CSP so the admin page can load inline scripts
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  })
);

// CORS: natiivisovellukset (Android/iOS) eivät lähetä Origin-headeria, joten
// ne eivät koskaan törmää tähän. Rajaus koskee vain selaimesta (web) tehtyjä
// pyyntöjä, esim. Expo-sovelluksen web-esikatselua paikallisessa kehityksessä.
// Lisää tuotannon web-osoitteet CORS_ORIGINS-ympäristömuuttujaan (pilkulla erotettuna).
app.set('trust proxy', 1);

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    const isAllowed =
      // Ei Origin-headeria (natiivisovellukset, curl, palvelin-palvelin) -> salli
      !origin ||
      // Paikallinen kehitys (127.0.0.1/localhost, mikä tahansa portti)
      /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
      allowedOrigins.includes(origin) ||
      // Sama origin kuin palvelin itse (esim. tämän palvelimen oma
      // /admin/admin.html kutsuu /api/admin/polls). Selain lähettää
      // Origin-headerin myös samasta originista tehdyille POST/PUT/DELETE-
      // pyynnöille, joten se pitää sallia erikseen tässä.
      isSameOrigin(origin, req);
    callback(isAllowed ? null : new Error('Not allowed by CORS'), { origin: isAllowed });
  })
);

function isSameOrigin(origin, req) {
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Parse JSON bodies (limit size to reduce DoS surface)
app.use(express.json({ limit: '16kb' }));

// Initialize Firebase before registering routes
initFirebase();

// Siirrä päättyneet äänestykset arkistoon käynnistyksessä ja sen jälkeen säännöllisesti
archiveEndedPolls().catch((err) => console.error('Äänestysten arkistointi epäonnistui:', err));
setInterval(() => {
  archiveEndedPolls().catch((err) => console.error('Äänestysten arkistointi epäonnistui:', err));
}, ARCHIVE_INTERVAL_MS);

// Serve static admin page
app.get('/admin', (req, res) => res.redirect('/admin/admin.html'));
app.use('/admin', express.static(path.join(__dirname, '..', 'public')));

// Jaettava kuva (Open Graph -esikatselukortti)
app.use('/share', express.static(path.join(__dirname, '..', 'public', 'share')));

// Android App Links -verifiointi (https://developer.android.com/training/app-links/verify-android-applinks)
app.use('/.well-known', wellKnownRouter);

// Routes
app.use('/api/polls', pollsRouter);
app.use('/api/votes', votesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/register', registerRouter);
app.use('/api/geo', geoRouter);
app.use('/api/status', statusRouter);

// Jaettavat äänestyslinkit (/polls/:id, /ended/:id) – palvelinpuolella renderöity
// HTML Open Graph -tageilla somejakoa varten + fallback niille joilla appia ei ole.
app.use(shareRouter);

// Päättyneen äänestyksen tulosnäkymä og:image-kuvana (ks. routes/share.js).
app.use(shareImageRouter);

// Tilin/tietojen poisto -ohjesivu (Google Play -tietosuojaosion vaatima linkki).
app.use(accountDeletionRouter);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  const status = Number.isInteger(err.status || err.statusCode) ? (err.status || err.statusCode) : 500;
  const message = status >= 400 && status < 500 ? err.message || 'Request error.' : 'Internal server error.';
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`DirectDemocracy backend running on port ${PORT}`);
});

module.exports = app;
