/*
  Account identity: usernames, and keeping throwaway signups out.

  USERNAME IS THE SINGLE SOURCE OF TRUTH for who someone is on screen. There
  used to be a separate `name` (taken from the Google profile) that the UI
  preferred, so an account created with Google showed "Shubham Rai" forever
  even after the user changed their username, and nothing they could edit had
  any effect on what they saw. The username is now the one identity: derived
  from the Google name on first sign-in, asked for directly on manual signup,
  editable afterwards, and displayed everywhere.
*/

/*
  Disposable / throwaway email domains.

  Free credits on signup make this a real cost: one person with a temp-mail
  tab can mint accounts indefinitely and every one of them spends our Apify
  budget. This is the well-known core of the disposable providers plus their
  common aliases; it is deliberately a denylist of domains rather than a
  pattern guess, so a legitimate small provider is never caught by accident.

  Extend by adding to this set. If this ever needs to be exhaustive, the
  standard move is to sync a maintained list (e.g. the disposable-email-
  domains project) into a collection at boot and check that instead.
*/
const DISPOSABLE_DOMAINS = new Set([
  '0-mail.com', '10minutemail.com', '10minutemail.net', '20minutemail.com', '33mail.com',
  'anonbox.net', 'anonymbox.com', 'armyspy.com', 'bccto.me', 'binkmail.com',
  'bobmail.info', 'bugmenot.com', 'burnermail.io', 'byom.de', 'cuvox.de',
  'dayrep.com', 'deadaddress.com', 'despam.it', 'discard.email', 'discardmail.com',
  'disposable.com', 'disposableemailaddresses.com', 'disposeamail.com', 'dispostable.com',
  'dodgeit.com', 'dodgit.com', 'dontreg.com', 'dropmail.me', 'e4ward.com',
  'einrot.com', 'emailondeck.com', 'emailsensei.com', 'emailtemporanea.net', 'emailwarden.com',
  'emkei.cz', 'fakeinbox.com', 'fakemail.net', 'fakemailgenerator.com', 'fastmail.fm.disposable',
  'filzmail.com', 'fleckens.hu', 'flurred.com', 'fudgerub.com', 'getairmail.com',
  'getnada.com', 'grr.la', 'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de',
  'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com',
  'harakirimail.com', 'hidemail.de', 'hmamail.com', 'inboxalias.com', 'inboxbear.com',
  'incognitomail.com', 'jetable.org', 'jourrapide.com', 'kasmail.com', 'killmail.com',
  'klzlk.com', 'koszmail.pl', 'kurzepost.de', 'lackmail.net', 'letthemeatspam.com',
  'linshiyouxiang.net', 'lroid.com', 'luxusmail.org', 'mail-temporaire.fr', 'mail.tm',
  'mail7.io', 'mailbox52.ga', 'mailcatch.com', 'maildrop.cc', 'maildrop.co',
  'mailduck.io', 'maileater.com', 'mailexpire.com', 'mailforspam.com', 'mailfreeonline.com',
  'mailinater.com', 'mailinator.com', 'mailinator.net', 'mailinator.org', 'mailmetrash.com',
  'mailnesia.com', 'mailnull.com', 'mailsac.com', 'mailtemp.info', 'mailtothis.com',
  'mailzilla.com', 'meltmail.com', 'mintemail.com', 'moakt.com', 'mohmal.com',
  'msgsafe.io', 'mt2015.com', 'mytemp.email', 'mytrashmail.com', 'nada.email',
  'nomail.xl.cx', 'nowmymail.com', 'nwytg.net', 'objectmail.com', 'onetimemail.org',
  'owlymail.com', 'pokemail.net', 'proxymail.eu', 'punkass.com', 'qq.eu.org',
  'rcpt.at', 'rhyta.com', 'rmqkr.net', 'safetymail.info', 'sharklasers.com',
  'shitmail.me', 'sogetthis.com', 'spam4.me', 'spamavert.com', 'spambog.com',
  'spambox.us', 'spamdecoy.net', 'spamfree24.org', 'spamgourmet.com', 'spamherelots.com',
  'spamhole.com', 'spaml.de', 'spamspot.com', 'superrito.com', 'tempail.com',
  'tempemail.net', 'tempinbox.com', 'tempm.com', 'tempmail.altmails.com', 'tempmail.de',
  'tempmail.plus', 'tempmailer.com', 'tempmailo.com', 'tempomail.fr', 'temp-mail.io',
  'temp-mail.org', 'temp-mail.ru', 'tempr.email', 'teleworm.us', 'throwam.com',
  'throwawaymail.com', 'tmail.ws', 'tmailinator.com', 'trash-mail.com', 'trash-mail.de',
  'trashmail.com', 'trashmail.de', 'trashmail.me', 'trashmail.net', 'trashmail.org',
  'trbvm.com', 'tvchd.com', 'vomoto.com', 'vpn.st', 'vsimcard.com',
  'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org', 'wh4f.org', 'willhackforfood.biz',
  'wuzup.net', 'yepmail.net', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'yourdomain.com', 'zetmail.com', 'zoemail.com',
]);

function emailDomain(email) {
  const at = String(email || '').lastIndexOf('@');
  return at === -1 ? '' : String(email).slice(at + 1).trim().toLowerCase();
}

/*
  True when this address belongs to a known throwaway provider.

  Also catches sub-addressing on those hosts (foo@mail.guerrillamail.com), so
  a subdomain is not a trivial way around the list.
*/
function isDisposableEmail(email) {
  const domain = emailDomain(email);
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i += 1) {
    if (DISPOSABLE_DOMAINS.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

// Lowercase, no spaces, safe characters only. Used both for names arriving
// from Google and for anything typed at signup, so the two routes cannot
// produce differently-shaped usernames.
function slugifyUsername(input) {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 32);
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

function validateUsername(candidate) {
  const slug = slugifyUsername(candidate);
  if (slug.length < 3) return { ok: false, error: 'Username must be at least 3 characters (letters, numbers, dots, dashes).' };
  if (!USERNAME_RE.test(slug)) return { ok: false, error: 'Use only letters, numbers, dots, dashes and underscores.' };
  return { ok: true, username: slug };
}

/*
  Finds a free username near `base`, appending a number when taken. Used when
  deriving one from a Google display name, where the user is not being asked
  and a collision must resolve silently rather than fail the sign-in.
*/
async function uniqueUsername(db, base, fallback = 'user') {
  let root = slugifyUsername(base) || slugifyUsername(fallback) || 'user';
  if (root.length < 3) root = `${root}user`.slice(0, 32);
  const taken = async (u) => !!(await db.collection('users').findOne({ $or: [{ username: u }, { email: u }] }, { projection: { _id: 1 } }));
  if (!(await taken(root))) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root.slice(0, 28)}${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  return `${root.slice(0, 24)}${Date.now().toString(36)}`;
}

module.exports = {
  isDisposableEmail,
  slugifyUsername,
  validateUsername,
  uniqueUsername,
  DISPOSABLE_DOMAINS,
};
