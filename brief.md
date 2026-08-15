# Reelytic — Project Brief

Written for whoever (human or AI) picks this project up next, so you don't have to re-derive things that already cost real time and, in a few cases, real money to figure out. Read this before touching anything, then `README.md` for the technical reference (tech stack, how to run it, full feature list, directory map). This file does not repeat what's already accurate there.

## What this is

Reelytic turns a spreadsheet of Instagram reel links or creator profiles into a filled-in engagement report (views, likes, comments, shares, saves, engagement rate), exported as a styled Excel/CSV, or a branded PDF for paying tiers. The customer is an Indian influencer-marketing agency reporting these numbers to brands every week, not an individual creator. Solo-founder project, early stage, first real paying agencies about to come on.

## Read this first: the four rules that must never be broken

They're spelled out in full in `README.md`'s "Rules that must never be broken" section. The one-line versions, because breaking any of them silently is the single most likely way to damage this business:

1. Apify (the scraping vendor) must never be visible anywhere a client can see it — UI, exports, error messages, network responses. Server-side code and env vars are fine.
2. No AI-sounding language in any user-facing copy: no em dashes, no ellipsis character, no hedging, nothing that reads like a disclaimer.
3. No internal jargon in user-facing text (the code says "job" everywhere internally — that's fine — but a client-facing string must say "report").
4. Never touch `resolveLikes` in `metrics.service.js` (the hidden-likes estimation) without being explicitly asked.

## Current state (as of this brief)

Recently shipped: branded PDF export (feature-flagged off by default, admin-grantable per client — see README's dedicated PDF section for exactly what's still needed before it can go live for a real customer), three real UI bugs found and fixed (empty landing-page icons from an incomplete emoji-removal pass, a Settings page that read as unstyled on mobile, an inconsistent "coming soon" locked-feature pattern), and a real production-safety fix described below. Nothing is currently mid-flight or half-done in the codebase — what's unfinished is explicitly marked as such (see the PDF section in README).

## The billing idempotency fix — understand this before touching jobEngine.service.js

This is the most subtle piece of logic in the codebase and the easiest to accidentally break.

**The problem it solves:** Render can restart the Node process mid-report (crash, OOM, or just a redeploy — Render sends no `SIGTERM` grace period the app currently handles). `processJobLoop` in `jobEngine.service.js` calls Apify, charges credits, and records a ledger entry for each successful row — but if the process dies between "credit charged" and "the row's completion reaching MongoDB," a resumed job will reprocess that exact row: re-scraping is wasted Apify spend (unavoidable without changing how Apify calls are batched, which is a deliberate margin decision — don't touch it), but re-billing the client for a row they already paid for is a correctness bug, not just waste.

**How it's actually prevented:** `submittedLinks` has a partial unique index on `{jobId, url}` scoped to `result: 'success'` (see `db.js`). `recordLedgerEntry()` (`ledger.service.js`) attempts the insert and returns `{ inserted, duplicate }` — `duplicate: true` means this exact row was already billed, and `jobEngine.service.js` only calls `chargeSuccess()` when `inserted` is true. **This is enforced by the database, not by timing.** If you ever refactor this loop, the invariant to preserve is: a credit charge must never happen except as a direct consequence of `recordLedgerEntry` reporting a fresh insert. Do not charge credits and record the ledger entry as two independent, unlinked calls again.

Row/cursor/counts are now persisted to Mongo once per item, not once per 15-item batch — this shrinks how much work a crash can strand, on top of the billing guarantee above.

`bootstrap.js`'s boot-time full cache wipe was removed (it was fully redundant — `cache.service.js` already TTL-checks on every read, and the specific bug it was originally patching around is now permanently fixed at the source in `metrics.service.js`). Removing it also means a resumed job is more likely to hit a free cache instead of a paid re-scrape. If cached data ever looks stale in a way that seems related to a restart, the TTL setting (`ScanSettings` admin page, profile reports; `config.cacheTtlDays` env var for reels) is where to look — not a missing wipe.

Tests proving all of this: `tests/crash-recovery.test.js`.

## Non-obvious things that will cost you time if you don't know them

- **No hot reload on the API.** After editing anything under `server/`, the running dev process must be restarted. A stale process serving an old route can return `index.html` for what should be a JSON API response — this looks exactly like a broken endpoint and wastes real debugging time before you realize the process is just stale.
- **`getDb()` without a prior `connectDb()` call silently returns the local JSON-file fallback**, never throws. Any standalone script (not the main server, which always calls `connectDb()` at boot) must explicitly `connectDb()` and check `isUsingFallback()` before trusting what it reads or writes — `scripts/canary.js` and `scripts/credit-reconcile.js` show the pattern.
- **`activeJobs` in `jobEngine.service.js` is a plain in-process `Map`, and the whole job-resume design assumes exactly one server instance.** Render's Starter plan runs single-instance with no autoscaling, which is why this is safe today. If this ever moves to multiple instances, `startJob`'s `status === 'running'` guard is not a real distributed lock — two instances could both pick up the same job. Don't add horizontal scaling without adding a real lock first (or a Background Worker with a single designated executor).
- **Feature flags default to OFF and must be added to `FEATURE_KEYS`** (`features.service.js`) to exist at all. Gating is two-layered: `hasFeature()` checks plan defaults + per-account `featureOverrides`; admin always passes. Grant a flag to a specific client via Admin → Clients → Feature access, not by editing plan defaults.
- **Combining multiple test files in one `node --test` invocation runs them in parallel and collides on the shared test database** (duplicate-key errors, login failures from a race with another suite's teardown). Run each suite as its own command, exactly as `scripts/regress.js` does it — never `node --test file1.test.js file2.test.js` together.
- **`npm run regress` spends real money on its last step** (one real reel + one real profile scrape, roughly ₹1, to catch a genuinely broken Apify actor that a stub can never reveal). `npm run regress:free` skips it for a fast pre-commit check.

## Where to look for common tasks

- **A report's actual processing logic:** `server/services/jobEngine.service.js` (`processJobLoop` is the whole engine).
- **Credits/billing:** `server/services/credits.service.js` (balance math) + `server/services/ledger.service.js` (per-item record, now idempotency-gated — see above).
- **Feature gating (client + server):** `server/services/features.service.js`, `client/src/components/Premium.jsx` (`LockedFeatureButton`/`ProBadge`/`PREMIUM_FEATURES` — reuse this pattern for any new gated feature, don't invent a new locked-state UI).
- **Branded report + PDF:** `server/services/branding.service.js`, `server/services/pdfReport.service.js`, `client/src/pages/BrandedReport.jsx`.
- **The public shareable-link view** (`client/src/pages/PublicReport.jsx`) intentionally carries the Reelytic mark and a footer CTA — this is deliberate marketing surface, unlike the branded/PDF views which carry none. Don't "fix" this inconsistency without asking; it's been raised and explicitly kept as-is.
- **Regression tests:** `tests/` — `lifecycle.test.js` (job engine end-to-end via a stubbed scraper), `entitlements.test.js` (plan/feature/ownership matrix), `crash-recovery.test.js` (billing idempotency), `ui/smoke.spec.js` (Playwright console-error gate).
