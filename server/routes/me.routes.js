const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const { getDb } = require('../db');

/*
  Period-scoped counts, not all-time totals -- the Dashboard header carries a
  "Last 14 days" badge next to these numbers, so an all-time total sitting
  under that label was already a quiet mismatch before the comparison
  feature below existed. Both windows use the same `at` timestamp field
  admin.routes.js's own /overview route already scopes activity by.
*/
async function windowCounts(db, username, start, end) {
    const match = { username, at: { $gte: start, $lt: end } };
    const [reelCount, profileCount, successCount, totalCount] = await Promise.all([
        db.collection('submittedLinks').countDocuments({ ...match, type: 'reel' }),
        db.collection('submittedLinks').countDocuments({ ...match, type: 'profile' }),
        db.collection('submittedLinks').countDocuments({ ...match, result: 'success' }),
        db.collection('submittedLinks').countDocuments(match),
    ]);
    const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 100;
    return { reelCount, profileCount, successCount, totalCount, successRate };
}

// Percent change vs the previous period, or null when there's nothing in
// the previous period to compare against -- a "0 -> 5" jump has no
// meaningful percentage (division by zero), and showing one anyway is
// exactly the kind of fabricated-looking number this app has deliberately
// avoided elsewhere (see Dashboard.jsx's own KpiCard comment on this).
function pctChange(current, previous) {
    if (previous === 0) return null;
    return Math.round(((current - previous) / previous) * 1000) / 10;
}

router.get('/stats', requireLogin, async (req, res, next) => {
    try {
        const db = getDb();
        const username = req.currentUser.username;

        const now = new Date();
        const periodStart = new Date(now);
        periodStart.setDate(periodStart.getDate() - 14);
        const previousPeriodStart = new Date(now);
        previousPeriodStart.setDate(previousPeriodStart.getDate() - 28);

        // Every date this endpoint's chart needs, computed up front so the
        // 14-day usageStats lookup below can be ONE query instead of 14.
        const dateStrs = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            dateStrs.push(d.toISOString().split('T')[0]);
        }

        /*
          This used to be windowCounts() x2 (already parallel with each
          other) followed by 14 SEPARATE sequential `await ...findOne()`
          calls in a for-loop, then the recentJobs query after that -- 16
          round trips total, 14 of them one-at-a-time. On Atlas latency from
          Render that alone was measured at 4.5s for this one endpoint,
          which is what made the Dashboard feel slow to load. Everything
          this route needs is independent of everything else it needs, so
          it all goes in one Promise.all: two count-aggregates, one
          $in-batched usageStats query replacing the whole loop, and the
          recent-jobs query, all firing concurrently instead of queued
          behind each other.
        */
        const [current, previous, statsRows, recentJobs] = await Promise.all([
            windowCounts(db, username, periodStart, now),
            windowCounts(db, username, previousPeriodStart, periodStart),
            db.collection('usageStats').find({ username, date: { $in: dateStrs } }).toArray(),
            db.collection('jobs')
                .find({ ownerUsername: username })
                .sort({ createdAt: -1 })
                .limit(6)
                .project({ type: 1, status: 1, counts: 1, createdAt: 1, fileName: 1 })
                .toArray(),
        ]);

        const trends = {
            reelCount: pctChange(current.reelCount, previous.reelCount),
            profileCount: pctChange(current.profileCount, previous.profileCount),
            totalCount: pctChange(current.totalCount, previous.totalCount),
            // windowCounts defaults successRate to 100 when totalCount is 0
            // (nothing submitted isn't "0% success," it's "no rate at all") --
            // so a window with zero links must not feed that placeholder 100
            // into a real-looking percentage comparison here.
            successRate: (current.totalCount > 0 && previous.totalCount > 0)
                ? pctChange(current.successRate, previous.successRate)
                : null,
        };

        const statsByDate = new Map(statsRows.map((s) => [s.date, s]));
        const days14 = dateStrs.map((dateStr) => {
            const stat = statsByDate.get(dateStr);
            return {
                date: dateStr,
                reels: (stat && stat.reelJobs) || 0,
                profiles: (stat && stat.profileJobs) || 0,
                total: (stat && stat.itemsProcessed) || 0,
            };
        });

        res.json({
            ...current,
            trends,
            activity14Days: days14,
            recentJobs: recentJobs.map(j => ({
                id: j._id,
                type: j.type,
                status: j.status,
                counts: j.counts,
                createdAt: j.createdAt,
                fileName: j.fileName || null,
            })),
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
