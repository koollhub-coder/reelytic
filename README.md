# Reelytic — Campaign Reports in Minutes, Not Workdays

> Reelytic turns messy influencer-marketing creator data into an auditable ledger. Designed for elite influencer-marketing agencies.

---

## Architecture & Tech Stack
- **Backend:** Node.js 20 + Express 4
- **Database:** MongoDB Atlas (native `mongodb` driver v6, no Mongoose) + robust auto-fallback in-memory/JSON store
- **Frontend:** React 18 + Vite, plain CSS with design tokens (`--surface`, `--accent`, JetBrains Mono for all numeric/tabular data)
- **Spreadsheets:** `exceljs` for server-side parsing and professional styled exports
- **Scraping:** Apify REST API (Actor for Reels & Profiles) with smart caching, retries, and concurrency control. Includes automated simulation/mock fallback when Apify API key is missing or in test mode.

---

## Quick Start

1. **Clone & Install:**
   ```bash
   git clone <repo-url> reelytic
   cd reelytic
   npm install
   ```

2. **Configure Environment:**
   Copy `.env.example` to `.env` and configure your credentials:
   ```env
   MONGODB_URI=mongodb://localhost:27017/reelytic
   APIFY_API_KEY=your_apify_api_key_here
   SESSION_SECRET=your_super_secret_key
   PORT=3000
   ```
   *(Note: If MongoDB is not running locally, Reelytic automatically falls back to an embedded high-performance storage engine so the app works instantly without configuration friction).*

3. **Run Development Server:**
   ```bash
   npm run dev
   ```
   This concurrently starts the Express backend (port 3000) and Vite dev server (port 5173 with `/api` proxy).

4. **Production Build:**
   ```bash
   npm run build
   npm start
   ```

---

## Default Admin Access
Upon first boot, if no users exist, Reelytic automatically creates an initial admin account:
- **Username:** `admin`
- **Password:** Printed in server startup logs (or auto-generated secure 16-character string).
- **First Login:** You will be prompted to set your permanent secure password.

---

## Core Features & Design Principles
- **The Ledger Design System:** Typography-driven UI using Space Grotesk, Inter, and JetBrains Mono with tabular numerals. Every metric, URL, and timestamp is clearly formatted.
- **2,000-Link Hard Cap:** Enforced server-side and client-side for predictable job duration and cost control.
- **Live Delta Polling:** Virtualized `react-window` run table updating every 2 seconds with lightweight delta payloads.
- **Estimated Likes Honesty Rule:** Hidden likes on reels are explicitly flagged as `Hidden`, with statistical estimations (`estLikes`) calculated separately. Estimates never contaminate the real Likes column or exports.
- **Instant Revocation:** Revoking or disabling a user session immediately invalidates their session across all devices on their next request.

---

## Deployment
- **Docker:**
  ```bash
  docker build -t reelytic .
  docker run -p 3000:3000 --env-file .env reelytic
  ```
- **Railway / Render:** Connect your GitHub repo, set root directory `./`, add environment variables (`MONGODB_URI`, `APIFY_API_KEY`), and deploy.
- **VPS (PM2 + Nginx):** Run `npm run build`, start with `pm2 start server/index.js --name reelytic`, and configure Nginx reverse proxy to port 3000.
