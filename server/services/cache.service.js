const { getDb } = require('../db');
const config = require('../config');

const PROFILE_CACHE_TTL_KEY = 'profileCacheTtlDays';
const DEFAULT_PROFILE_CACHE_TTL_DAYS = 7;

// Profile-report cache TTL is admin-configurable (see ScanSettings) since how
// often it's worth reusing a scrape depends on real repeat-report behavior,
// which changes as the client base grows -- not something to hardcode once.
// Reel-report caching is unaffected, still config.cacheTtlDays (env-only).
async function getCacheTtlDays(type) {
  if (type !== 'profile') return config.cacheTtlDays || 7;
  try {
    const db = getDb();
    const doc = await db.collection('settings').findOne({ key: PROFILE_CACHE_TTL_KEY });
    const value = doc && Number(doc.value);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_PROFILE_CACHE_TTL_DAYS;
  } catch (e) {
    return DEFAULT_PROFILE_CACHE_TTL_DAYS;
  }
}

async function setProfileCacheTtlDays(days) {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) throw new Error('TTL must be a positive number of days');
  const db = getDb();
  await db.collection('settings').updateOne(
    { key: PROFILE_CACHE_TTL_KEY },
    { $set: { key: PROFILE_CACHE_TTL_KEY, value } },
    { upsert: true }
  );
  return value;
}

/*
  Returns { data, fetchedAt } rather than just the payload, so a caller can
  record HOW OLD a reused figure was. "This cost nothing" and "this cost
  nothing because we are showing you a six-day-old number" are different
  statements, and the admin needs the second one to judge whether the
  cache TTL is set sensibly.
*/
async function getCachedEntry(url, type) {
  try {
    const db = getDb();
    const cached = await db.collection('cache').findOne({ url, type });
    if (!cached) return null;

    const ttlDays = await getCacheTtlDays(type);
    const fetchedAt = new Date(cached.fetchedAt);
    const expiry = fetchedAt.getTime() + ttlDays * 24 * 60 * 60 * 1000;
    if (Date.now() > expiry) {
      return null;
    }
    /*
      An entry with no payload is a miss, not a hit.

      Callers test the returned object for truthiness. getCached() used to
      return `cached.data` directly, so an empty payload was falsy and fell
      through to a real scrape. Wrapping it in an object would make that same
      empty entry truthy and short-circuit the scrape, producing a finished
      row with no metrics in it. Checked here so both callers inherit it.
    */
    if (cached.data == null) return null;
    return { data: cached.data, fetchedAt };
  } catch (e) {
    // Previously swallowed silently -- a broken cache lookup looked
    // identical to "nothing cached yet", which is exactly how this went
    // unnoticed. Surfaced now so a real failure shows up in server logs.
    console.warn('[Cache Service] getCached failed:', e.message);
    return null;
  }
}

// Payload-only form, kept so existing callers are unaffected.
async function getCached(url, type) {
  const entry = await getCachedEntry(url, type);
  return entry ? entry.data : null;
}

async function setCache(url, type, data) {
  try {
    const db = getDb();
    await db.collection('cache').updateOne(
      { url, type },
      { $set: { data, fetchedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    console.warn('[Cache Service] setCache failed:', e.message);
  }
}

module.exports = { getCached, getCachedEntry, setCache, getCacheTtlDays, setProfileCacheTtlDays, DEFAULT_PROFILE_CACHE_TTL_DAYS };
