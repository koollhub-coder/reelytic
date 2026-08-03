const { getDb } = require('../db');

/*
  Tracks "which job is the user currently viewing" per report type, as an
  explicit pointer on the user doc -- NOT a "most recent non-dismissed job"
  query. A heuristic like that lets an older job resurface the moment the
  current one is discarded, which is exactly the stale-report bug this
  replaces. The pointer is the single source of truth: set on upload, cleared
  on discard, otherwise untouched (pause/resume/reset keep the same job).

  Stored as one object (not dot-notation field updates) because the JSON
  fallback DB's $set does a shallow Object.assign and does not understand
  Mongo dot-path updates.
*/
async function setActiveJobPointer(username, type, jobId) {
  const db = getDb();
  const user = await db.collection('users').findOne({ username });
  const activeJobs = { ...(user && user.activeJobs), [type]: jobId };
  await db.collection('users').updateOne({ username }, { $set: { activeJobs } });
}

async function getActiveJobPointer(username, type) {
  const db = getDb();
  const user = await db.collection('users').findOne({ username });
  return (user && user.activeJobs && user.activeJobs[type]) || null;
}

async function clearActiveJobPointer(username, type) {
  await setActiveJobPointer(username, type, null);
}

module.exports = { setActiveJobPointer, getActiveJobPointer, clearActiveJobPointer };
