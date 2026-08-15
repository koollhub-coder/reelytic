const { getDb } = require('./db');
const { hashPassword, generateTempPassword } = require('./utils/password');
const { defaultsForNewUser, backfillCredits } = require('./services/credits.service');
const config = require('./config');

async function runBootstrap() {
  const db = getDb();
  const settingsColl = db.collection('settings');
  const usersColl = db.collection('users');
  const jobsColl = db.collection('jobs');

  /*
    A full cache wipe used to run here on every boot ("flush any stale
    'Creator Name' items") -- a one-time fix for corrupt entries applied as
    a permanent boot step instead of a one-off migration. Removed: it isn't
    needed for staleness (getCachedEntry in cache.service.js already
    enforces its own TTL on every read, independent of process uptime), and
    the "Creator Name" placeholder bug itself is permanently guarded at the
    point of computation now (see metrics.service.js's rawName check), so
    that bad data can no longer even enter the cache. Left in, this wiped
    every valid entry on every deploy too -- including ones a crash-recovery
    resume (see jobEngine.service.js processJobLoop) now depends on to
    avoid re-paying Apify for a scrape it already paid for once.
  */

  // 1. Session secret check
  let secretSetting = await settingsColl.findOne({ key: 'sessionSecret' });
  if (!secretSetting) {
    await settingsColl.insertOne({ key: 'sessionSecret', value: config.sessionSecret });
  }

  // 2. Dev password check (default: Devcanonlyaccess)
  let devPwdSetting = await settingsColl.findOne({ key: 'devPassword' });
  if (!devPwdSetting) {
    const hashedDev = await hashPassword('Devcanonlyaccess');
    await settingsColl.insertOne({ key: 'devPassword', value: hashedDev });
  }

  // 3. Admin user creation if users collection empty
  const userCount = await usersColl.countDocuments({});
  if (userCount === 0) {
    const adminUser = config.adminUsername || 'admin';
    const adminPass = config.adminPassword || generateTempPassword();
    const hashedPass = await hashPassword(adminPass);

    await usersColl.insertOne({
      username: adminUser.toLowerCase(),
      passwordHash: hashedPass,
      role: 'admin',
      mustChangePassword: true,
      disabled: false,
      sessionsRevokedAt: null,
      createdAt: new Date(),
      lastLoginAt: null,
      ...defaultsForNewUser('admin')
    });

    console.log('\n================================================================');
    console.log(`===== INITIAL ADMIN LOGIN: ${adminUser} / ${adminPass}, change this now =====`);
    console.log('================================================================\n');
  }

  // 4. Job recovery: any job running -> paused with server-restart
  await jobsColl.updateMany(
    { status: 'running' },
    { $set: { status: 'paused', pausedReason: 'server-restart' } }
  );

  // 5. Credit backfill: any user created before the credit system gets defaults.
  await backfillCredits();

  console.log('[Reelytic Bootstrap] System initialized successfully.');
}

module.exports = { runBootstrap };
