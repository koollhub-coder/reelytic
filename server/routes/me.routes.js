const express = require('express');
const router = express.Router();
const { requireLogin } = require('../middleware/auth');
const { getDb } = require('../db');

router.get('/stats', requireLogin, async (req, res, next) => {
    try {
        const db = getDb();
        const username = req.currentUser.username;

        const [reelCount, profileCount, successCount, totalCount] = await Promise.all([
            db.collection('submittedLinks').countDocuments({ username, type: 'reel' }),
            db.collection('submittedLinks').countDocuments({ username, type: 'profile' }),
            db.collection('submittedLinks').countDocuments({ username, result: 'success' }),
            db.collection('submittedLinks').countDocuments({ username }),
        ]);

        const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 100;

        const now = new Date();
        const days14 = [];
        for (let i = 13; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            const stat = await db.collection('usageStats').findOne({ username, date: dateStr });
            days14.push({
                date: dateStr,
                reels: (stat && stat.reelJobs) || 0,
                profiles: (stat && stat.profileJobs) || 0,
                total: (stat && stat.itemsProcessed) || 0,
            });
        }

        const recentJobs = await db.collection('jobs')
            .find({ ownerUsername: username })
            .sort({ createdAt: -1 })
            .limit(6)
            .project({ type: 1, status: 1, counts: 1, createdAt: 1, fileName: 1 })
            .toArray();

        res.json({
            reelCount,
            profileCount,
            successCount,
            totalCount,
            successRate,
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