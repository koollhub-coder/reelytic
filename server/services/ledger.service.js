const { getDb } = require('../db');

async function recordLedgerEntry({ username, type, jobId, url, result }) {
  try {
    const db = getDb();
    await db.collection('submittedLinks').insertOne({
      username,
      type,
      jobId,
      url,
      result, // success | failed | invalid
      at: new Date()
    });

    const todayStr = new Date().toISOString().split('T')[0];
    await db.collection('usageStats').updateOne(
      { username, date: todayStr },
      {
        $inc: {
          [type === 'reel' ? 'reelJobs' : 'profileJobs']: 1,
          itemsProcessed: 1,
          [result === 'success' ? 'success' : 'failed']: 1
        }
      },
      { upsert: true }
    );
  } catch (e) {
    console.warn('[Ledger Service Error]', e.message);
  }
}

module.exports = { recordLedgerEntry };
