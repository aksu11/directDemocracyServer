const { Expo } = require('expo-server-sdk');
const { getDb } = require('./firebase');
const { isEligible } = require('../data/geography');

// Valinnainen: Expon "Enhanced Security" -access token, jos käytössä
// (https://docs.expo.dev/push-notifications/sending-notifications/#additional-security).
const expo = new Expo(
  process.env.EXPO_ACCESS_TOKEN ? { accessToken: process.env.EXPO_ACCESS_TOKEN } : undefined
);

// Androidilla FCM:n "normal" prioriteetin viestit jäävät odottamaan laitteen
// seuraavaa heräämistä Doze-tilassa - käytännössä ilmoitus voi tulla perille
// vasta tuntien päästä. Uusi äänestys on aikakriittinen (äänestysaika on
// rajattu), joten lähetetään aina korkealla prioriteetilla, jolloin FCM
// herättää laitteen heti.
//
// channelId täytyy asettaa erikseen: ilman sitä expo-notifications näyttää
// ilmoituksen omassa varakanavassaan eikä sovelluksen luomassa kanavassa,
// jolloin kanavalle asetettu tärkeys (HIGH) ja käyttäjän kanavakohtaiset
// asetukset eivät päde. Arvon täytyy vastata NOTIFICATION_CHANNEL_ID:tä
// tiedostossa expo-app/src/utils/notifications.ts.
const ANDROID_DELIVERY = {
  priority: 'high',
  channelId: 'polls-v2',
};

/**
 * Lukee users-kokoelman ja kerää vastaanottajat, joilla on ilmoitukset päällä
 * ja kelvollinen Expo push -token.
 *
 * Palauttaa myös token -> dokumentin id -kartan, jotta kuolleet tokenit
 * (DeviceNotRegistered) voidaan siivota kannasta lähetyksen jälkeen.
 *
 * @param {(user: object) => boolean} [filterFn] valinnainen lisärajaus (esim. isEligible)
 * @returns {Promise<{ messages: object[], tokenToDocId: Map<string, string> }>}
 */
async function collectRecipients(filterFn) {
  const db = getDb();
  const snapshot = await db.collection('users').get();

  const recipients = [];
  const tokenToDocId = new Map();

  snapshot.docs.forEach((doc) => {
    const user = doc.data();
    if (user.notificationsEnabled === false) return;
    if (!user.pushToken || !Expo.isExpoPushToken(user.pushToken)) return;
    if (filterFn && !filterFn(user)) return;

    recipients.push(user.pushToken);
    tokenToDocId.set(user.pushToken, doc.id);
  });

  return { recipients, tokenToDocId };
}

/**
 * Nollaa käyttäjän pushToken-kentän kun Expo kertoo ettei laite ole enää
 * rekisteröity (sovellus poistettu, token kierrätetty tms.). Ilman tätä
 * kuolleet tokenit jäävät kantaan pysyvästi, kasvattavat jokaista lähetystä
 * ja voivat johtaa Expon puolella rajoituksiin.
 *
 * notificationsEnabled jätetään ennalleen - käyttäjä ei ole itse kieltänyt
 * ilmoituksia, joten uusi token otetaan taas käyttöön kun sovellus
 * rekisteröi sellaisen.
 *
 * @param {string[]} docIds
 */
async function clearDeadTokens(docIds) {
  if (docIds.length === 0) return;
  try {
    const db = getDb();
    const batch = db.batch();
    docIds.forEach((id) => {
      batch.set(
        db.collection('users').doc(id),
        { pushToken: null, pushTokenUpdatedAt: null },
        { merge: true }
      );
    });
    await batch.commit();
    console.log(`Siivottiin ${docIds.length} kuollutta push-tokenia.`);
  } catch (err) {
    console.error('Kuolleiden push-tokenien siivous epäonnistui:', err);
  }
}

