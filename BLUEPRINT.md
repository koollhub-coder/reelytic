# Reelytic — FINAL Master Blueprint (v2, Execution Plan for Sonnet)

> **How to use:** Every product, design, and architecture decision is made here. Feed Sonnet **one phase at a time** (Section 14) with this file attached (keep it in the repo as `BLUEPRINT.md`). Sonnet must never invent structure, copy, colors, schema, or endpoints. If the blueprint covers it, that's the answer. If it truly doesn't, choose the option that is simplest for the end user, not the developer.
>
> **Product mindset (read first):** Reelytic is a client-facing SaaS for influencer-marketing agencies. Users are marketers, not engineers. Every screen must answer "what do I do next?" in under 2 seconds. Every wait must show progress. Every error must say what happened and how to fix it, in plain English. Every destructive action must be confirmable. The app is judged on feel: if a detail feels cheap, it's a bug.

---

## 1. Locked Tech Decisions

| Area | Decision | Why |
|---|---|---|
| Backend | Node 20 + Express 4 | Simple, cheap hosting |
| DB | MongoDB Atlas, native `mongodb` driver v6, **no Mongoose** | Per spec |
| Frontend | React 18 + Vite, plain CSS with design tokens (no Tailwind/MUI) | Full control, no template look |
| Routing | `react-router-dom` v6 | Standard |
| State | React contexts (Auth, Theme, Toast). No Redux. | Small app |
| Big lists | `react-window` (**the only UI library allowed**) for run-state tables at 1–2K rows | Hand-rolled virtualization is a bug factory |
| Spreadsheets | `exceljs` server-side parse + export; CSV/TXT manual | One lib, styling support |
| Uploads | `multer` memory storage, **15 MB** limit | 2K-row xlsx files fit comfortably |
| Auth | `express-session` + `connect-mongo`, `bcrypt` cost 12 | Survives restarts |
| Live progress | Polling `GET /api/jobs/:id/progress?after=N` every **2000 ms**, **delta responses only** (Section 8) | Never ship 2,000 rows per tick |
| Apify | Raw REST via native `fetch` (`run-sync-get-dataset-items`), no SDK | Fewer deps |
| Job cap | **2,000 valid links per job, hard limit**, enforced server + client | Cost + UX predictability |
| Monorepo | `/server` + `/client`, Express serves `client/dist` in prod | One deploy unit |

Root scripts: `npm install` (postinstall installs both), `npm run build` (client), `npm start` (`node server/index.js`), `npm run dev` (concurrently: server 3000 + Vite 5173 proxying `/api`).

---

## 2. Repository Structure (exact)

```
reelytic/
├── package.json  ├── Dockerfile  ├── .env.example  ├── README.md  ├── BLUEPRINT.md
├── server/
│   ├── index.js  ├── config.js  ├── db.js  ├── bootstrap.js
│   ├── middleware/ (auth.js, errors.js)
│   ├── routes/ (auth, jobs, upload, export, admin, settings).routes.js
│   ├── services/ (apify, jobEngine, parse, export, cache, metrics, ledger).service.js
│   └── utils/ (urlNormalize.js, password.js, ua.js)   # ua.js: user-agent → "Chrome on Windows"
└── client/
    ├── index.html  ├── vite.config.js  └── public/ (favicon.svg, og-image.png)
    └── src/
        ├── main.jsx  ├── App.jsx
        ├── styles/ (tokens.css, base.css, components.css, landing.css)
        ├── api/client.js
        ├── context/ (AuthContext, ThemeContext, ToastContext).jsx
        ├── components/
        │   ├── Logo.jsx            # lockup + 5-click dev gesture
        │   ├── Shell.jsx           # app sidebar layout (authed area only)
        │   ├── PasswordInput.jsx   # show/hide, caps-lock, strength (Section 5.1)
        │   ├── DataTable.jsx       # sticky header, pagination, states
        │   ├── LiveRunTable.jsx    # react-window virtualized run view
        │   ├── Shimmer.jsx  Toast.jsx  ConfirmDialog.jsx  Modal.jsx
        │   ├── StatCard.jsx  ProgressBar.jsx  InfoIcon.jsx  CopyButton.jsx
        │   ├── FileDrop.jsx  EmptyState.jsx  NotFound.jsx
        │   └── LedgerHero.jsx      # animated ledger visual (landing + login)
        └── pages/
            ├── Landing.jsx         # public "/"
            ├── Login.jsx           # "/login", split-screen animated
            ├── ForceChangePassword.jsx  Settings.jsx
            ├── ReelReport.jsx  ProfileReport.jsx  History.jsx
            └── admin/ (DevUnlock, AdminDashboard, Clients, Ledger, SessionsLog).jsx
```

---

## 3. Environment & Boot

