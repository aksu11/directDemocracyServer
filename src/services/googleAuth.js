const { OAuth2Client } = require('google-auth-library');

/**
 * googleAuth.js – Google ID-tokenin varmennus äänestyksille, jotka vaativat kirjautumisen.
 *
 * Client käyttää expo-auth-session:ia saadakseen Googlelta allekirjoitetun ID-tokenin
 * (JWT). Tämä palvelu varmentaa tokenin allekirjoituksen ja yleisön (audience) suoraan
 * Googlen kirjaston avulla – erillistä Firebase Authia ei tarvita.
 *
 * GOOGLE_CLIENT_IDS-ympäristömuuttuja sisältää pilkulla erotetut client id:t
 * (web, iOS, Android), jotka expo-auth-session voi tuottaa. Tokenin "aud"-kentän
 * täytyy täsmätä johonkin näistä.
 */

let _client = null;
let _allowedAudiences = null;

function getAllowedAudiences() {
  if (_allowedAudiences === null) {
    _allowedAudiences = (process.env.GOOGLE_CLIENT_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }
  return _allowedAudiences;
}

function getClient() {
  if (!_client) {
    _client = new OAuth2Client();
  }
  return _client;
}

/**
 * Varmentaa Googlen ID-tokenin ja palauttaa käyttäjän uniikin Google-tunnisteen.
 *
 * Tietojen minimoinnin periaatteen mukaisesti palautetaan VAIN "sub" (uid) –
 * ei sähköpostia, nimeä eikä muita henkilötietoja, koska kaksoisäänestyksen
 * estoon riittää pelkkä uniikki tunniste.
 *
 * @param {string} idToken - Clientin lähettämä Google ID-token (JWT).
 * @returns {Promise<{ googleUid: string }>}
 * @throws {Error} jos token puuttuu, on virheellinen tai audience ei täsmää.
 */
async function verifyGoogleIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('googleIdToken puuttuu.');
  }

  const audiences = getAllowedAudiences();
  if (audiences.length === 0) {
    throw new Error('Palvelinta ei ole määritelty Google-kirjautumista varten (GOOGLE_CLIENT_IDS puuttuu).');
  }

  const client = getClient();
  const ticket = await client.verifyIdToken({ idToken, audience: audiences });
  const payload = ticket.getPayload();

  if (!payload || !payload.sub) {
    throw new Error('Google-tokenin varmennus epäonnistui.');
  }

  return { googleUid: payload.sub };
}

module.exports = { verifyGoogleIdToken };
