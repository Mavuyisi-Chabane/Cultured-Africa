// Bump PRIVACY_POLICY_VERSION whenever views/privacy.ejs changes in a way customers
// should re-agree to: everyone who consented to an older version is asked again on
// their next request (see the consent gate in server.js).
const PRIVACY_POLICY_VERSION = '2026-10-04';
const PRIVACY_POLICY_UPDATED = '4 October 2026';

module.exports = { PRIVACY_POLICY_VERSION, PRIVACY_POLICY_UPDATED };
