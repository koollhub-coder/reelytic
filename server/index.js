const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const config = require('./config');
// const { connectDb, ensureIndexes } = require('./db');
const { connectDb, ensureIndexes, isUsingFallback } = require('./db');
const { runBootstrap } = require('./bootstrap');
const { errorHandler } = require('./middleware/errors');

const authRoutes = require('./routes/auth.routes');
const uploadRoutes = require('./routes/upload.routes');
const jobsRoutes = require('./routes/jobs.routes');
const exportRoutes = require('./routes/export.routes');
const settingsRoutes = require('./routes/settings.routes');
const adminRoutes = require('./routes/admin.routes');

async function startServer() {
  const db = await connectDb();
  await ensureIndexes();
  await runBootstrap();

  const app = express();

  // Security Headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Session configuration with bulletproof store fallback
  // Session store mirrors whatever connectDb() actually landed on:
  // no point pointing sessions at Mongo if the app DB already gave up on it.
  const sessionStore = isUsingFallback()
    ? new session.MemoryStore()
    : MongoStore.create({ mongoUrl: config.mongodbUri, dbName: config.dbName, touchAfter: 24 * 3600 });
  app.use(session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000
    }
  }));

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/jobs', jobsRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/billing', require('./routes/billing.routes'));
  app.use('/api/pricing', require('./routes/pricing.routes'));
  app.use('/api/me', require('./routes/me.routes'));
  app.use('/api/campaigns', require('./routes/campaigns.routes'));

  // Static client build in production
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));

  // SPA Fallback
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'), (err) => {
      if (err) {
        res.status(404).send('Reelytic Frontend build not found. Run npm run build.');
      }
    });
  });

  app.use(errorHandler);

  const port = config.port;
  app.listen(port, () => {
    console.log(`[Reelytic Server] Running on http://localhost:${port}`);
  });
}

startServer().catch(err => {
  console.error('[Reelytic Startup Error]', err);
  process.exit(1);
});
