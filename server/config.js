const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const requiredEnv = ['MONGODB_URI'];

for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`[Reelytic Config Error] Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

/*
  The session secret signs every login cookie. The fallback below, and the
  sample value in .env.example, are public in this repo, so a production
  server running on either would accept cookies anyone can forge. Refuse to
  start instead.
*/
const DEFAULT_SESSION_SECRET = 'reelytic_default_secret_key_change_me';
const KNOWN_PUBLIC_SECRETS = new Set([DEFAULT_SESSION_SECRET, 'reelytic_super_secret_key_12345']);

if (process.env.NODE_ENV === 'production') {
  const secret = process.env.SESSION_SECRET || '';
  if (!secret || KNOWN_PUBLIC_SECRETS.has(secret)) {
    console.error('[Reelytic Config Error] SESSION_SECRET must be set to a long random value in production (it is missing or a known default).');
    process.exit(1);
  }
}

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  mongodbUri: process.env.MONGODB_URI,
  dbName: process.env.MONGODB_DB_NAME || 'reelytic',
  sessionSecret: process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET,
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
