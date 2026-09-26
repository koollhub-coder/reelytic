# Reelytic performance report

Generated 2026-09-26T09:51:48.262Z

## API response times (median of 15 requests, real database, realistic data)

Data: 60 reports of 200 rows, 800 creators, 3,000 ledger and login rows. Database is Atlas over the internet, so every figure includes that latency.

| Endpoint | Before | After | Faster | Wire size before | Wire size after | On a slow phone connection before (est.) | after (est.) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GET /auth/me | 111 ms | 79 ms | 1.4x | 0.3 KB | 0.3 KB | 113 ms | 81 ms |
| GET /me/stats?days=14 (dashboard) | 118 ms | 115 ms | 1.0x | 2.2 KB | 0.4 KB | 129 ms | 117 ms |
| GET /jobs (history, 100 reports) | 1.16 s | 139 ms | 8.4x | 20.0 KB | 1.1 KB | 1.26 s | 144 ms |
| GET /jobs?limit=10 | 364 ms | 134 ms | 2.7x | 3.4 KB | 0.4 KB | 381 ms | 136 ms |
| GET /jobs/:id (open a report) | 173 ms | 136 ms | 1.3x | 74.4 KB | 7.6 KB | 545 ms | 174 ms |
| GET /jobs/:id/rows (results page) | 145 ms | 106 ms | 1.4x | 9.2 KB | 1.2 KB | 191 ms | 112 ms |
| GET /campaigns | 1.17 s | 135 ms | 8.6x | 1.8 KB | 1.8 KB | 1.18 s | 144 ms |
| GET /creators?limit=50 | 241 ms | 216 ms | 1.1x | 24.4 KB | 2.0 KB | 363 ms | 226 ms |
| GET /creators/summary | 128 ms | 103 ms | 1.2x | 0.1 KB | 0.1 KB | 128 ms | 103 ms |
| GET /settings/report-branding | 87 ms | 96 ms | 0.9x | 0.1 KB | 0.1 KB | 88 ms | 97 ms |
| GET /pricing/plans (public) | 32 ms | 36 ms | 0.9x | 1.6 KB | 1.6 KB | 40 ms | 44 ms |
| GET /help/facts (public) | 16 ms | 15 ms | 1.1x | 0.1 KB | 0.1 KB | 16 ms | 15 ms |
| GET /public/campaigns/:token (client portal) | 153 ms | 165 ms | 0.9x | 253.6 KB | 23.1 KB | 1.42 s | 281 ms |
| GET /admin/clients | 100 ms | 93 ms | 1.1x | 2.2 KB | 0.4 KB | 111 ms | 95 ms |
| GET /admin/ledger?limit=1000 | 228 ms | 239 ms | 1.0x | 239.5 KB | 11.7 KB | 1.43 s | 298 ms |
| GET /admin/sessions?limit=1000 | 203 ms | 223 ms | 0.9x | 214.4 KB | 9.2 KB | 1.27 s | 269 ms |
| GET /admin/platform-credits | 63 ms | 64 ms | 1.0x | 0.4 KB | 0.4 KB | 65 ms | 66 ms |

### What a person waits for when opening a page (all of its calls at once)

| Scenario | Before | After | Faster |
| --- | --- | --- | --- |
| Open Dashboard (me + stats + jobs, parallel) | 284 ms | 138 ms | 2.1x |
| Open History (me + jobs + campaigns, parallel) | 2.57 s | 133 ms | 19.3x |
| Open Creators (me + list + summary + campaigns, parallel) | 1.81 s | 213 ms | 8.5x |
| 16 simultaneous dashboard+history calls | 8.88 s | 912 ms | 9.7x |
| Run a 60-link report (scraper stubbed, engine bookkeeping only) | 13.5 s | 5.87 s | 2.3x |

## Page load in a real browser (production build, median of 3, phone-sized, CPU slowed 4x on the throttled networks)

"Content on screen" is the moment the page is drawn and its loading screen is gone. LCP is the largest paint. Cold = first visit, empty cache. Warm = return visit.


### Wi-Fi / fast

