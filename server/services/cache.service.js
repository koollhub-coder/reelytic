const { getDb } = require('../db');
const config = require('../config');

async function getCached(url, type) {
  try {
    const db = getDb();
    const cached = await db.collection('cache').findOne({ url, type });
    if (!cached) return null;

    const ttlDays = config.cacheTtlDays || 7;
    const expiry = new Date(cached.fetchedAt).getTime() + ttlDays * 24 * 60 * 60 * 1000;
    if (Date.now() > expiry) {
      return null;
    }
    return cached.data;
  } catch (e) {
    return null;
  }
}

async function setCache(url, type, data) {
  try {
    const db = getDb();
    await db.collection('cache').updateOne(
      { url, type },
      { $set: { data, fetchedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {}
}

module.exports = { getCached, setCache };
