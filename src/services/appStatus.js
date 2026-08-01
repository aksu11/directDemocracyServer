const { getDb } = require('./firebase');

const CONFIG_COLLECTION = 'config';
const STATUS_DOC_ID = 'appStatus';

const DEFAULT_STATUS = {
  maintenanceMode: false,
  message: '',
  announceFrom: null,
  estimatedEnd: null,
  latestVersion: null,
  updateMessage: '',
};

function toIsoOrNull(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Palauttaa sovelluksen tilan (huoltokatkotiedot). Sovellus tarkistaa tämän
 * käynnistyksessä ja foregroundiin palatessa. Jos dokumenttia ei ole (ei
 * koskaan huoltokatkoa asetettu), palautetaan oletusarvot (kaikki pois päältä).
 */
async function getAppStatus() {
  const db = getDb();
  const doc = await db.collection(CONFIG_COLLECTION).doc(STATUS_DOC_ID).get();
  if (!doc.exists) return { ...DEFAULT_STATUS };

  const data = doc.data();
  return {
    maintenanceMode: data.maintenanceMode === true,
    message: typeof data.message === 'string' ? data.message : '',
    announceFrom: toIsoOrNull(data.announceFrom),
    estimatedEnd: toIsoOrNull(data.estimatedEnd),
    latestVersion: typeof data.latestVersion === 'string' && data.latestVersion ? data.latestVersion : null,
    updateMessage: typeof data.updateMessage === 'string' ? data.updateMessage : '',
  };
}

/**
 * Päivittää sovelluksen huoltokatkotilan (vain superadmin, ks. routes/admin.js).
 *
 * latestVersion: uusin Play Storeen/App Storeen julkaistu versionumero (esim.
 * "1.3.0"). Sovellus vertaa tätä omaan app.json:in versioonsa ja näyttää
 * päivityskehotusbannerin jos oma versio on tätä vanhempi.
 */
async function setAppStatus({ maintenanceMode, message, announceFrom, estimatedEnd, latestVersion, updateMessage }) {
  const db = getDb();
  const data = {
    maintenanceMode: maintenanceMode === true,
    message: typeof message === 'string' ? message.trim().slice(0, 500) : '',
    announceFrom: announceFrom ? new Date(announceFrom) : null,
    estimatedEnd: estimatedEnd ? new Date(estimatedEnd) : null,
    latestVersion: typeof latestVersion === 'string' && latestVersion.trim() ? latestVersion.trim().slice(0, 20) : null,
    updateMessage: typeof updateMessage === 'string' ? updateMessage.trim().slice(0, 500) : '',
    updatedAt: new Date(),
  };
  await db.collection(CONFIG_COLLECTION).doc(STATUS_DOC_ID).set(data, { merge: true });
  return getAppStatus();
}

module.exports = { getAppStatus, setAppStatus };
