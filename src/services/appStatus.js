const { getDb } = require('./firebase');

const CONFIG_COLLECTION = 'config';
const STATUS_DOC_ID = 'appStatus';

const DEFAULT_STATUS = {
  maintenanceMode: false,
  message: '',
  announceFrom: null,
  estimatedEnd: null,
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
  };
}

/**
 * Päivittää sovelluksen huoltokatkotilan (vain superadmin, ks. routes/admin.js).
 */
async function setAppStatus({ maintenanceMode, message, announceFrom, estimatedEnd }) {
  const db = getDb();
  const data = {
    maintenanceMode: maintenanceMode === true,
    message: typeof message === 'string' ? message.trim().slice(0, 500) : '',
    announceFrom: announceFrom ? new Date(announceFrom) : null,
    estimatedEnd: estimatedEnd ? new Date(estimatedEnd) : null,
    updatedAt: new Date(),
  };
  await db.collection(CONFIG_COLLECTION).doc(STATUS_DOC_ID).set(data, { merge: true });
  return getAppStatus();
}

module.exports = { getAppStatus, setAppStatus };
