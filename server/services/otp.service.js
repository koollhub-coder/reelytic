/*
  Email-verification OTPs for self-service signup only (see auth.routes.js
  POST /signup and POST /verify-otp). Google signups and admin-provisioned
  clients never touch this -- Google already verifies the address itself,
  and an admin typing a client's email in directly is the admin vouching for
  it, same reasoning /change-password's mustChangePassword gate already
  applies to admin-provisioned accounts.

  One pending code per account (username is the unique key -- see db.js's
  otps index), and requesting a new one replaces the old one outright rather
  than allowing several valid codes to exist at once. The code itself is
  stored as a SHA-256 hash, not plaintext: a 6-digit code has only 10^6
  possibilities so hashing alone is not the brute-force defense (the attempt
  cap below is), but there's no reason a raw code needs to sit readable in
  the database either.
*/

const crypto = require('crypto');
const { getDb } = require('../db');

const CODE_LENGTH = 6;
const EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

// crypto.randomInt, not Math.random -- this is the one thing standing
// between an account and anyone who can guess it, so it gets the real
// CSPRNG even though generateTempPassword() elsewhere in this codebase
// doesn't bother for a password the admin hands over out-of-band anyway.
function generateCode() {
  return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/*
  Creates (or replaces) the pending code for `username`. Returns the raw
  code AND a raw link token so the caller can email both -- this is the only
  place either plaintext value ever exists outside the user's inbox. The
  link token is the "click to verify instead of typing" alternative: same
  record, same expiry, same one-shot deletion-on-success, just a second way
  in. It's long and random (32 random bytes) rather than 6 digits precisely
  because it's meant to be unguessable on its own -- the OTP's real defense
  is the attempt cap, not the codespace, but a URL token has no attempt cap
  to lean on (a single request that has the right token IS success), so it
  needs to be the thing that's actually hard to find.

  Throws if a code was already issued inside the resend cooldown, so a
  caller (the /signup and /resend-otp routes) can turn that into a 429
  rather than silently re-sending and resetting the timer on every accidental
  double-click.
*/
async function issueOtp(username, email) {
  const db = getDb();
  const existing = await db.collection('otps').findOne({ username });
  if (existing && Date.now() - new Date(existing.lastSentAt).getTime() < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - new Date(existing.lastSentAt).getTime())) / 1000);
    const err = new Error(`Wait ${waitSec}s before requesting another code.`);
    err.code = 'COOLDOWN';
    err.waitSeconds = waitSec;
    throw err;
  }

  const code = generateCode();
  const linkToken = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  await db.collection('otps').updateOne(
    { username },
    {
      $set: {
        username,
        email,
        codeHash: hashCode(code),
        linkTokenHash: hashCode(linkToken),
        expiresAt: new Date(now.getTime() + EXPIRY_MS),
        attempts: 0,
        lastSentAt: now,
      },
    },
    { upsert: true }
  );
  return { code, linkToken };
}

/*
  Verifies a submitted code. Returns { ok: true } on success (and deletes the
  record, so the same code can't be replayed), or { ok: false, reason } on
  failure -- reason is one of 'no-pending' | 'expired' | 'too-many-attempts' |
  'incorrect', which the route turns into a client-safe message.

  Every wrong guess increments attempts on the SAME document before checking
  the cap, so the cap is enforced even across separate requests -- there's no
  way to get more than MAX_ATTEMPTS guesses at one issued code no matter how
  the requests are spaced out.
*/
async function verifyOtp(username, submittedCode) {
  const db = getDb();
  const record = await db.collection('otps').findOne({ username });
  if (!record) return { ok: false, reason: 'no-pending' };

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await db.collection('otps').deleteOne({ username });
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await db.collection('otps').deleteOne({ username });
    return { ok: false, reason: 'too-many-attempts' };
  }

  const submittedHash = hashCode(String(submittedCode || '').trim());
  if (submittedHash !== record.codeHash) {
    await db.collection('otps').updateOne({ username }, { $inc: { attempts: 1 } });
    return { ok: false, reason: 'incorrect' };
  }

  await db.collection('otps').deleteOne({ username });
  return { ok: true };
}

/*
  Same contract as verifyOtp above (ok/reason shape, one-shot, expiry and
  attempt-cap checks first), just matched against linkTokenHash instead of
  codeHash. A wrong/missing token still counts toward the same attempts
  cap as a wrong code -- there is exactly one pending-verification budget
  per issued OTP, not one for the code and a separate one for the link,
  which would otherwise double how many guesses an attacker actually gets.
*/
async function verifyOtpLink(username, submittedToken) {
  const db = getDb();
  const record = await db.collection('otps').findOne({ username });
  if (!record) return { ok: false, reason: 'no-pending' };

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await db.collection('otps').deleteOne({ username });
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await db.collection('otps').deleteOne({ username });
    return { ok: false, reason: 'too-many-attempts' };
  }

  const submittedHash = hashCode(String(submittedToken || '').trim());
  if (!record.linkTokenHash || submittedHash !== record.linkTokenHash) {
    await db.collection('otps').updateOne({ username }, { $inc: { attempts: 1 } });
    return { ok: false, reason: 'incorrect' };
  }

  await db.collection('otps').deleteOne({ username });
  return { ok: true };
}

async function clearOtp(username) {
  const db = getDb();
  await db.collection('otps').deleteOne({ username });
}

module.exports = { issueOtp, verifyOtp, verifyOtpLink, clearOtp, EXPIRY_MS, MAX_ATTEMPTS };
