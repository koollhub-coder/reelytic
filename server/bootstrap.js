const { getDb } = require('./db');
const { hashPassword, generateTempPassword } = require('./utils/password');
const { defaultsForNewUser, backfillCredits } = require('./services/credits.service');
const config = require('./config');

async function runBootstrap() {
  const db = getDb();
  const settingsColl = db.collection('settings');
  const usersColl = db.collection('users');
  const jobsColl = db.collection('jobs');
  const cacheColl = db.collection('cache');

  // Clear cache on boot to flush any stale "Creator Name" items
  try {
    await cacheColl.deleteMany({});
  } catch (e) { }

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
