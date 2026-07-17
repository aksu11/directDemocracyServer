const { Expo } = require('expo-server-sdk');
const { getDb } = require('./firebase');
const { isEligible } = require('../data/geography');

// Valinnainen: Expon "Enhanced Security" -access token, jos käytössä
// (https://docs.expo.dev/push-notifications/sending-notifications/#additional-security).
const expo = new Expo(
  process.env.EXPO_ACCESS_TOKEN ? { accessToken: process.env.EXPO_ACCESS_TOKEN } : undefined
);

/**
 * Lähettää push-ilmoituksen uudesta äänestyksestä kaikille käyttäjille jotka:
 *  - ovat sallineet ilmoitukset (notificationsEnabled !== false, oletus päällä),
 *  - joilla on tallennettu kelvollinen Expo push -token,
 *  - ovat äänestyksen kohteryhmää (sama scope/maa + ikäraja, ks. data/geography.js
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
    const db = getDb();
    const snapshot = await db.collection('users').get();

    const messages = [];
    snapshot.docs.forEach((doc) => {
      const user = doc.data();
      if (user.notificationsEnabled === false) return;
      if (!user.pushToken || !Expo.isExpoPushToken(user.pushToken)) return;
      if (!isEligible(user, poll)) return;

      messages.push({
        to: user.pushToken,
        sound: 'default',
        title: 'Uusi äänestys',
        body: poll.question,
        data: { pollId },
      });
    });

    if (messages.length === 0) return;

    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try {
        await expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        console.error('Push-ilmoitusten lähetys epäonnistui (chunk):', err);
      }
    }
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
 * Toisin kuin sendNewPollNotification, tämä EI nieläise virheitä - kutsuja
 * (admin.js:n POST /admin/notify-update) odottaa vastauksen ja näyttää sen
 * suoraan adminille, joten virheiden pitää kulkeutua sinne asti.
 *
 * @param {string} message
 * @returns {Promise<number>} kuinka monelle laitteelle ilmoitus lähetettiin
 */
async function sendUpdateNotification(message) {
  const db = getDb();
  const snapshot = await db.collection('users').get();

  const messages = [];
  snapshot.docs.forEach((doc) => {
    const user = doc.data();
    if (user.notificationsEnabled === false) return;
    if (!user.pushToken || !Expo.isExpoPushToken(user.pushToken)) return;

    messages.push({
      to: user.pushToken,
      sound: 'default',
      title: 'Sovellus päivittyi',
      body: message,
    });
  });

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      console.error('Push-ilmoitusten lähetys epäonnistui (chunk):', err);
    }
  }

  return messages.length;
}

module.exports = { sendNewPollNotification, sendUpdateNotification };
