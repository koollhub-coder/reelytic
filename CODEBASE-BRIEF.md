# Reelytic — Codebase Brief

Instagram-analytics SaaS for influencer-marketing agencies. Clients upload a spreadsheet (or paste links) of Instagram reel or profile URLs; the backend scrapes each via third-party actors, computes engagement metrics, and the client downloads/reviews a report. Stack: React 18 + Vite (client/), Node.js + Express + MongoDB (server/), CommonJS on the backend, ESM on the frontend. Single Render Web Service: Express serves the built `client/dist` directly plus an SPA fallback — there is no separate frontend deployment. All facts below are read directly from source; anything not directly confirmed is marked `UNVERIFIED:`.

---

## 1. Persisted Data Model

Database: MongoDB (`server/db.js`). `MONGODB_URI`/`MONGODB_DB_NAME` from env, default db name `reelytic`. If the real connection fails at boot, the app falls back to an in-process, JSON-file-backed mock DB (`server/data-store.json`) implementing a subset of the driver API (find/sort/skip/limit/project, updateOne/updateMany, insertOne, deleteOne/deleteMany, countDocuments) — `isUsingFallback()` also switches the session store to `MemoryStore` when active. Collections:

### `users`
- `_id` (ObjectId), `username` (lowercased, unique index) — **the join key used everywhere else** (jobs/submittedLinks/campaigns/usageStats/loginHistory are keyed by username string, not `_id`)
- `email` (string|null), `name` (string|null), `passwordHash` (string|null — null for Google-only accounts)
- `authProvider` (`'local'`|`'google'`, only set by the signup/google routes — admin-provisioned and bootstrap accounts don't set it)
- `googleId` (Google accounts only), `role` (`'admin'`|`'client'`)
- `mustChangePassword`, `disabled` (bool), `sessionsRevokedAt` (Date|null)
- `createdAt`, `lastLoginAt` (Date|null)
- `plan` (`'free'`|`'unlimited'`|a pricing-plan id after purchase), `credits` (number)
- `hasSeenTour` (bool) — absent on pre-tour-feature accounts; read as `!== false`, so **absent means "already seen"**, not "show the tour"
- `activeJobs` (object, lazily created) — `{ reel: jobId|null, profile: jobId|null }`, the single source of truth for "which report is the user currently viewing" (see §3)

### `jobs` — one per uploaded report
`_id` (string — `new ObjectId().toHexString()`, **stored as a string, not a real ObjectId**), `type` (`'reel'`|`'profile'`), `ownerUsername`, `status` (`'preview'`|`'running'`|`'paused'`|`'done'`), `pausedReason` (`null`|`'user-paused'`|`'error'`|`'server-restart'`), `fileName`, `originalColumns` (`[{name, renamedTo}]`), `rows` (array, shape below), `avgRowMs`, `counts` (`{total, processed, failed, success, skipped, valid, invalid, duplicates, creditsSpent}`), `cursor` (resume index into `rows`), `profilePipelineMode` (`'legacy'`|`'v2'`, undefined on `type:'reel'` jobs and on jobs predating the toggle), `reelPipelineMode` (`'standard'`|`'express'`, same caveat), `creditsPerItem`, `campaignId` (string|null), `dismissed` (bool), `startedAt`/`finishedAt` (Date|null), `createdAt`/`updatedAt`.

**Row shape** (`job.rows[i]`): `i` (1-based), `input: {url, original}` (original = raw parsed spreadsheet row object), `state` (`'pending'`|`'invalid'`|`'duplicate'`|`'done'`|`'failed'`|`'skipped'`), `error` (string|null), `fromCache` (bool), `result` (present only when `state:'done'`), `flag` (`'approved'`|`'flagged'`|null, optional), `note` (string, optional).

**Reel result** (`computeReelMetrics`, sanitized example):
```json
{
  "name": "Example Creator", "username": "example_creator",
  "profileLink": "https://www.instagram.com/example_creator",
  "followers": 128400, "reelLink": "https://www.instagram.com/reel/EXAMPLESHORTCODE",
  "views": 84200, "likes": 3110, "comments": 142, "shares": 58, "reposts": 12, "saves": 201, "er": 3.87
}
```
Every numeric field defaults to 0 if the actor omitted it, except `views` — a missing view count is logged as a data-quality warning rather than silently zeroed. `likes` is **estimated** (not always the real value): if the raw value is missing/hidden/-1/non-numeric, `resolveLikes()` fabricates it as a random 1.5%–2.5% of views (or a flat 5 if views is also 0). This estimation path is shared by both reel and profile metrics.

**Profile result** (`computeProfileMetrics`/`V2`, sanitized example):
```json
{
  "name": "Example Creator", "username": "example_creator",
  "profileLink": "https://www.instagram.com/example_creator", "followers": 128400,
  "avgViews": 23167, "avgEr": 2.14, "reelsAnalyzed": 6, "reelsSkippedAsOutliers": 2,
  "candidates": [ "...see below, optional/undefined on pre-feature records..." ],
  "perReel": [ {"link": "https://www.instagram.com/reel/ABC123", "shortcode": "ABC123", "views": 22000, "likes": 810, "comments": 34, "er": 3.84} ],
  "calcVariant": "standard"
}
```
`calcVariant` is `'standard'` (legacy pipeline) or `'refined'` (V2/Express) — it drives which plain-language explanation the client-facing "How Is This Calculated" page shows.

**Explicit answer — likes/comments survival:** the profile result object has **no top-level `likes`/`comments`/`views`/`er` fields**, only `avgViews`/`avgEr` plus per-reel detail inside `perReel[]`. This matters downstream: `ledger.service.js`'s `recordLedgerEntry()` reads `metrics.likes ?? 0` etc. straight off the top-level result — since a profile result never has those top-level keys, **every `submittedLinks` entry for a profile-type row persists `likes/comments/shares/reposts/saves` as `0`**, even though the real per-reel values exist inside the job document's `perReel[]`.

**`candidates[]` shape** (`buildCandidateStatusList`, every post *fetched* for a profile, not just the ones used):
```json
{"shortCode": "XYZ789", "url": "https://www.instagram.com/reel/XYZ789", "timestamp": "2026-07-30T00:00:00.000Z", "views": 19500, "included": false, "reason": "outlier_high"}
```
`reason` ∈ `included, outlier_high, outlier_low, pinned, not_a_reel, sponsored, collab, missing_views, beyond_top_6` (last one legacy-pipeline only).

**Explicit answer — follower-count nulls:** `followers` is always coerced with `Number(x || 0)` in every computed result — **it is never persisted as `null`**. A failed lookup persists as `0`, indistinguishable in stored data from a genuine 0-follower account.

**Explicit answer — schema drift, old vs. new records:**
- Jobs predating the pipeline toggle: `profilePipelineMode`/`reelPipelineMode` absent → job engine treats absent as `'legacy'`/`'standard'`.
- Users predating the credit system: `credits` absent until `backfillCredits()` (run every boot) stamps defaults on any user missing a numeric `credits` field.
- Users predating the welcome tour: `hasSeenTour` absent → treated as already-seen, no retroactive tour.
- Profile results predating the candidates feature: `candidates` is `undefined`; the export builder falls back to the older `perReel`-only breakdown.
- `submittedLinks` entries predating cost tracking: `estimatedCostUsd` is `null`; every cost-aggregating read falls back to a flat per-type rate (`fallbackCostUsd`).

### `submittedLinks` — one doc per row outcome, every job (the audit ledger)
`username, type, jobId, url, resolvedUsername (string|null), pipelineMode (string|null), estimatedCostUsd (number|null — 0 on cache hits), metrics {views, likes, comments, shares, reposts, saves, er, followers} | null, result ('success'|'failed'|'invalid'), at`.

### `campaigns`
`{_id (string), name, ownerUsername, createdAt}`. Deleting one only clears `jobs.campaignId` back to `null` on member jobs — jobs and rows are untouched.

### `cache`
`{url, type ('reel'|'profile'), data (same shape as row.result), fetchedAt}`. Read/write via `getCached`/`setCache`; TTL is per-type (`getCacheTtlDays`) — profile TTL is admin-configurable, reel TTL is env-only.

### `settings` — single key/value docs, `{key, value}`
Known keys: `sessionSecret`, `devPassword`, `learnedAvgMs` (`{reel, profile}` ms), `profileReportPipeline` (`'legacy'`|`'v2'`), `profileV2FetchDepth`, `profileCacheTtlDays`, `reelReportPipeline` (`'standard'`|`'express'`), `pricingPlans` (optional override array), `costModel` (partial override object).

### `loginHistory`
`{username, ip, userAgent (human string), success, at, via (optional, e.g. 'google')}`.

### `usageStats` — one doc per `(username, date)`, unique index
`{username, date (YYYY-MM-DD), reelJobs, profileJobs, itemsProcessed, success, failed}`, all via `$inc`.

### `pipelineToggleLog` — audit trail
`{setting, from, to, by (admin username), at}`, written on every pipeline-mode/fetch-depth/cache-TTL change.

---

## 2. Metrics & Formulas

- **Engagement rate**: `ER = (likes + comments) / views × 100`, rounded to 2 decimals. For profile reports, `avgEr` instead uses `(avgLikes + avgComments) / followers × 100` — **denominator is followers, not views**, for the aggregate figure only (per-reel `perReel[].er` still uses views).
- **Likes estimation**: see §1 — when an actor doesn't return a usable like count, it's fabricated as ~1.5–2.5% of views (randomized), never surfaced to the client as an estimate.
- **Views**: never coerced to 0 or faked when genuinely missing; a `null` view count is excluded from averages rather than counted as 0. A raw value of `-1` is treated as Instagram's "hidden" sentinel.
- **Profile reel selection — legacy** (`selectProfileReels`): exclude pinned, non-Reel, sponsored (`paidPartnership===true`), and collab (`coauthorProducers` non-empty) posts; sort remaining by timestamp descending (explicit fix — actor return order is not reliably chronological); compute median views; two-sided outlier exclusion at `median × 3` (`OUTLIER_MULTIPLIER`, both directions, toggleable); take the most-recent 6 "normal" reels; if fewer than 6 remain, backfill from excluded outliers closest to the median.
- **Profile reel selection — Express/V2** (`selectProfileReelsV2`): same sponsored/collab/pinned exclusion; sorts by view count in **log space** (view counts are ~log-normal) and trims the top/bottom `PROFILE_V2_TRIM_PCT` (default 15%) instead of hard-excluding past a multiplier; `avgViews` is then also computed as a **log-space mean**, not a linear average. Degrades more gracefully than legacy at small fetch depths.
- **Follower lookup — Express reel mode**: tries a cheaper follower actor first (observed $0 real cost across all test runs, treated as free rather than estimated); any username it can't resolve cleanly falls back to the same reliable actor Standard uses. Express is never less reliable than Standard, only sometimes cheaper.
- **Cost estimation**: Apify bills the whole account, not any one client — every ledger entry's `estimatedCostUsd` is a *computed estimate* using the pipeline mode active at scrape time, not a literal invoice line. Reel-report analytics cost is captured as **real, measured** per-batch spend via the async run API (`fetchFromApifyWithCost` — start run, poll every 2s up to a timeout, wait 6s for cost to settle, then read the dataset); profile-report cost is a flat/measured rate constant, not per-call-measured.

---

## 3. Report Processing Flow

1. **Upload** (`POST /api/upload/:type`): file or pasted links parsed (`parse.service.js`) into normalized rows tagged `pending`/`invalid`/`duplicate`. A job doc is created in `status:'preview'`, with `profilePipelineMode`/`reelPipelineMode` **pinned at creation time** from the current global admin setting — an in-flight job stays internally consistent even if an admin flips the toggle mid-job. The `activeJobs` pointer on the user doc is set to this job for its type.
2. **Preview**: client can rename/remove/reorder columns (`PATCH /jobs/:id/columns`, preview-state only) before starting.
3. **Start** (`POST /jobs/:id/start`): credit pre-flight check (blocks if balance < worst-case cost); jobs over 2000 valid rows require explicit truncation confirmation. Sets `status:'running'`, kicks off `processJobLoop` (async, not awaited by the request).
4. **Processing loop** (`jobEngine.service.js`): walks `rows` in batches — `REEL_BATCH_SIZE` (default 15) for reels, `PROFILE_BATCH_SIZE × PROFILE_CONCURRENCY` (default 5×3=15) for profiles. Per batch: check local cache first (no Apify call on hit); scrape the remainder in ONE batched actor call (amortizes the actor's per-run start fee — deliberate cost optimization); for reels, collect distinct creator usernames in the batch and fetch follower counts in one additional call; compute metrics, write cache, charge credits per success, record a `submittedLinks` ledger entry per row, update `job.rows`/`counts`/`cursor` in the DB, sleep 250ms, repeat. Duplicate rows get a free copy of the result they duplicate — never re-scraped, never re-charged. The loop re-reads job status from the DB each iteration so an external pause takes effect between batches.
5. **Pause/resume/reset/retry-failed**: pause sets an in-process abort flag (`activeJobs` Map, `jobId → {abort}`) plus DB status; resume re-enters the same loop; reset clears results back to `pending` (preserving invalid/duplicate/skipped rows) and re-learns the ETA baseline; retry-failed only re-queues rows in `state:'failed'`, resuming the cursor at the earliest one.
6. **Progress polling**: client polls `GET /jobs/:id/progress?after=N` for a delta of rows with index > N that changed state, plus an ETA computed from `avgRowMs` (an exponentially-weighted average, blended 70/30 old/new per batch, and separately learned globally per report type via `learnedTiming.service.js`).
7. **Completion**: when `cursor >= rows.length`, status flips to `'done'`, `finishedAt` is stamped, and the batch's average timing is folded into the global learned average.
8. **Discard**: explicit "start new report" action — pauses if running, sets `dismissed:true`, and is the ONLY thing that clears the `activeJobs` pointer (so a discarded report never resurfaces on next visit; an older non-dismissed job also never resurfaces, since the pointer — not a "most recent" query — is the single source of truth).
9. **Export**: `GET /export/:jobId(.csv|.xlsx)` streams a generated file server-side (`export.service.js`, using `exceljs`) — reel reports get one sheet; profile reports get a summary sheet plus a "Reel Breakdown" sheet listing every fetched candidate with its inclusion reason. Duplicate rows are excluded from exports entirely; invalid/failed rows are included with zeroed metrics and the raw submitted link.

Both report types (`reel`, `profile`) share this exact same pipeline and job-document schema — only the batch-processing functions and metrics formulas differ.

---

## 4. API Surface

All routes mounted under `/api`. Auth middleware: `requireLogin` (valid session + user not disabled + session not revoked), `requireChangePasswordCheck` (blocks all but a few routes if `mustChangePassword`), `requireAdmin` (`requireLogin` + `role==='admin'` — note: a commented-out `devMode` gate exists in the source but is currently inactive, i.e. any admin account can hit every admin route).

**`/api/auth`** (`auth.routes.js`): `POST /login` (rate-limited 10 attempts/10min per IP+username, in-memory Map — not shared across instances), `POST /logout`, `GET /me`, `POST /tour-seen`, `POST /change-password`, `PATCH /username` (cascades the rename across jobs/submittedLinks/campaigns/usageStats/loginHistory), `POST /dev-unlock` (admin-only, checked inside the handler), `POST /signup` (self-service free tier), `POST /google` (real Google ID-token verification if `GOOGLE_CLIENT_ID` is set; otherwise a labeled dummy-mode fallback that trusts a posted email).

**`/api/upload`**: `POST /:type(reel|profile)` — creates a job in `preview` status.

**`/api/jobs`**: `GET /` (own jobs, or `?user=` for admin; `?creator=` free-text search joined against `submittedLinks.resolvedUsername`), `PATCH /:id/campaign`, `GET /active?type=`, `PATCH /:id/rows/:rowIndex` (flag/note), `GET /:id`, `GET /:id/rows?page&state=`, `PATCH /:id/columns`, `POST /:id/start`, `POST /:id/pause`, `POST /:id/resume`, `POST /:id/reset`, `POST /:id/discard`, `POST /:id/retry-failed`, `GET /:id/progress?after=`.

**`/api/export`**: `GET /:jobId(.csv|.xlsx)` — owner or admin only.

**`/api/settings`**: `GET /` — UNVERIFIED: returns a hardcoded stub (`{theme:'system', timezone:'Asia/Kolkata'}`) not backed by any DB read; appears unused/placeholder.

**`/api/billing`**: `POST /create-order` (dummy Razorpay order — real integration is a documented drop-in replacement, not yet wired), `POST /confirm` (grants the plan's credits; in dummy mode called immediately after a simulated checkout with no payment verification).

**`/api/pricing`**: `GET /plans` (public) — DB override or `DEFAULT_PLANS` (Starter/Pro/Agency, ₹1499/3499/6999 monthly, 2000/5000/10000 credits).

**`/api/me`**: `GET /stats` — dashboard counts, 14-day activity, recent jobs.

**`/api/campaigns`**: `GET /` (list + rollup: total links, success count, total views, views-weighted average ER), `POST /`, `DELETE /:id`.

**`/api/admin`** (all `requireAdmin`): `GET /overview`, `GET /clients`, `POST /clients`, `PATCH /clients/:username` (disable, reset-password, revoke-sessions, credit adjust/set, plan, one-shot tour re-arm), `GET /clients/:username/export.(csv|xlsx)`, `GET /ledger` (paginated, filterable), `GET /sessions` (paginated), `GET|PUT /pricing-plans`, `GET|PATCH /settings/profile-pipeline` + `/log`, `GET|PATCH /settings/reel-pipeline` + `/log`, `GET|PATCH /settings/profile-v2-tuning` (fetch depth + cache TTL), `GET /usage` (real Apify monthly usage, per-actor and per-client cost attribution, USD→INR conversion), `GET /usage/by-user/:username` (drill-down), `GET|PUT /cost-monitor` (margin model against pricing plans).

---

## 5. Frontend Architecture

React 18 + `react-router-dom` v6, `BrowserRouter`. Root providers (outer→inner): `ThemeProvider` → `ToastProvider` → `AuthProvider`. No global state library — auth/theme/toast are the only React Contexts; everything else is local component state plus direct `apiFetch` calls.

**Routing** (`App.jsx`): public routes `/`, `/login`, `/signup`, `/pricing`, `/dev-unlock`; `/change-password` behind `ProtectedRoute`; everything else behind `ProtectedRoute` wrapping a shared `<Shell>` layout with `<Outlet>` — `/reels`, `/profiles`, `/history`, `/settings`, `/how-it-works`, `/dashboard`, `/checkout`, and the `/admin/*` pages (`dashboard`, `clients`, `cost-monitor`, `scan-settings`, `profile-methodology`, `ledger`, `sessions`, `usage`, `pricing`). `ProtectedRoute` redirects to `/login` if logged out, or to `/change-password` if `mustChangePassword`. `PublicRoute` shows an explicit "you're signed in as X — continue or switch accounts" screen instead of silently redirecting a logged-in user away from `/login`/`/signup`.

**`AuthContext`**: holds `user`, checks `/auth/me` on mount, exposes `login/signup/googleLogin/logout/refreshUser`. `logout()` deliberately does a hard `window.location.href` redirect without clearing local state first (avoids a documented login-page flash).

**`api/client.js`** (`apiFetch`): thin `fetch` wrapper prefixing `/api`, auto-sets JSON headers unless the body is `FormData`. On a 401, force-navigates to `/login` UNLESS the current path is in an explicit public-path allowlist (`/`, `/login`, `/signup`, `/pricing`, `/dev-unlock`) — prevents the routine "am I logged in" check from ever bouncing a signed-out visitor off the landing/pricing/signup pages.

**`ReportEngine.jsx`**: the shared engine for both report types — `ReelReport.jsx` and `ProfileReport.jsx` are two-line wrappers rendering `<ReportEngine type="reel"|"profile" />`. Handles upload, preview, live progress polling, results table, best/worst-performer callouts, and export triggers for both types from one component.

**Other pages** (`client/src/pages/`): `Landing`, `Login`, `Signup`, `ForceChangePassword`, `Checkout`, `History` (campaign grouping/comparison, date/creator filters), `Dashboard`, `Pricing`, `HowItsCalculated` (client-facing methodology, includes the worked example), `Settings`. Admin pages (`client/src/pages/admin/`): `AdminDashboard`, `Clients`, `Ledger`, `SessionsLog`, `UsageSpend`, `CostMonitor`, `ScanSettings`, `ProfileMethodology`, `AdminPricingEditor`, `DevUnlock`.

**Shared components** (`client/src/components/`): `Shell` (sidebar nav + mobile drawer, differs by `role`), `WelcomeTour` (6-step modal, shown when `user.hasSeenTour === false`), `Modal`, `ConfirmDialog`, `Select` (custom, replaces native `<select>`), `Shimmer` (loading skeleton — must gate every table render or headers flash before data), `ProgressBar`, `StatCard`, `CopyButton`, `FileDrop`, `PasswordInput`, `GoogleSignInButton`, `AuthLoadingOverlay`, `PipelineModeBanner`, `ProfileMethodologyModal`, `ReelMethodologyModal`, `LedgerHero` (landing-page decorative table, static/simulated data), `Logo`, `NotFound`, `InfoIcon`.

**Styling**: plain inline `style={{}}` objects using CSS custom properties (`var(--s4)`, `var(--fs-sm)`, `var(--accent)`, etc.) defined in `client/src/styles/base.css`/`components.css`/`mobile.css` — no CSS-in-JS library, no Tailwind. Theme toggling sets `data-theme="dark"` on `<html>` (`ThemeContext`), persisted to `localStorage`.

**Export**: generated server-side (`server/services/export.service.js`, `exceljs`) and downloaded via a direct `GET` to `/api/export/:jobId.(csv|xlsx)` — no client-side spreadsheet generation.

---

## 6. Admin Panel Patterns

- **Global, not per-client, pipeline toggles**: profile (`legacy`/`v2`) and reel (`standard`/`express`) report pipelines are each a single DB setting affecting every client's *next* report — deliberately global for one instant total-rollback path, not a gradual/partial rollout. Every toggle change is written to `pipelineToggleLog` with who/when/from/to.
- **Settings collection as generic key/value store**: every tunable (pipeline mode, V2 fetch depth, profile cache TTL, pricing plans, cost model) is one `{key, value}` doc, read fresh on every request — no in-process caching, so a change takes effect on the very next request with no stale window.
- **Vendor/cost anonymization boundary**: admin routes that surface Apify usage data map raw actor ids/names to a fixed internal table (`KNOWN_ACTOR_SLUGS`) before ever building a response — the real actor id is resolved server-side, matched, and discarded; only the neutral `{slug, label}` pair is returned. This boundary exists specifically so client-visible surfaces and even admin-facing "Cost Monitor"/"Usage & Spend" pages never leak which scraping vendor or specific actor powers the product.
- **USD→INR conversion**: fetched from `frankfurter.app`, cached in-process for 1 hour (`_inrRateCache`, a plain module-level variable — not shared across server instances).
- **Per-client cost attribution**: summed from each `submittedLinks` entry's `estimatedCostUsd` (an estimate, not a literal invoice — Apify bills the whole account). The admin Usage page separately reports the gap between this sum and Apify's real reported total as "unattributed" rather than hiding it.
- **Cost Monitor margin model**: a single `DEFAULT_COST_MODEL` object (editable via `PUT /cost-monitor`, merged over the defaults) drives a computed per-plan margin table against whatever pricing plans are currently active — recomputed live, not stored.
- **Client provisioning**: `POST /admin/clients` creates an account with a generated temp password (returned once in the response, never emailed) and `mustChangePassword:true`.
- **One-shot welcome-tour re-arm**: `PATCH /clients/:username {resetTour:true}` sets `hasSeenTour:false` — the client's own next tour completion (`POST /auth/tour-seen`) flips it back to seen automatically; there is no standing "always show" mode.
- **Per-client ledger export**: `GET /admin/clients/:username/export.(csv|xlsx)` — every link that client has ever submitted, sourced from `submittedLinks` directly (no join back to individual job docs needed, since ledger entries already carry a flattened metrics snapshot).

---

## 7. Conventions & Tooling

- **Backend**: CommonJS (`require`/`module.exports`) throughout `server/`. **Frontend**: ESM (`import`/`export`), Vite build (`client/`).
- **Monorepo layout**: single root `package.json` (`postinstall` cds into `client/` and runs `npm install`; `build` cds into `client/` and runs `npm run build`); `client/package.json` is a separate Vite project. `npm run dev` runs both concurrently.
- **Key dependencies (server)**: `express`, `express-session` + `connect-mongo`, `mongodb` (official driver), `bcrypt`, `multer` (file upload), `exceljs` (spreadsheet parse AND export), `google-auth-library`, `dotenv`.
- **Key dependencies (client)**: `react`, `react-dom`, `react-router-dom`, `react-window` (virtualization — UNVERIFIED which specific list it's applied to; not confirmed by direct inspection this pass).
- **No automated test suite found** in either `server/` or `client/src/` (only `node_modules` third-party test files match `*.test.js`/`*.spec.*`) — UNVERIFIED beyond the absence of any project-authored test files; no CI config was inspected.
- **No linter/formatter config** observed at the repo root (no `.eslintrc`/`.prettierrc` found in the paths read this pass) — UNVERIFIED as a completeness claim, not exhaustively searched.
- **Deployment**: single Render Web Service, `Dockerfile`-based (Render prefers a root `Dockerfile` over its native Node buildpack when one exists). Render only forwards a dashboard-configured environment variable into the Docker *build* step for names explicitly declared via `ARG` in the Dockerfile — currently only `VITE_GOOGLE_CLIENT_ID` is so declared. All server-side env vars (Mongo URI, session secret, Apify key, etc.) are runtime-only and don't need `ARG` declarations. Same MongoDB Atlas cluster is used for local dev and production (`MONGODB_URI` is a single shared connection string in `.env`).
- **Security headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin` set globally in `server/index.js`. Session cookie: `httpOnly:true`, `secure:false` (UNVERIFIED whether this is overridden anywhere for production HTTPS — not observed in the files read), 7-day `maxAge`.

---

## 8. Known Gaps & Landmines

These are real, currently-live behaviors documented directly in source comments or confirmed by reading the code — not speculation.

- **Profile-type ledger metrics are always zero for likes/comments/shares/reposts/saves** (see §1) — a `submittedLinks` entry for a profile row can never be used to reconstruct real per-item engagement numbers; only the parent job document's `perReel[]` has that detail, and it isn't joined into the ledger.
- **In-memory login rate limiter** (`auth.routes.js`, `loginAttempts` Map) and **in-memory active-job control map** (`jobEngine.service.js`, `activeJobs` Map) are both plain process-local `Map`s — neither survives a server restart, and neither is shared across horizontally-scaled instances if the app is ever run with more than one Node process.
- **Session store falls back to `MemoryStore`** whenever the app itself fell back to the JSON mock DB (`isUsingFallback()`) — sessions in that mode are also not shared across instances and are lost on restart.
- **Reel batching latency is deliberate, not a bug**: `REEL_BATCH_SIZE=15` amortizes an actor's per-run start fee; a client can legitimately see 0 processed for 1–3+ minutes on a running report before an entire batch completes and jumps the progress bar all at once. A delayed (15s+) reassurance message exists in `ReportEngine.jsx` for this — UNVERIFIED whether that specific UI change is committed/deployed as of this writing (it was implemented and locally build-verified but its push status was not re-confirmed in this pass).
- **Follower-actor input field name for the Express fast path was not confirmed against the provider's own schema** — it's a best-effort guess based on the actor's marketing copy; if wrong, the provider rejects the run immediately with a schema error, which is treated as a fallback trigger rather than a hard failure.
- **Legacy (Standard) profile pipeline has an unresolved TODO**: the post-scraper actor reportedly needs an explicit "detailed data" input flag for view counts to come through at all; the exact field name for that flag is not confirmed in the current call — a comment in `apify.service.js` flags this as unverified and warns profile reports could come back with `views:0` until it's checked directly against the actor's input schema.
- **`cache` collection has no compound unique index** on `(url, type)` beyond application-level `upsert` logic in `getCached`/`setCache` — `db.js`'s `ensureIndexes()` only indexes `url` alone.
- **`jobs._id` is a string, not a Mongo ObjectId** — any external tooling querying this collection directly needs to match on the string form, not construct an `ObjectId`.
- **Username changes cascade across five collections** (`jobs`, `submittedLinks`, `campaigns`, `usageStats`, `loginHistory`) via sequential `updateMany` calls in `PATCH /auth/username` — not a transaction; a mid-cascade failure would leave some collections renamed and others not. A code comment explicitly documents this as the fix for a real prior incident where a username change silently orphaned a user's own report history.
- **`requireAdmin`'s dev-mode gate is dead code**: a stricter version of `requireAdmin` that also required a `devMode` session flag exists in `middleware/auth.js` but is fully commented out; the active implementation only checks `role==='admin'`.
- **Client-facing content boundary is a convention enforced by manual review, not code**: nothing programmatically prevents a future admin-panel change from leaking vendor/actor names or cost figures into a client-visible response — the `KNOWN_ACTOR_SLUGS` anonymization (§6) only covers the specific admin routes that currently implement it.
- **No automated tests** (see §7) — correctness of the metrics/outlier-selection algorithms depends entirely on manual/one-off verification scripts referenced in commit history, not a regression suite.
