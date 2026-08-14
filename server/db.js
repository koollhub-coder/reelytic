const { MongoClient } = require('mongodb');
const dns = require('dns');
const config = require('./config');
const fs = require('fs');
const path = require('path');

// On some machines Node picks up a local loopback DNS proxy (127.0.0.1)
// instead of the OS's real resolver -- often a VPN client, Docker Desktop,
// or antivirus DNS filtering. That breaks the SRV lookup mongodb+srv://
// needs even though the OS's own DNS resolves it fine. If every configured
// server is loopback, fall back to a public resolver so the SRV lookup can
// actually succeed; a real, working resolver (any deployed environment) is
// left untouched.
if (dns.getServers().every((s) => s === '127.0.0.1' || s === '::1')) {
  dns.setServers(['1.1.1.1', '8.8.8.8']);
}

let dbInstance = null;
let isFallback = false;

function queryId(id) {
  return id;
}

class MemoryCollection {
  constructor(name, store) {
    this.name = name;
    this.store = store;
    if (!this.store[name]) this.store[name] = [];
  }

  getData() {
    return this.store[this.name];
  }

  async findOne(query = {}) {
    const items = this.getData();
    const found = items.find(item => matchQuery(item, query));
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  find(query = {}) {
    const items = this.getData();
    const matched = items.filter(item => matchQuery(item, query));
    // Mirrors the real driver's cursor chain closely enough for this app's
    // usage (find/sort/skip/limit/project/toArray, in that order) -- project
    // is attachable at any point since it just narrows what toArray returns.
    const cursor = (list) => ({
      skip: (n) => cursor(list.slice(n)),
      limit: (l) => cursor(list.slice(0, l)),
      sort: (sortObj) => {
        const res = [...list];
        const sortKey = Object.keys(sortObj)[0];
        if (sortKey) {
          const dir = sortObj[sortKey];
          res.sort((a, b) => (a[sortKey] > b[sortKey] ? dir : a[sortKey] < b[sortKey] ? -dir : 0));
        }
        return cursor(res);
      },
      project: (projection) => cursor(list.map(item => applyProjection(item, projection))),
      toArray: async () => JSON.parse(JSON.stringify(list)),
    });
    return cursor(matched);
  }

  async insertOne(doc) {
    const items = this.getData();
    const newDoc = { _id: doc._id || Math.random().toString(36).substring(2, 15), ...doc };
    items.push(newDoc);
    saveMemoryStore(this.store);
    return { insertedId: newDoc._id };
  }

  async updateOne(query, update, options = {}) {
    const items = this.getData();
    let index = items.findIndex(item => matchQuery(item, query));
    if (index === -1 && options.upsert) {
      const newDoc = { _id: Math.random().toString(36).substring(2, 15), ...query };
      items.push(newDoc);
      index = items.length - 1;
    }
    if (index !== -1) {
      const item = items[index];
      if (update.$set) {
        Object.assign(item, update.$set);
      }
      if (update.$inc) {
        for (const k of Object.keys(update.$inc)) {
          item[k] = (item[k] || 0) + update.$inc[k];
        }
      }
      if (update.$push) {
        for (const k of Object.keys(update.$push)) {
          if (!item[k]) item[k] = [];
          item[k].push(update.$push[k]);
        }
      }
      saveMemoryStore(this.store);
      return { modifiedCount: 1 };
    }
    return { modifiedCount: 0 };
  }

  async updateMany(query, update, options = {}) {
    const items = this.getData();
    let count = 0;
    for (const item of items) {
      if (matchQuery(item, query)) {
        if (update.$set) Object.assign(item, update.$set);
        if (update.$inc) {
          for (const k of Object.keys(update.$inc)) {
            item[k] = (item[k] || 0) + update.$inc[k];
          }
        }
        count++;
      }
    }
    if (count > 0) saveMemoryStore(this.store);
    return { modifiedCount: count };
  }

  async deleteOne(query) {
    const items = this.getData();
    const index = items.findIndex(item => matchQuery(item, query));
    if (index !== -1) {
      items.splice(index, 1);
      saveMemoryStore(this.store);
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  async deleteMany(query) {
    const items = this.getData();
    const remaining = items.filter(item => !matchQuery(item, query));
    const deletedCount = items.length - remaining.length;
    if (deletedCount > 0) {
      this.store[this.name] = remaining;
      saveMemoryStore(this.store);
    }
    return { deletedCount };
  }

  async countDocuments(query = {}) {
    const items = this.getData();
    return items.filter(item => matchQuery(item, query)).length;
  }
}

// Supports the inclusion-mode projections this app actually uses (e.g.
// { type: 1, status: 1 }) as well as plain exclusion mode -- mixing both in
// one projection is invalid in real Mongo too, so that case isn't handled.
function applyProjection(item, projection) {
  if (!projection) return item;
  const keys = Object.keys(projection);
  if (keys.length === 0) return item;
  const isInclusion = keys.some((k) => k !== '_id' && projection[k]);
  if (isInclusion) {
    const out = {};
    if (projection._id !== 0) out._id = item._id;
    for (const k of keys) {
      if (k !== '_id' && projection[k]) out[k] = item[k];
    }
    return out;
  }
  const out = { ...item };
  for (const k of keys) {
    if (!projection[k]) delete out[k];
  }
  return out;
}

/*
  Normalises a value for ordered comparison.

  Dates are the reason this exists. The memory store round-trips through
  JSON, so a Date written as an object comes back as an ISO string, and
  comparing that string against a real Date coerces to NaN and silently
  answers "false" to every range query. Reducing both sides to a number
  first keeps a stored ISO string and an in-memory Date comparable.
*/
function comparable(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  return value;
}

/*
  Operator support for the in-memory fallback.

  This deliberately mirrors the subset of MongoDB query operators the app
  actually issues. An unsupported operator here does not throw, it silently
  matches nothing, which is the worst possible failure mode: a feature just
  quietly stops working when the fallback is active. $lt and $ne were added
  because the campaign-comparison query in reportContext.service.js uses
  both, and without them it returned null on every call under the fallback.
*/
function matchOperators(actual, conditions) {
  const a = comparable(actual);
  for (const [op, raw] of Object.entries(conditions)) {
    const b = comparable(raw);
    switch (op) {
      case '$gte': if (!(a >= b)) return false; break;
      case '$gt': if (!(a > b)) return false; break;
      case '$lte': if (!(a <= b)) return false; break;
      case '$lt': if (!(a < b)) return false; break;
      case '$ne': if (actual === raw) return false; break;
      case '$in': if (!Array.isArray(raw) || !raw.includes(actual)) return false; break;
      case '$nin': if (Array.isArray(raw) && raw.includes(actual)) return false; break;
      case '$exists': if ((actual !== undefined) !== !!raw) return false; break;
      default:
        // Unknown operator: refuse to guess. Matching nothing silently is
        // how a query starts lying about the data.
        throw new Error(`[Reelytic DB] Unsupported query operator "${op}" in memory fallback`);
    }
  }
  return true;
}

// A condition object is one whose keys are ALL operators. `{ shareToken: null }`
// and `{ counts: { failed: 0 } }` are plain values to match on, not conditions.
function isConditionObject(val) {
  if (!val || typeof val !== 'object' || Array.isArray(val) || val instanceof Date) return false;
  const keys = Object.keys(val);
  return keys.length > 0 && keys.every((k) => k.startsWith('$'));
}

function matchQuery(item, query) {
  for (const key of Object.keys(query)) {
    if (key === '$or') {
      const matchedAny = query.$or.some(subQ => matchQuery(item, subQ));
      if (!matchedAny) return false;
      continue;
    }
    const val = query[key];
    if (isConditionObject(val)) {
      if (!matchOperators(item[key], val)) return false;
      continue;
    }
    if (item[key] !== val) return false;
  }
  return true;
}

const memoryFilePath = path.join(__dirname, '../data-store.json');
function loadMemoryStore() {
  try {
    if (fs.existsSync(memoryFilePath)) {
      return JSON.parse(fs.readFileSync(memoryFilePath, 'utf8'));
    }
  } catch (e) { }
  return {};
}
function saveMemoryStore(store) {
  try {
    fs.writeFileSync(memoryFilePath, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) { }
}

class MemoryDb {
  constructor(store) {
    this.store = store;
  }
  collection(name) {
    return new MemoryCollection(name, this.store);
  }
}

/*
  Kept so the connection can be closed deliberately. Nothing in production
  calls closeDb -- the process holds one pool for its lifetime -- but a test
  process that cannot close it never exits, because an open Mongo pool keeps
  the event loop alive forever.
*/
let mongoClient = null;

async function connectDb() {
  if (dbInstance && !isFallback) return dbInstance;
  try {
    const client = new MongoClient(config.mongodbUri, {
      serverSelectionTimeoutMS: 2000,
      tlsAllowInvalidCertificates: true
    });
    await client.connect();
    mongoClient = client;
    dbInstance = client.db(config.dbName);
    isFallback = false;
    console.log('[Reelytic DB] Connected to MongoDB Atlas successfully.');
    return dbInstance;
  } catch (err) {
    console.warn('[Reelytic DB Warning] MongoDB connection failed:', err.message);
    console.log('[Reelytic DB] Switching to high-performance local memory/JSON database fallback.');
    isFallback = true;
    const store = loadMemoryStore();
    dbInstance = new MemoryDb(store);
    return dbInstance;
  }
}

function getDb() {
  if (!dbInstance || isFallback) {
    isFallback = true;
    if (!dbInstance || !(dbInstance instanceof MemoryDb)) {
      dbInstance = new MemoryDb(loadMemoryStore());
    }
  }
  return dbInstance;
}

async function ensureIndexes() {
  if (isFallback) return;
  try {
    const db = getDb();
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    await db.collection('settings').createIndex({ key: 1 }, { unique: true });
    await db.collection('jobs').createIndex({ ownerUsername: 1, createdAt: -1 });
    await db.collection('jobs').createIndex({ status: 1 });
    // Share links are looked up by token on every open of a /share/ URL, and
    // that route is the one strangers can reach. Sparse because only a small
    // fraction of jobs are ever shared.
    await db.collection('jobs').createIndex({ shareToken: 1 }, { sparse: true });
    await db.collection('submittedLinks').createIndex({ ownerUsername: 1, at: -1 });
    await db.collection('submittedLinks').createIndex({ url: 1 });
    await db.collection('cache').createIndex({ url: 1 }, { unique: true });
    await db.collection('loginHistory').createIndex({ at: -1 });
    await db.collection('loginHistory').createIndex({ username: 1, at: -1 });
    await db.collection('usageStats').createIndex({ username: 1, date: 1 }, { unique: true });
  } catch (e) {
    console.warn('[DB Indexes]', e.message);
  }
}

function isUsingFallback() {
  return isFallback;
}

// Test-only in practice: releases the pool so a script can exit on its own
// rather than being force-killed.
async function closeDb() {
  if (mongoClient) {
    try { await mongoClient.close(); } catch (e) { /* already closing */ }
    mongoClient = null;
  }
  dbInstance = null;
}

module.exports = { connectDb, getDb, ensureIndexes, queryId, isUsingFallback, closeDb };