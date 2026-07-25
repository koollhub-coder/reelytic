const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const requiredEnv = ['MONGODB_URI'];

for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`[Reelytic Config Error] Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  mongodbUri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB_NAME || 'reelytic',
  sessionSecret: process.env.SESSION_SECRET || 'reelytic_default_secret_key_change_me',
  apifyApiKey: process.env.APIFY_API_KEY || '',
  timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  cacheTtlDays: parseInt(process.env.CACHE_TTL_DAYS || '7', 10),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
};