| Page | Visit | Content on screen before | after | Faster | LCP before | after | Transferred before | after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Landing (signed out) | cold | 866 ms | 118 ms | 7.3x | 792 ms | 180 ms | 619 KB | 293 KB |
| Landing (signed out) | warm | 550 ms | 38 ms | 14.5x | 392 ms | 52 ms | 3 KB | 1 KB |
| Login | cold | 825 ms | 499 ms | 1.7x | 548 ms | 124 ms | 731 KB | 418 KB |
| Login | warm | 517 ms | 437 ms | 1.2x | 184 ms | 60 ms | 59 KB | 56 KB |
| Pricing | cold | 730 ms | 507 ms | 1.4x | 436 ms | 208 ms | 587 KB | 290 KB |
| Pricing | warm | 516 ms | 453 ms | 1.1x | 172 ms | 164 ms | 3 KB | 2 KB |
| Dashboard (signed in) | cold | 1.12 s | 504 ms | 2.2x | 1.15 s | 360 ms | 962 KB | 409 KB |
| Dashboard (signed in) | warm | 569 ms | 440 ms | 1.3x | 448 ms | 180 ms | 5 KB | 2 KB |
| History (signed in) | cold | 3.83 s | 498 ms | 7.7x | 3.84 s | 232 ms | 666 KB | 431 KB |
| History (signed in) | warm | 3.13 s | 473 ms | 6.6x | 3.16 s | 240 ms | 7 KB | 2 KB |
| Reel Report upload (signed in) | cold | 878 ms | 524 ms | 1.7x | 896 ms | 268 ms | 683 KB | 410 KB |
| Reel Report upload (signed in) | warm | 726 ms | 460 ms | 1.6x | 732 ms | 240 ms | 7 KB | 2 KB |

### 4G (9 Mbps, 60 ms)

| Page | Visit | Content on screen before | after | Faster | LCP before | after | Transferred before | after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Landing (signed out) | cold | 1.86 s | 789 ms | 2.4x | 1.88 s | 1.07 s | 619 KB | 293 KB |
| Landing (signed out) | warm | 1.01 s | 352 ms | 2.9x | 940 ms | 380 ms | 3 KB | 1 KB |
| Login | cold | 1.67 s | 1.23 s | 1.4x | 1.66 s | 788 ms | 675 KB | 418 KB |
| Login | warm | 1.04 s | 803 ms | 1.3x | 980 ms | 816 ms | 8 KB | 56 KB |
| Pricing | cold | 1.64 s | 1.40 s | 1.2x | 1.64 s | 988 ms | 587 KB | 290 KB |
| Pricing | warm | 1.01 s | 775 ms | 1.3x | 820 ms | 792 ms | 3 KB | 2 KB |
| Dashboard (signed in) | cold | 2.26 s | 1.35 s | 1.7x | 2.29 s | 1.36 s | 962 KB | 409 KB |
| Dashboard (signed in) | warm | 1.04 s | 1.07 s | 1.0x | 1.08 s | 632 ms | 5 KB | 2 KB |
| History (signed in) | cold | 4.88 s | 1.31 s | 3.7x | 4.93 s | 1.34 s | 666 KB | 431 KB |
| History (signed in) | warm | 4.06 s | 789 ms | 5.1x | 4.09 s | 780 ms | 7 KB | 2 KB |
| Reel Report upload (signed in) | cold | 1.94 s | 1.12 s | 1.7x | 1.96 s | 1.15 s | 683 KB | 403 KB |
| Reel Report upload (signed in) | warm | 1.27 s | 927 ms | 1.4x | 1.30 s | 948 ms | 7 KB | 2 KB |

### Slow 4G (1.6 Mbps, 150 ms)

