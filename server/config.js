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
  // Health page: how many days of silence before an open error auto-resolves
  // itself (see errorTracking.service.js's autoResolveStale). Same idea as
  // cacheTtlDays above -- a stale-after window, not a one-time wipe.
  healthAutoResolveDays: parseInt(process.env.HEALTH_AUTO_RESOLVE_DAYS || '7', 10),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  // The one place the app's public URL is read from -- password-reset
  // emails, robots.txt/sitemap.xml, and alerting.service.js's own Slack
  // links all resolve from this same env var, so switching domains (e.g.
  // onto tryreelytic.com once it's bought) is a one-line .env change, not a
  // find-and-replace. Trailing slash stripped so nothing downstream has to
  // guard against a double slash before the path it appends.
  appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, ''),
};
