const { MongoClient } = require('mongodb');
const config = require('./config');
const fs = require('fs');
const path = require('path');

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
    return {
      sort: (sortObj) => {
        let res = [...matched];
        const sortKey = Object.keys(sortObj)[0];
        if (sortKey) {
          const dir = sortObj[sortKey];
          res.sort((a, b) => (a[sortKey] > b[sortKey] ? dir : a[sortKey] < b[sortKey] ? -dir : 0));
        }
        return {
          skip: (n) => {
            res = res.slice(n);
            return {
              limit: (l) => ({
                toArray: async () => JSON.parse(JSON.stringify(res.slice(0, l)))
              }),
              toArray: async () => JSON.parse(JSON.stringify(res))
            };
          },
          limit: (l) => ({
            toArray: async () => JSON.parse(JSON.stringify(res.slice(0, l)))
          }),
          toArray: async () => JSON.parse(JSON.stringify(res))
        };
      },
      toArray: async () => JSON.parse(JSON.stringify(matched))
    };
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

function matchQuery(item, query) {
  for (const key of Object.keys(query)) {
    if (key === '$or') {
      const matchedAny = query.$or.some(subQ => matchQuery(item, subQ));
      if (!matchedAny) return false;
      continue;
    }
    const val = query[key];
    if (val && typeof val === 'object' && val.$gte !== undefined) {
      if (val.$lte !== undefined) {
        if (!(item[key] >= val.$gte && item[key] <= val.$lte)) return false;
      } else {
        if (!(item[key] >= val.$gte)) return false;
      }
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

async function connectDb() {
  if (dbInstance && !isFallback) return dbInstance;
  try {
    const client = new MongoClient(config.mongodbUri, {
      serverSelectionTimeoutMS: 2000,
      tlsAllowInvalidCertificates: true
    });
    await client.connect();
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

module.exports = { connectDb, getDb, ensureIndexes, queryId, isUsingFallback };