| Page | Visit | Content on screen before | after | Faster | LCP before | after | Transferred before | after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Landing (signed out) | cold | 4.73 s | 1.09 s | 4.3x | 4.76 s | 1.82 s | 619 KB | 293 KB |
| Landing (signed out) | warm | 1.75 s | 367 ms | 4.8x | 1.80 s | 400 ms | 3 KB | 1 KB |
| Login | cold | 3.96 s | 1.78 s | 2.2x | 3.97 s | 1.78 s | 575 KB | 214 KB |
| Login | warm | 1.34 s | 1.03 s | 1.3x | 1.35 s | 1.05 s | 4 KB | 50 KB |
| Pricing | cold | 3.90 s | 1.95 s | 2.0x | 3.86 s | 800 ms | 587 KB | 220 KB |
| Pricing | warm | 1.19 s | 1.09 s | 1.1x | 1.04 s | 1.12 s | 3 KB | 71 KB |
| Dashboard (signed in) | cold | 6.33 s | 2.35 s | 2.7x | 6.36 s | 2.38 s | 962 KB | 334 KB |
| Dashboard (signed in) | warm | 1.71 s | 1.14 s | 1.5x | 1.74 s | 1.17 s | 5 KB | 38 KB |
| History (signed in) | cold | 7.13 s | 2.36 s | 3.0x | 7.16 s | 2.38 s | 666 KB | 282 KB |
| History (signed in) | warm | 4.32 s | 1.04 s | 4.1x | 4.36 s | 1.05 s | 7 KB | 15 KB |
| Reel Report upload (signed in) | cold | 4.77 s | 2.25 s | 2.1x | 4.80 s | 2.28 s | 683 KB | 306 KB |
| Reel Report upload (signed in) | warm | 1.75 s | 1.62 s | 1.1x | 1.77 s | 1.65 s | 7 KB | 2 KB |

## Landing page: before against the prerendered page

| Network | Visit | First paint before | after | LCP before | after | Interactive-ready before | after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Wi-Fi / fast | cold | 316 ms | 136 ms | 792 ms | 184 ms | 866 ms | 110 ms |
| Wi-Fi / fast | warm | 32 ms | 40 ms | 392 ms | 40 ms | 550 ms | 25 ms |
| 4G (9 Mbps, 60 ms) | cold | 408 ms | 928 ms | 1.88 s | 1.26 s | 1.86 s | 889 ms |
| 4G (9 Mbps, 60 ms) | warm | 208 ms | 344 ms | 940 ms | 344 ms | 1.01 s | 313 ms |
| Slow 4G (1.6 Mbps, 150 ms) | cold | 1.06 s | 1.04 s | 4.76 s | 1.70 s | 4.73 s | 996 ms |
| Slow 4G (1.6 Mbps, 150 ms) | warm | 420 ms | 416 ms | 1.80 s | 416 ms | 1.75 s | 381 ms |

## Apify (real runs, real money)

### One reel run of 10 links, the same actor, different ways of calling it

| How it is called | Total time | Actor working | Waiting on cost | Cost |
| --- | --- | --- | --- | --- |
| reel actor, today (2s polling + fixed 6s cost wait) | 19.2 s | 7.16 s | 7.34 s | $0.027 |
| reel actor, long-poll, no fixed wait | 5.53 s | 3.60 s | none | $0.027 |
| reel actor, long-poll, memory 1024 MB | 6.31 s | 4.48 s | none | $0.027 |
| reel actor, long-poll, memory 2048 MB | 11.8 s | 9.96 s | none | $0.027 |
| reel actor, long-poll, memory 4096 MB | 5.99 s | 4.24 s | none | $0.027 |
| reel actor, long-poll, 5 urls | 5.81 s | 3.83 s | none | $0.015 |
| followers actor, today | 17.6 s | 8.54 s | 7.24 s | $0.009 |
| followers actor, long-poll | 8.96 s | 7.09 s | none | $0.009 |

### How one run scales with the number of links

| Links in one run | Time to data | Actor working | Per link |
| --- | --- | --- | --- |
| 10 | 8.61 s | 6.494 s | 861 ms |
| 20 | 9.80 s | 8.499 s | 490 ms |
| 40 | 19.9 s | 18.562 s | 497 ms |

The reported cost stays at the start fee for about 4.76 s after a run finishes, then jumps to the real figure. The app used to wait a fixed 6 s for it on every run; it now records an estimate at once and replaces it with the real figure when it lands.

### A whole batch, the way the app runs it (reels plus follower lookup), old way against new way

| Case | Time until the data is ready | Cost |
| --- | --- | --- |
| 30 links, old way (2 batches of 15, one after another) | 76.1 s | $0.142 |
| 30 links, new way (2 batches of 15 at once, cost settled later) | 22.1 s | $0.159 |
| 60 links, new way (3 batches of 20 at once, cost settled later) | 36.3 s | $0.302 |

30 links: 76.1 s -> 22.1 s (3.4x faster). 60 links in the new way take 36.3 s; the old way needs about 152.2 s.
