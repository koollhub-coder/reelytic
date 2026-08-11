/*
  One date format across the whole product: 1-jul-26.

  Everything used to call toLocaleDateString/toLocaleString directly, which
  meant the format changed with the viewer's machine locale: an admin in
  India saw 10/8/2026 and read it as 10 August while the server meant
  8 October. A named month removes the ambiguity entirely, and fixing the
  format here rather than per-call is what keeps it consistent as pages
  get added.

  Deliberately not locale-aware. This is a fixed house format, the same way
  the currency display is.
*/

// Capitalised: "10-Jul-26" reads as a date at a glance, "10-jul-26" reads
// as a code. Same reason the rest of the product capitalises proper nouns.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 1-jul-26
export function formatDate(value, fallback = '-') {
  const d = toDate(value);
  if (!d) return fallback;
  return `${d.getDate()}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
}

// 1-jul-26, 8:40 pm
export function formatDateTime(value, fallback = '-') {
  const d = toDate(value);
  if (!d) return fallback;
  const suffix = d.getHours() >= 12 ? 'PM' : 'AM';
  const hours = d.getHours() % 12 || 12;
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(d)}, ${hours}:${mins} ${suffix}`;
}

// 1-jul-26 to 31-jul-26
export function formatDateRange(from, to, fallback = '-') {
  const a = formatDate(from, '');
  const b = formatDate(to, '');
  if (!a && !b) return fallback;
  if (!b) return a;
  if (!a) return b;
  return `${a} to ${b}`;
}

/*
  How long ago, in the roughest unit that is still honest: "3 days old" is
  what an admin needs to judge a reused figure, "72.4 hours" is not. Rounds
  down deliberately, so a cached item never reads younger than it is.
*/
export function formatAge(value, fallback = '') {
  const d = toDate(value);
  if (!d) return fallback;
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min old`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} old`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} old`;
}

// "1-Jul-26" for a plain YYYY-MM-DD day key, without letting the string be
// parsed as UTC midnight and drifting a day backwards in negative offsets.
export function formatDayKey(key, fallback = '-') {
  if (typeof key !== 'string') return formatDate(key, fallback);
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return formatDate(key, fallback);
  return formatDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), fallback);
}