/**
 * Lähettää viestit Expolle chunkeissa ja tarkistaa palautetut tiketit.
 *
 * Expo palauttaa tiketit samassa järjestyksessä kuin lähetetyt viestit, joten
 * virheellinen tiketti voidaan yhdistää takaisin tokeniin ja sitä kautta
 * käyttäjädokumenttiin. Aiemmin tiketit heitettiin menemään, jolloin
 * epäonnistuneet lähetykset olivat täysin näkymättömiä.
 *
 * @param {object[]} messages
 * @param {Map<string, string>} tokenToDocId
 * @returns {Promise<number>} onnistuneesti Expolle välitettyjen viestien määrä
 */
async function sendMessages(messages, tokenToDocId) {
  const chunks = expo.chunkPushNotifications(messages);
  const deadDocIds = [];
  let accepted = 0;

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket, i) => {
        if (ticket.status === 'ok') {
          accepted += 1;
          return;
        }
        const token = chunk[i].to;
        const error = ticket.details && ticket.details.error;
        if (error === 'DeviceNotRegistered') {
          const docId = tokenToDocId.get(token);
          if (docId) deadDocIds.push(docId);
        } else {
          console.error('Push-tiketti epäonnistui:', error || ticket.message);
        }
      });
    } catch (err) {
      console.error('Push-ilmoitusten lähetys epäonnistui (chunk):', err);
    }
  }

  await clearDeadTokens(deadDocIds);
  return accepted;
}

/**
 * Lähettää push-ilmoituksen uudesta äänestyksestä kaikille käyttäjille jotka:
 *  - ovat sallineet ilmoitukset (notificationsEnabled !== false, oletus päällä),
 *  - joilla on tallennettu kelvollinen Expo push -token,
 *  - ovat äänestyksen kohderyhmää (sama scope/maa + ikäraja, ks. data/geography.js
 *    isEligible - ei mielekästä ilmoittaa äänestyksestä jota käyttäjä ei voi nähdä).
 *
 * Kutsutaan admin.js:stä äänestyksen luonnin jälkeen. Virheitä ei koskaan
 * heitetä eteenpäin - ilmoitusten lähetys ei saa estää äänestyksen luontia.
 *
 * @param {{ question: string, scope: string, scopeCountry?: string, isPolitical?: boolean }} poll
 * @param {string} pollId
 */
async function sendNewPollNotification(poll, pollId) {
  try {
    const { recipients, tokenToDocId } = await collectRecipients((user) => isEligible(user, poll));
    if (recipients.length === 0) return;

    const messages = recipients.map((token) => ({
      to: token,
      sound: 'default',
      title: 'Uusi äänestys',
      body: poll.question,
      data: { pollId },
      ...ANDROID_DELIVERY,
    }));

    const accepted = await sendMessages(messages, tokenToDocId);
    console.log(`Uusi äänestys ${pollId}: ${accepted}/${messages.length} ilmoitusta välitetty.`);
  } catch (err) {
    console.error('sendNewPollNotification epäonnistui:', err);
  }
}

/**
 * Lähettää push-ilmoituksen KAIKILLE ilmoitukset sallineille käyttäjille joilla on
 * kelvollinen push-token - ilman äänestyskohtaista kohderyhmärajausta (isEligible),
 * koska kyse ei ole yksittäisestä äänestyksestä vaan koko sovelluksen päivityksestä,
 * joka koskee kaikkia käyttäjiä riippumatta maasta/iästä.
 *
 * Toisin kuin sendNewPollNotification, tämä EI nielaise virheitä - kutsuja
 * (admin.js:n POST /admin/notify-update) odottaa vastauksen ja näyttää sen
 * suoraan adminille, joten virheiden pitää kulkeutua sinne asti.
 *
 * @param {string} message
 * @returns {Promise<number>} kuinka monelle laitteelle ilmoitus välitettiin
 */
async function sendUpdateNotification(message) {
  const { recipients, tokenToDocId } = await collectRecipients();

  const messages = recipients.map((token) => ({
    to: token,
    sound: 'default',
    title: 'Sovellus päivittyi',
    body: message,
    ...ANDROID_DELIVERY,
  }));

  return sendMessages(messages, tokenToDocId);
}

module.exports = { sendNewPollNotification, sendUpdateNotification };
