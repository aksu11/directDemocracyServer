const { getDb } = require('./firebase');
const { getStorage } = require('firebase-admin/storage');

const BANNERS_COLLECTION = 'banners';

/**
 * Muuntaa Firebase Storagen "gs://bucket/polku" -osoitteen tilapäiseksi
 * https-osoitteeksi, jonka selain/sovellus voi ladata suoraan kuvana.
 */
async function resolveImageUrl(gsUri) {
  if (!gsUri || typeof gsUri !== 'string' || !gsUri.startsWith('gs://')) {
    return gsUri || null;
  }

  const withoutScheme = gsUri.slice('gs://'.length);
  const slashIdx = withoutScheme.indexOf('/');
  if (slashIdx === -1) return null;
  const bucketName = withoutScheme.slice(0, slashIdx);
  const filePath = withoutScheme.slice(slashIdx + 1);

  try {
    const bucket = getStorage().bucket(bucketName);
    const [url] = await bucket.file(filePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 24 * 60 * 60 * 1000, // 24h
    });
    return url;
  } catch (err) {
    console.error('Bannerin kuvan URL:n muodostus epäonnistui:', err);
    return null;
  }
}

/**
 * Palauttaa sovelluksessa näytettävän aktiivisen bannerin, tai null jos
 * yhtään banneria ei ole merkitty aktiiviseksi.
 */
async function getActiveBanner() {
  const db = getDb();
  const snapshot = await db
    .collection(BANNERS_COLLECTION)
    .where('isActive', '==', true)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  const data = doc.data();
  return {
    id: doc.id,
    imageUrl: await resolveImageUrl(data.imageUrl),
    linkUrl: data.linkUrl || null,
  };
}

/**
 * Merkitsee annetun bannerin aktiiviseksi ja poistaa aktiivisuuden kaikilta
 * muilta bannereilta (vain yksi banneri voi olla aktiivinen kerrallaan).
 */
async function setActiveBanner(bannerId) {
  const db = getDb();
  const bannerRef = db.collection(BANNERS_COLLECTION).doc(bannerId);
  const bannerDoc = await bannerRef.get();
  if (!bannerDoc.exists) {
    throw new Error('Banneria ei löytynyt.');
  }

  const activeSnapshot = await db.collection(BANNERS_COLLECTION).where('isActive', '==', true).get();
  const batch = db.batch();
  activeSnapshot.docs.forEach((doc) => {
    if (doc.id !== bannerId) {
      batch.update(doc.ref, { isActive: false });
    }
  });
  batch.update(bannerRef, { isActive: true, updatedAt: new Date() });
  await batch.commit();

  return { id: bannerId, ...bannerDoc.data(), isActive: true };
}

module.exports = { getActiveBanner, setActiveBanner, resolveImageUrl };
