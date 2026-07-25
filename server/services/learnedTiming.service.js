const { getDb } = require('../db');

// Sensible starting guesses until enough real jobs have completed to learn
// from. These only matter for the very first few jobs ever run.
const DEFAULT_AVG_MS = { reel: 2500, profile: 6000 };

async function getLearnedAvgMs(type) {
    try {
        const db = getDb();
        const doc = await db.collection('settings').findOne({ key: 'learnedAvgMs' });
        const value = (doc && doc.value) || {};
        return value[type] || DEFAULT_AVG_MS[type] || 2500;
    } catch (e) {
        return DEFAULT_AVG_MS[type] || 2500;
    }
}

// Blends a just-finished job's own average row time into the global learned
// average (weighted moving average, so one unusually slow/fast job doesn't
// swing the estimate wildly -- it nudges it, and improves steadily over many
// jobs). Call this once, when a job finishes.
async function recordJobTiming(type, finalAvgRowMs) {
    if (!finalAvgRowMs || finalAvgRowMs <= 0) return;
    try {
        const db = getDb();
        const doc = await db.collection('settings').findOne({ key: 'learnedAvgMs' });
        const current = (doc && doc.value) || { ...DEFAULT_AVG_MS };
        const prevForType = current[type] || DEFAULT_AVG_MS[type] || finalAvgRowMs;

        // 85% weight on history, 15% on this job -- learns steadily without
        // being thrown off by one weirdly slow or fast report.
        const updated = Math.round(prevForType * 0.85 + finalAvgRowMs * 0.15);

        await db.collection('settings').updateOne(
            { key: 'learnedAvgMs' },
            { $set: { key: 'learnedAvgMs', value: { ...current, [type]: updated } } },
            { upsert: true }
        );
    } catch (e) {
        console.warn('[LearnedTiming] failed to record job timing:', e.message);
    }
}

module.exports = { getLearnedAvgMs, recordJobTiming, DEFAULT_AVG_MS };