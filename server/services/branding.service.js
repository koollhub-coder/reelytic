const { getDb } = require('../db');

/*
  Per-account report branding (logo, accent color, agency name) used by the
  branded-report preview/print page. Stored directly on the users doc as one
  additive object -- same "extra field nobody else reads" pattern as
  activeJobs, no new collection needed. Absent on every account until they
  save it once; callers must treat missing fields as "not set yet", never
  fabricate a default logo/color.

  Logo is stored as the data URI itself (not a file path/URL) -- the app has
  no object storage wired up, and Render's filesystem is ephemeral (wiped on
  every deploy), so a saved file path would silently go stale on the next
  deploy. A small (<=1MB) image inlined as a data URI has no such problem
  and needs no new infrastructure. Documents this size are trivial against
  MongoDB's 16MB document limit.

  1MB, not larger: base64 inflates the raw file by ~4/3, and the whole
  PATCH body (this field plus everything else in the request) has to clear
  server/index.js's express.json({ limit: '2mb' }) body-size cap. 1MB raw
  comes in around 1.33MB encoded, leaving headroom under that -- a bigger
  cap here would need raising the body limit too.
*/

const MAX_LOGO_BYTES = 1024 * 1024;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const LOGO_TYPE_NAMES = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/svg+xml': 'SVG', 'image/webp': 'WEBP' };
const ALLOWED_LOGO_TYPES = Object.keys(LOGO_TYPE_NAMES);
const LOGO_POSITIONS = ['left', 'center', 'right'];

/*
  The one place the logo rules live. GET /settings/report-branding sends
  this to Settings, which shows it under the upload box and checks a file
  against it before upload, so the page can never promise a different limit
  than the one enforced below.
*/
const LOGO_LIMITS = Object.freeze({
  maxBytes: MAX_LOGO_BYTES,
  types: ALLOWED_LOGO_TYPES,
  typeNames: ALLOWED_LOGO_TYPES.map((t) => LOGO_TYPE_NAMES[t]),
});
const LOGO_TYPE_ERROR = `Logo must be a ${LOGO_LIMITS.typeNames.slice(0, -1).join(', ')} or ${LOGO_LIMITS.typeNames.slice(-1)} file.`;
const LOGO_SIZE_ERROR = `Logo file is too large. Use an image under ${MAX_LOGO_BYTES / (1024 * 1024)}MB.`;

async function getReportBranding(username) {
  const db = getDb();
  const user = await db.collection('users').findOne({ username });
  return (user && user.reportBranding) || null;
}

// Throws a plain Error with a client-safe message on invalid input -- the
// route handler turns that into a 400, never a 500.
async function setReportBranding(username, { logoDataUri, accentColor, agencyName, logoPosition, showAgencyName, showHighlights }) {
  const update = {};

  if (logoDataUri !== undefined) {
    if (logoDataUri === null || logoDataUri === '') {
      update.logoDataUri = null;
    } else {
      const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(logoDataUri);
      if (!match) throw new Error('Logo must be an uploaded image file.');
      const [, mime, base64] = match;
      if (!ALLOWED_LOGO_TYPES.includes(mime.toLowerCase())) {
        throw new Error(LOGO_TYPE_ERROR);
      }
      // Rough byte size from base64 length -- exact enough for a UX-level
      // cap, not a security boundary (the request body size limit in
      // server/index.js is the real backstop).
      const approxBytes = Math.floor(base64.length * 0.75);
      if (approxBytes > MAX_LOGO_BYTES) {
        throw new Error(LOGO_SIZE_ERROR);
      }
      update.logoDataUri = logoDataUri;
    }
  }

  if (accentColor !== undefined) {
    if (accentColor === null || accentColor === '') {
      update.accentColor = null;
    } else if (!HEX_COLOR_RE.test(accentColor)) {
      throw new Error('Accent color must be a hex value like #E23E57.');
    } else {
      update.accentColor = accentColor;
    }
  }

  if (agencyName !== undefined) {
    const clean = String(agencyName || '').trim().slice(0, 60);
    update.agencyName = clean || null;
  }

  if (logoPosition !== undefined) {
    if (!LOGO_POSITIONS.includes(logoPosition)) throw new Error('Logo position must be left, center, or right.');
    update.logoPosition = logoPosition;
  }

  if (showAgencyName !== undefined) update.showAgencyName = !!showAgencyName;
  if (showHighlights !== undefined) update.showHighlights = !!showHighlights;

  if (Object.keys(update).length === 0) return getReportBranding(username);

  const db = getDb();
  await db.collection('users').updateOne({ username }, { $set: { reportBranding: { ...(await getReportBranding(username)), ...update } } });
  return getReportBranding(username);
}

module.exports = { getReportBranding, setReportBranding, MAX_LOGO_BYTES, LOGO_LIMITS };