`.env.example`: required `MONGODB_URI`, `APIFY_API_KEY`; optional `MONGODB_DB_NAME=reelytic`, `SESSION_SECRET`, `PORT=3000`, `APP_TIMEZONE=Asia/Kolkata`, `CACHE_TTL_DAYS=7`, `ADMIN_USERNAME=admin`, `ADMIN_PASSWORD=`.

Boot order (`index.js`):
1. `config.js`: missing required var → plain-English error naming it exactly → `process.exit(1)`.
2. Connect Mongo → `ensureIndexes()`.
3. `bootstrap.js`: persist auto-generated `sessionSecret` to settings if unset; if `users` empty create admin (env creds or random 16-char, print banner `===== INITIAL ADMIN LOGIN: admin / <password> — change this now =====`, flag `mustChangePassword`); seed hashed dev password `Devcanonlyaccess` into settings if missing.
4. Job recovery: any job `running` → `paused` with `pausedReason: 'server-restart'`.
5. Security headers (manual: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`), session, JSON body (2 MB), routes, error handler, static `client/dist`, SPA fallback, listen `process.env.PORT || 3000`.

---

## 4. Design System — "The Ledger"

**Concept:** Reelytic turns messy creator data into an auditable ledger. Signature: **every number, metric, URL, and timestamp is set in JetBrains Mono with tabular numerals**; tables ruled like ledger lines; progress reads like entries being posted to a book. One accent, no gradients, no glassmorphism.

### 4.1 tokens.css (copy verbatim)

```css
:root {
  --bg:#F7F6F3; --surface:#FFFFFF; --surface-2:#F1EFEA;
  --border:#E4E1DA; --border-strong:#C9C5BB;
  --text:#1A1C20; --text-2:#5D6169; --text-3:#8B8F98;
  --accent:#E23E57; --accent-hover:#C93049; --accent-soft:#FBE9EC;
  --ok:#1F9D6B; --ok-soft:#E4F4ED; --warn:#C77E1F; --warn-soft:#FAF0DF;
  --err:#D33131; --err-soft:#FBE7E7; --locked:#EEF2F7;
  --shadow:0 1px 2px rgba(20,22,26,.06),0 4px 16px rgba(20,22,26,.05);
  --shadow-lg:0 8px 32px rgba(20,22,26,.12);
  --font-display:'Space Grotesk',system-ui,sans-serif;
  --font-body:'Inter',system-ui,sans-serif;
  --font-data:'JetBrains Mono',ui-monospace,monospace;
  --fs-xs:11px; --fs-sm:12.5px; --fs-base:14px; --fs-md:16px;
  --fs-lg:20px; --fs-xl:26px; --fs-2xl:34px; --fs-hero:clamp(34px,5vw,56px);
  --lh:1.5;
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px; --s8:64px;
  --r-sm:6px; --r-md:10px; --r-lg:14px; --r-full:999px; --sidebar-w:232px;
  --t-fast:120ms cubic-bezier(.4,0,.2,1); --t-base:200ms cubic-bezier(.4,0,.2,1);
}
[data-theme="dark"] {
  --bg:#101216; --surface:#171A20; --surface-2:#1E222A;
  --border:#262B34; --border-strong:#39404C;
  --text:#ECEDEF; --text-2:#A6ABB5; --text-3:#6E747F;
  --accent:#F0526B; --accent-hover:#F76F84; --accent-soft:#2C1A1F;
  --ok:#34B981; --ok-soft:#14261F; --warn:#E0A046; --warn-soft:#2A2214;
  --err:#EF5A5A; --err-soft:#2A1717; --locked:#1B2027;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 4px 16px rgba(0,0,0,.35);
  --shadow-lg:0 12px 40px rgba(0,0,0,.5);
}
```

Fonts via Google Fonts in `index.html`: Space Grotesk 500/700, Inter 400/500/600, JetBrains Mono 400/600. Rule with no exceptions: numeric/URL/timestamp content → `font-family:var(--font-data); font-variant-numeric:tabular-nums;`.

### 4.2 Component rules

- **Buttons:** primary accent/white 34px `--r-sm`, press `translateY(1px)`; secondary bordered transparent; destructive `--err`; all with disabled + loading (inline spinner replaces label, width preserved) states. Focus: 2px accent ring, 2px offset, always visible.
- **Inputs:** 38px, `--surface`, 1px `--border-strong`, focus border accent + soft ring; label above (`--fs-sm --text-2`); inline error below in `--err` with icon; error state shakes 4px/300ms once. Autofocus first field of every form. Enter submits.
- **PasswordInput.jsx (used for EVERY password field in the app, including admin modals):** eye/eye-off toggle button inside the field (aria-label "Show password"/"Hide password", tabbable, toggles `type`); caps-lock detection (`getModifierState('CapsLock')`) shows quiet inline hint "Caps Lock is on"; optional `showStrength` prop renders a 3-segment strength bar (weak <8 chars red / okay 8–11 amber / strong ≥12 or mixed-class green) with one-word label; `autoComplete` passed correctly (`current-password` / `new-password`).
- **Cards:** `--surface`, 1px `--border`, `--r-lg`, `--shadow`, pad `--s5`.
- **DataTable.jsx:** sticky header (`--surface-2`, uppercase `--fs-xs` letterspaced), 40px rows, hover `--surface-2`, 1px ledger rules, right-edge fade mask when h-scrollable, numeric cells right-aligned mono, built-in pagination (100/page) with "1–100 of 1,842" mono footer, and empty/loading(shimmer)/error states baked in.
- **LiveRunTable.jsx:** `react-window` FixedSizeList, 40px rows; "Follow live" pill toggle (on = auto-scroll to current row; any manual scroll turns it off, sticky "Jump to current ↓" chip appears).
- **Number display:** UI shows compact metrics ≥10,000 as `12.4K` / `1.2M` (mono), full value in `title` tooltip. **Exports always contain raw full numbers.**
- **CopyButton:** ghost icon button next to URLs/temp passwords; on copy → icon morphs to check for 1.2s + toast-less.
- **Toasts:** bottom-right, `--surface` card, 3px left rule (ok/err/accent), 4s auto-dismiss, hover pauses timer, slide+fade, max 3 stacked.
- **ConfirmDialog:** title states the action ("Delete client 'priya'?"), body states the consequence, destructive confirms are red and never the default-focused button; high-risk deletes require typing the name.
- **Shimmer:** gradient sweep 1.4s; `prefers-reduced-motion` → static pulse. Skeleton row count matches expected content (e.g., preview skeleton shows ~10 rows, not 3).
- **Empty states:** line-art inline SVG (`--text-3` stroke) + one sentence of direction + one primary action. Never bare "No data".
- **Logo.jsx:** wordmark "Reelytic", Space Grotesk 700, both `e`'s in mono + `--accent`. Carries the dev gesture: 5 clicks within 3s → `/dev-unlock` (timestamp array, admin-role only; clients get nothing).
- **Shell.jsx (authed area):** 232px sidebar — logo, nav (Reel Report / Profile Report / History / Settings; Admin group appears only after dev unlock), bottom: theme toggle (sun/moon, animated cross-fade) + user chip (username, role tag, logout in popover). <960px: sidebar → slide-over with hamburger, overlay click closes, Esc closes.
- **NotFound.jsx:** friendly 404 with a mono ledger-line motif and "Back to Reelytic" button. Unknown authed routes → 404; unknown public routes → 404.
- **Favicon:** simple "R" mark in accent on transparent, SVG.

---

## 5. Product Surfaces — screen-by-screen (build exactly this)

### 5.0 Public: Landing page (`/`)
Reelytic is product-first: visitors see value before a login form. Same token system, `landing.css` for layout. Authed users hitting `/` are redirected to `/reels`.

- **Nav (sticky, blur backdrop):** Logo left; right: "How it works" (anchor), "Log in" secondary button. No fake links.
- **Hero:** eyebrow `FOR INFLUENCER-MARKETING AGENCIES` (mono, letterspaced, accent) · H1 in `--fs-hero` display: **"Campaign reports in minutes, not workdays."** · sub: "Upload your sheet of reels or creator profiles. Reelytic fetches views, likes, comments and engagement rates — and hands the same sheet back, filled in." · primary CTA "Log in to your workspace" → `/login` · quiet caption below: "Accounts are provisioned for agency clients."
- **Hero visual = `LedgerHero.jsx` (the signature animation):** a stylized report table (5 columns: Reel, Views, Likes, Comments, ER) where rows "post" themselves — each row's cells start as shimmer, then numbers count up in mono and a subtle accent tick appears, looping through 6 rows with staggered timing (CSS + a tiny rAF count-up hook; ~10s loop; pauses on `prefers-reduced-motion` showing the final state).
- **"How it works" — 3 steps** (numbered, because it IS a sequence): 1. **Upload your sheet** — xlsx, csv or pasted links; your columns are never touched. 2. **We fetch the numbers** — live progress, pause anytime, up to 2,000 links per run. 3. **Download it back** — your original sheet + our metric columns, Excel or CSV.
- **Feature grid (6 cards):** Honest estimates ("Hidden likes are estimated — and always labelled as estimates, never mixed with real data"), Engagement rates done right (per-view for reels, per-follower for profiles), Live job control (pause/resume/partial download), Report history, Smart caching ("repeat links don't cost a second fetch"), Built for big sheets ("1,000+ rows stay fast and readable").
- **Time-math band:** left mono stat `2,000 reels ≈ 45 min` vs right `Manual entry ≈ 3 days` — one line: "That's the report your client gets today instead of Thursday."
- **Footer:** logo, "© 2026 Reelytic", theme toggle. Nothing else — no dead links to Privacy/Twitter that don't exist.
- Scroll-reveal: sections fade+rise 12px once (IntersectionObserver), disabled under reduced motion.

### 5.1 Login (`/login`) — split screen
- **Left panel (44% width, ≥960px):** the animated brand panel — `--surface-2` bg, Logo top, then a rotating value-prop carousel: 3 slides auto-advancing every 5s (fade+slide, dots clickable, pauses on hover/reduced-motion): ① "Turn a sheet of reel links into a full engagement report." + mini LedgerHero, ② "Real metrics and estimates, never mixed." + Likes/Est.Likes visual, ③ "Pause, resume, download partway. You're in control." + progress-bar visual. Below 960px this panel collapses to just the logo above the form.
- **Right panel:** centered 380px form. "Welcome back" (`--fs-xl` display) + "Log in to your Reelytic workspace". Username (autofocus, `autocomplete=username`, lowercased on blur) + PasswordInput (`current-password`). Primary full-width "Log in" with loading state. Errors are specific but safe: bad creds → "That username and password don't match."; disabled → "This account has been disabled. Contact your Reelytic admin."; revoked mid-session → login page shows info banner "You were signed out by an administrator." Below form, quiet: "No account? Accounts are created by your Reelytic admin."
- **Redirect logic:** already-authed visit → `/reels`. Successful login → `mustChangePassword ? /change-password : (the ?redirect= target if present and internal, else /reels)`. Deep-linking an authed route while logged out → `/login?redirect=<path>`.

### 5.2 ForceChangePassword (`/change-password`)
Locked route: while `mustChangePassword` is true, ALL authed routes redirect here; this page redirects away if flag is false. Card: "Set your password" + "You're using a temporary password. Choose your own to continue." New password (PasswordInput with strength, `new-password`) + Confirm (live "Passwords don't match" once both touched). Min 8 chars. Submit → success → **auto-redirect straight into `/reels`** (session already valid — do NOT bounce them back to login) with toast "Password updated. Welcome to Reelytic 👋". A quiet "Log out" link is the only escape.

### 5.3 Settings
Change password: current (PasswordInput) + new (strength) + confirm → on success toast "Password updated" and fields clear; session stays alive. Theme preference note. Account info block (username, role, member since — mono date).

### 5.4 Reel Report & Profile Report (same skeleton)
**State A — Upload:**
- FileDrop card: dashed `--border-strong`, accent glow + "Drop it" label on dragover; click opens picker; also a "paste links instead" toggle → textarea with live mono counter "37 links detected" (split on newlines/whitespace) and the same 2,000 note.
- Under the drop: "Accepts .xlsx, .xls, .csv, .txt · up to 2,000 links per run".
- Wrong file type (image/PDF/etc., checked by extension AND magic bytes) → inline error card: "That's a .png. Reelytic reads .xlsx, .xls, .csv or .txt files." with a "Choose another file" button.
- Big-file parse: indeterminate bar + "Reading your sheet… 1,842 rows found" (server parses fast; show at least 400ms so it never flashes).

**State B — Preview:**
- Header: filename chip + "1,842 rows · 1,795 valid · 31 invalid · 16 duplicates" — each count is a clickable filter chip (All / Valid / Invalid / Duplicates), active chip filled accent-soft.
- DataTable, paginated 100/page. User's original columns: rename via click-header inline input (Enter/blur commits, Esc cancels), remove via header ⋯ menu (ConfirmDialog if column has data), "+ Add column" at row end. **Reelytic columns appended right, `--locked` bg, lock icon, tooltip "Added by Reelytic", not editable — server also rejects attempts.**
- Invalid rows: `--err-soft` bg + reason chip ("Not an Instagram reel link"); duplicates: `--warn-soft` + "Duplicate of row 12". Invalid/duplicate rows still export with their original data.
- **Over-limit:** if valid rows > 2,000 → modal: "This sheet has 2,340 valid links. Reelytic runs up to 2,000 per job." Buttons: [Run first 2,000] [Cancel] — choosing run marks the overflow rows `skipped` (exported untouched with note "over 2,000-link limit").
- Sticky footer action bar: left = counts summary; right = [Discard] secondary (ConfirmDialog) + **[Start report — 1,795 links]** primary (count in the button label; shows est. duration under it: "≈ 42 min", from `count / concurrency × 4s` heuristic before real data exists).

**State C — Running (built for 2,000 rows):**
- Status strip: 4 StatCards — Total / Processed / Failed / Success — mono count-up ticks; plus a fifth slim card: **ETA** ("~38 min left", rolling average of last 20 row-durations; "finishing up…" under 1 min) and elapsed timer.
- ProgressBar (accent, animated) + percent mono.
- Controls: [Pause] ↔ [Resume] (swap in place, no layout shift), [Reset] destructive (ConfirmDialog: "This clears all fetched results for this job."), [Download partial ↓] secondary — always enabled once ≥1 row done.
- Info banner (dismissible, remembered per user in localStorage): "Safe to close this tab — the report keeps running on the server. Pick it up anytime from History."
- **LiveRunTable** (virtualized): row = SR No · link (mono, truncated middle, CopyButton on hover) · status (pending shimmer / processing = accent-soft bg + "posting…" pulse / done = key metrics inline / failed = `--err` chip with reason on hover / ⚡ chip when served from cache). "Follow live" toggle per 4.2.
- **Browser tab title** mirrors progress: `▶ 43% · Reelytic` while running, `✓ Report ready · Reelytic` when done (reset on route leave).
- Failures never interrupt: the job flows on; the Failed StatCard ticks and rows carry their reason.

**State D — Done:**
- Success moment: header swaps to "Report ready" + one subtle confetti-free accent flourish (the progress bar fills then fades to a thin ok-colored rule). Toast "Report finished — 1,771 of 1,795 succeeded."
- [Download .xlsx] primary, [.csv] secondary, [Run another report] ghost. Failed-rows note with "Retry failed (24)" secondary → re-queues only failed rows into the same job.
- ER column header InfoIcon popover: reel version explains `(Likes + Comments) ÷ Views × 100` and why views (video benchmark); profile version explains follower-based account ER.

### 5.5 History
DataTable: Type chip · Report name (filename) · Links (mono) · ✓/✗ (mono, ok/err colored) · Status chip (Done/Paused/Running—live dot pulse) · Date (mono, relative "2h ago" with full date tooltip). Row click → job page (resumes the exact Running/Done view). Running/paused jobs from a previous session are picked up here seamlessly. Empty state: "No reports yet. Your finished reports will live here." + [New reel report].

### 5.6 Admin surfaces (visible only to admin after dev unlock)
- **DevUnlock:** minimal card, PasswordInput, wrong → shake + "That's not it." 5 wrong attempts per session → "Locked for this session." and input disables.
- **AdminDashboard:** StatCards (Reel jobs · Profile jobs · Links processed · Success rate); **Live jobs panel** — per running job: owner, type, mini progress bar, current item (mono), counts, polling 3s; **charts hand-rolled SVG from tokens (no chart lib):** 14-day jobs bar chart + per-user links horizontal bars, both with hover value tooltips and honest empty states ("No activity yet this fortnight."); Apify consumption meter = links fetched (cache hits excluded) per user this month; recent logins mini-table.
- **Clients:** table (username · status chip Active/Disabled · created · last login mono-relative) + [New client] modal (username input + auto-generated 12-char temp password shown once with CopyButton + "They'll set their own password on first login"). Row ⋯ menu: **Reset password** (modal shows new temp once, re-flags mustChangePassword, revokes their sessions), **Disable / Enable** (disable = instant lockout, see Revoke below), **Revoke sessions** ("Signs this user out of all devices now"), **Delete** (ConfirmDialog, type the username, warns ledger data is kept).
- **Ledger:** filter bar (username select · type select · date range) + paginated DataTable (URL mono truncated + CopyButton · type · owner · job link · result chip · timestamp) + [Export Excel ↓] honoring active filters.
- **SessionsLog:** Active sessions table (user · IP · device via `ua.js` "Chrome on Windows" · signed in mono-relative · [Revoke] per row with ConfirmDialog) + login history below (success/fail chips). Admin revoking their own current session logs them out too — warn in the dialog.

---

## 6. Auth, Revoke & Session Model

- Login lowercases username, verifies bcrypt, rejects disabled, records `loginHistory` on success AND failure (with IP + UA). Session stores `{ username, role, createdAt: now }`.
- **Instant revoke (the mechanism for revoke/disable/reset — implement exactly):** `users.sessionsRevokedAt: Date|null`. `requireLogin` middleware on every request: load user; if `disabled` OR (`sessionsRevokedAt` && `session.createdAt < sessionsRevokedAt`) → destroy session → 401 `{ error, code: 'REVOKED' }`. Client fetch wrapper sees `REVOKED` → clears auth state → hard-redirects to `/login?reason=revoked` (shows the "signed out by an administrator" banner). Result: revoke/disable/password-reset kicks the user out on their very next request, all devices, no session-store surgery needed. Per-session revoke in SessionsLog additionally deletes that one session doc.
- Dev mode: `session.devMode` flag; `requireDevMode` guards admin routes; unlock endpoint bcrypt-compares against settings `devPassword`, 5 attempts/session.
- Rate-limit login: in-memory map per IP+username, 10 fails / 10 min → 429 "Too many attempts. Try again in a few minutes."
- Passwords: min 8 chars everywhere, hashed cost 12, never logged, never returned.

---

## 7. Data Model (Mongo — exact)

```
users:        { _id, username(unique,lowercase), passwordHash, role:'admin'|'client',
                mustChangePassword, disabled, sessionsRevokedAt, createdAt, lastLoginAt }
settings:     { key(unique), value }        // sessionSecret, devPassword, cacheTtlDays
jobs:         { _id, type:'reel'|'profile', ownerUsername,
                status:'preview'|'running'|'paused'|'done'|'reset', pausedReason?,
                fileName, originalColumns:[{name,renamedTo?}],
                rows:[RowDoc], counts:{total,processed,failed,success,skipped},
                cursor, avgRowMs,           // rolling avg for ETA
                createdAt, updatedAt, finishedAt? }
  RowDoc:     { i, input:{url, original:{...}},
                state:'pending'|'processing'|'done'|'failed'|'invalid'|'duplicate'|'skipped',
                result?, error?, fromCache?, ms? }
submittedLinks:{ url, type, ownerUsername, jobId, result:'success'|'failed'|'invalid', at }
cache:        { url(unique), type, data, fetchedAt }     // TTL checked in code (configurable)
loginHistory: { username, ip, userAgent, success, at }
usageStats:   { username, date:'YYYY-MM-DD', reelJobs, profileJobs,
                itemsProcessed, apifyFetches, success, failed }   // upsert $inc
sessions:     connect-mongo
```
Indexes: users.username unique; settings.key unique; jobs {ownerUsername,createdAt:-1},{status}; submittedLinks {ownerUsername,at:-1},{url}; cache.url unique; loginHistory {at:-1},{username,at:-1}; usageStats {username,date} unique.

MetricsDoc reel: `{ name, profileLink, followers, reelLink, views, likes, estLikes, comments, shares, er }` (`likes`: number | `'Hidden'`; `estLikes`: number | `''`). Profile: `{ name, profileLink, followers, avgViews, avgEr, reelsAnalyzed, perReel:[{link,shortcode,views,likes,comments,er}] }`.

---

## 8. API Contract

All `/api`, JSON, errors `{ error, code? }`, async-wrapped.

**Auth:** `POST /auth/login` → `{user:{username,role,mustChangePassword}}` · `POST /auth/logout` 204 · `GET /auth/me` · `POST /auth/change-password {currentPassword?,newPassword}` (current not required while mustChangePassword) — clears flag, keeps session · `POST /auth/dev-unlock {password}`.

**Upload/preview:** `POST /upload/:type(reel|profile)` multipart `file` OR `{links}` → validates ext + magic bytes; parses; detects URL column (reel: `url|link|reel link|reel url`; profile: `profile url|profile|url`; case-insensitive; else 422 naming accepted columns); normalizes; flags invalid/duplicate; creates job `preview` → `{ jobId, columns, totalRows, counts, rowsPage }` (rows served paginated: `GET /jobs/:id/rows?state=&page=` 100/page). · `PATCH /jobs/:id/columns {renames,removed,added}` user columns only; locked-column attempts → 400.

**Jobs:** `POST /jobs/:id/start {limitTo2000Confirmed?}` (422 with `code:'OVER_LIMIT'` + counts if >2000 valid and not confirmed) · `/pause` · `/resume` · `/reset` · `POST /jobs/:id/retry-failed` (re-queues failed rows, status running) · **`GET /jobs/:id/progress?after=N` → `{ status, counts, cursor, etaMs, currentRows:[{i,url}], updates:[slim rows with i > after that changed] }` — deltas only; the client merges. Never returns the full row array.** · `GET /jobs/:id` full job meta (for page load; rows via the paginated endpoint or, if done, the client just downloads) · `GET /jobs?mine=1` history (admin `?user=`).

**Export:** `GET /export/:jobId.xlsx|.csv` — streams, works mid-job, `reelytic-{type}-{yyyymmdd}.xlsx`.

**Admin (requireAdmin+DevMode):** `GET /admin/overview` · CRUD `/admin/clients` (create/reset return temp password once; PATCH `{disabled}` / `{resetPassword:true}` / `{revokeSessions:true}` — reset & disable also set `sessionsRevokedAt`) · `GET /admin/ledger?user=&type=&from=&to=` + `/admin/ledger.xlsx` same filters · `GET /admin/sessions` + `DELETE /admin/sessions/:sid`.

---

## 9. Parsing, Limits & URL Rules

- exceljs for xlsx/xls; manual CSV honoring quoted commas; txt = one URL/line → column `URL`. Pasted links → same pipeline.
- Normalization: trim → strip from `?` → strip trailing `/` → force `https://`, allow `www.` → must match `instagram.com/(reel|reels|p)/{shortcode}` (reel) or `instagram.com/{username}` (profile); else invalid with human reason.
- Duplicates: first occurrence valid; later ones flagged, **never re-fetched** — at run time they copy the original's result (chip "same as row 12").
- **Hard cap 2,000 valid links per job** — enforced at `/start` (server) and in the over-limit modal (client). Overflow rows → `skipped`.
- Empty rows dropped silently; whitespace-only cells treated as empty. Original user data always preserved byte-for-byte in `input.original`.

## 10. Apify, Metrics & Cache

- `runActor(actorId, input)` → `POST https://api.apify.com/v2/acts/{id}/run-sync-get-dataset-items?token=KEY`, 120s AbortController timeout; retry ×2 (2s, 5s) on network/5xx/429; then row fails with readable reason ("Instagram didn't return data for this link").
- Concurrency constants in jobEngine: **REEL_BATCH=3, PROFILE_BATCH=2**. Between batches: 250ms breather (rate-friendliness at 2K scale).
- Defensive field picking via `pickFirst(obj, paths[])`: views ← `videoPlayCount|playCount|videoViewCount`; likes ← `likesCount`; comments ← `commentsCount`; shares ← `sharesCount|shareCount|0`; owner ← `ownerFullName|ownerUsername`; followers ← `ownerFollowersCount|followersCount|0`. Profile posts: video = `type==='Video'||productType==='clips'`, pass `skipPinnedPosts:true`, request 18 posts, enable the actor's detailed-data flag so `videoPlayCount` returns; log a startup-style warning if all views come back 0.
- Hidden likes: `likesCount` missing or `-1` with views>0 → `likes:'Hidden'`, `estLikes = round(views × U(0.015,0.025))`. **All likes logic flows through one `resolveLikes()` — estimates never enter the Likes column, `estLikes` is `''` when real likes exist. Non-negotiable.**
- ER: reel `round2((likes+comments)/views×100)` (0 if views 0; hidden likes → use estLikes for ER and mark ER cell tooltip "estimated"); profile `round2((avgLikes+avgComments)/followers×100)` (0 if followers 0), avgViews = mean videoPlayCount over up-to-6 latest videos, `reelsAnalyzed = n`.
- Invalid → `invalid reel link` / `invalid profile link`, numerics `0`, never `N/A`.
- Cache: hit if `fetchedAt` within `cacheTtlDays`; cached rows = success + `fromCache` (⚡ chip, excluded from `apifyFetches` stat).

## 11. Job Engine

In-memory `Map<jobId,{abort}>` + Mongo as truth. `start`: status running → loop batches from `cursor` (skip invalid/skipped; duplicates copy originals): mark processing → cache-or-Apify → write result/state + `ms` → `$inc` counts → update `avgRowMs` (rolling 20) → advance cursor → per-row try/catch so failures never kill the job → check abort flag AND re-read status each batch. `pause`: flag + status paused (in-flight rows finish, nothing new starts). `resume`: from cursor. `reset`: only paused/preview/done → wipe results, zero counts, cursor 0, status preview. `retry-failed`: failed rows → pending, run again. Row completion → ledger record + usageStats $inc. Loop end → done + finishedAt. Boot recovery per §3.4; History resumes the UI seamlessly.

## 12. Export

Order: user's original columns (renames applied, original order) → Reelytic columns exactly per product spec (reel: SR No.·Name·Profile Link·Followers·Reel Link·Views·Likes·Est. Likes·Comments·Shares·Engagement Rate; profile: SR No.·Name·Profile Link·Followers·Average Views·Average ER·Reels Analyzed). Reel = 1 sheet; profile = `Summary` + `Reel Breakdown` (Profile·Reel Link·Shortcode·Views·Likes·Comments·ER). Bold frozen header, Reelytic headers tinted accent-soft, auto widths ≤40, real numbers (not strings; `Hidden` stays a string), mid-job exports leave pending metric cells blank, skipped rows noted. CSV = summary only, RFC-quoted. 2,000-row export must stream the buffer without blocking the event loop noticeably (exceljs write is fine).

---

## 13. Micro-UX Master Checklist (Sonnet: every item is a requirement)

**Forms & input:** autofocus first field · Enter submits · loading buttons keep width · inline errors clear on retype · username lowercase on blur · all password fields = PasswordInput · correct `autocomplete` everywhere · no browser default validation popups (`novalidate`, custom messages).
**Feedback:** every mutation → toast or inline confirmation · every destructive action → ConfirmDialog · every async surface → shimmer, never blank · every list → designed empty state · every error → what happened + what to do.
**Motion:** 120–200ms, ease curves from tokens · no layout shift on state swaps (Pause↔Resume, password eye toggle) · `prefers-reduced-motion` respected globally (landing hero, carousel, shimmer, count-ups all degrade to static).
**Big data (1–2K rows):** preview paginated · run view virtualized · progress polling is delta-only · counts/ETA always visible without scrolling · middle-truncated URLs with copy · tab-title progress · "safe to close tab" banner.
**Trust:** locked Reelytic columns with tooltip · Est. Likes never in Likes (UI, export, everywhere) · estimated ER tooltip · cache ⚡ chip · failed rows carry reasons · partial download always available.
**Access & keyboard:** visible focus rings on every interactive element · modals trap focus, Esc closes, restore focus on close · icon buttons have aria-labels · tables use th/scope · toggle states use aria-pressed · contrast AA in both themes.
**Sessions:** revoked/disabled users bounced on next request with the banner · expired session mid-action → redirect to `/login?redirect=` back to where they were · logout → landing page.
**Polish:** favicon · `<title>` per page ("Reel Report · Reelytic") · 404 page · theme choice persisted (localStorage, default `prefers-color-scheme`) with no flash-of-wrong-theme (inline script in index.html sets `data-theme` pre-paint) · relative timestamps with full-date tooltips · Indian-locale-agnostic compact numbers (12.4K style) · selection color = accent-soft.

---

## 14. Build Phases — copy-paste prompts for Sonnet

Open every session with: *"You are implementing the Reelytic app strictly per BLUEPRINT.md in this repo. Follow it literally — do not redesign, rename, or restructure. Section 13 is a hard requirement list, not suggestions. Ask nothing; the blueprint is the answer."*

**Phase 1 — Scaffold & boot:** repo per §2, root scripts §1, config/db/bootstrap per §3 & §7 indexes, Dockerfile (node:20-alpine → install → build → `npm start`), `.env.example`. Boots, fails loudly, prints admin banner, serves placeholder.
**Phase 2 — Auth & revoke:** §6 + §8 auth endpoints, middleware with the `sessionsRevokedAt` mechanism, login rate limit, loginHistory, dev-unlock.
**Phase 3 — Parse, limits & preview:** §9 + upload/columns endpoints incl. magic-byte validation, paginated rows endpoint, 2,000-cap with OVER_LIMIT flow.
**Phase 4 — Apify, metrics & cache:** §10 incl. `resolveLikes()` integrity rule, retries, defensive picking.
**Phase 5 — Job engine, ledger, export:** §11 + §12 + jobs/export/retry-failed routes + delta progress endpoint. Verify pause/resume/reset/restart/retry semantics.
**Phase 6 — Frontend foundation:** tokens.css **verbatim §4.1**, base.css (reset, focus, reduced-motion, pre-paint theme script), every §4.2 component including PasswordInput and LiveRunTable, contexts, fetch wrapper with REVOKED handling, Shell, routing + guards (mustChangePassword lock, ?redirect), Login split-screen with carousel, ForceChangePassword with auto-redirect-in, Settings, 404, favicon, page titles.
**Phase 7 — Landing page:** §5.0 exactly, including LedgerHero animation, scroll reveals, and all copy verbatim.
**Phase 8 — Report screens & History:** §5.4 + §5.5: FileDrop + paste mode, preview with filter chips/column editing/over-limit modal, run state with delta polling, virtualized LiveRunTable, ETA, tab title, pause/resume/reset/partial/retry-failed, done state, ER popovers, History with live jobs.
**Phase 9 — Admin:** §5.6 + §8 admin: dev gesture + unlock, dashboard with hand-rolled SVG charts + live jobs + consumption meter, Clients with create/reset/disable/revoke/delete flows, Ledger with filtered Excel export, SessionsLog with per-session revoke.
**Phase 10 — README & hardening:** README per original product spec deliverables (Atlas, Apify key, two-var contract, Railway/Render/VPS+PM2+Nginx/Docker, troubleshooting, Est. Likes honesty rule). Then audit the entire app against **Section 13 line by line** and fix every miss.

### Final acceptance checklist
- [ ] Fresh clone + 2 env vars → live; admin banner printed; `/` shows landing, animated hero loops
- [ ] Login: eye toggle works, caps-lock hint shows, wrong creds shake with message, carousel rotates
- [ ] First login with temp password → forced to set password → **lands inside the app automatically** with welcome toast
- [ ] Upload 2,340-link sheet → over-limit modal → run first 2,000 → preview chips filter, columns rename, Reelytic columns locked
- [ ] 2,000-row run: UI stays smooth (virtualized), polling payloads are deltas, ETA + tab title update, pause stops new items, resume continues, partial xlsx mid-run
- [ ] Kill server mid-job → restart → paused in History → resume completes; retry-failed re-runs only failures
- [ ] Hidden-likes reel: Likes=`Hidden`, Est. Likes filled, estimate NEVER in Likes column (UI + both exports)
- [ ] Repeat link within TTL → ⚡ chip, no Apify call, excluded from consumption meter
- [ ] Admin: revoke user → that user is thrown to login **on their next click** with the banner; disable and password-reset do the same; per-session revoke works
- [ ] 5× logo click (admin only) → dev unlock → dashboard charts, ledger filter + Excel export, sessions log
- [ ] Exports: original columns untouched in order + Reelytic columns; raw numbers; profile breakdown sheet present
- [ ] Both themes AA contrast, no theme flash on load, keyboard-only pass on every screen, reduced-motion pass
