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
const publicRoutes = require('./routes/public.routes');

async function startServer() {
  const db = await connectDb();
  await ensureIndexes();
  await runBootstrap();

  const app = express();

  // Render (and any other managed host) puts a proxy in front of us, so
  // without this every request reports the proxy's address as req.ip and the
  // whole internet shares one rate-limit bucket. '1' means trust exactly one
  // hop, which is what Render provides; trusting the full chain would let a
  // caller forge X-Forwarded-For and dodge the limit entirely.
  app.set('trust proxy', 1);

  // Security Headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // verify captures the raw request bytes into req.rawBody alongside the
  // normal parsed req.body -- Razorpay's webhook signature is computed over
  // the exact raw payload, and by the time a route handler runs those bytes
  // are otherwise gone (express.json() only keeps the parsed object). Every
  // other route is unaffected: req.body still parses exactly as before.
  app.use(express.json({ limit: '2mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
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
  // Client-side error beacons. Intentionally not behind requireLogin --
  // see the note in errors.routes.js.
  app.use('/api/errors', require('./routes/errors.routes'));
  app.use('/api/benchmarks', require('./routes/benchmarks.routes'));
  app.use('/api/public', publicRoutes);
  // Public, unauthenticated -- Terms/Privacy content, read by the Legal page
  // and by Signup's agreement checkbox before a session exists.
  app.use('/api/legal', require('./routes/legal.routes'));
  // Public, unauthenticated -- the Landing page footer's newsletter signup.
  app.use('/api/newsletter', require('./routes/newsletter.routes'));

  /*
    The pre-deploy checks, runnable from the Health page. This router starts
    processes, so on a production server it is never mounted at all and its
    paths 404 like any other unknown route. It refuses non-loopback requests
    and re-checks the environment per request as well, but not mounting it
    is the fence that matters.
  */
  const devtools = require('./routes/devtools.routes');
  if (devtools.isAvailable()) {
    app.use('/api/devtools', devtools);
    console.log('[Reelytic] Developer checks enabled at /api/devtools (local only, never in production).');
  }

  // robots.txt / sitemap.xml, built from config.appUrl at request time --
  // see seo.routes.js. Mounted before the static client build below so a
  // request for either path is never shadowed.
  app.use(require('./routes/seo.routes'));

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
