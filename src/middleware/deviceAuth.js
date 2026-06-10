const crypto = require('crypto');

/**
 * Middleware: validates the device payload sent from the Android client.
 *
 * Expected request body fields:
 *   deviceId  {string}  – ANDROID_ID (or equivalent unique device identifier)
 *   isEmulator {boolean} – result of the client-side isLikelyEmulator() check
 *
 * The middleware:
 *  1. Rejects requests missing a deviceId.
 *  2. Rejects requests where the client reports isEmulator === true.
 *  3. Attaches a SHA-256 hash of the deviceId to req.deviceHash so routes
 *     never store the raw identifier.
 */
function deviceAuth(req, res, next) {
  const { deviceId, isEmulator } = req.body;

  if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
    return res.status(400).json({ error: 'Missing or invalid deviceId.' });
  }

  // Reject emulators reported by the client
  if (isEmulator === true) {
    return res.status(403).json({ error: 'Voting from emulators is not allowed.' });
  }

  // Store only a salted hash – never persist the raw device ID
  const salt = process.env.DEVICE_ID_SALT || 'default-salt-change-me';
  req.deviceHash = crypto
    .createHmac('sha256', salt)
    .update(deviceId.trim())
    .digest('hex');

  next();
}

module.exports = { deviceAuth };
