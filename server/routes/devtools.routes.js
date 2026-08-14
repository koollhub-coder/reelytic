const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');

/* =====================================================================
   devtools.routes.js: run the pre-deploy checks from the Health page.

   THIS ROUTER STARTS PROCESSES ON THE SERVER. That is exactly the thing
   you never want reachable from the internet, so it is fenced four ways
   and every one of them has to hold before anything runs:

     1. It is not mounted at all when NODE_ENV is production. server/index.js
        checks isAvailable() before requiring it, so on a live box these
        paths do not exist and return the normal 404.
     2. Every request re-checks NODE_ENV anyway. Belt and braces, because
        the mounting check happens once at boot and this one cannot be
        skipped by a later mistake in the wiring.
     3. Loopback only. A request arriving from anything but 127.0.0.1 / ::1
        is refused, so even a dev server left running on a shared network
        is not an open door.
     4. Admin session still required, same as the rest of /api/admin.

   The commands are a fixed table keyed by id. Nothing from the request
   ever becomes an argument, and nothing runs through a shell, so there is
   no string for anyone to inject into.

   Deliberately absent: the credit script's WRITE modes. Reading the audit
   is safe and useful from a screen; moving real balances from a web button
   is not, however local the button is. Those stay on the terminal where
   you have to type what you mean.
   ===================================================================== */

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function isAvailable() {
  return process.env.NODE_ENV !== 'production';
}

const TASKS = {
  regress: {
    label: 'Full check, free',
    description: 'Entitlements, job lifecycle and the browser smoke tests. Stubbed scrapers, throwaway database, nothing spent.',
    args: ['scripts/regress.js', '--no-spend'],
    minutes: 2,
    spends: false,
  },
  'regress-live': {
    label: 'Full check plus a real scrape',
    description: 'Everything above, then one real reel and one real profile through Apify to prove the live path still works.',
    args: ['scripts/regress.js'],
    minutes: 3,
    spends: true,
  },
  'regress-api': {
    label: 'API only, quick',
    description: 'Entitlements and job lifecycle. About thirty seconds, for when you just changed server code.',
    args: ['scripts/regress.js', 'api'],
    minutes: 1,
    spends: false,
  },
  credits: {
    label: 'Credit audit',
    description: 'Checks every run where opening and closing balances were both recorded. Read-only: it reports, it never moves credits.',
    args: ['scripts/credit-reconcile.js'],
    minutes: 1,
    spends: false,
  },
};

/*
  One run at a time, held in memory. A queue would be a nicer toy but two
  regression runs at once would fight over the same test database and both
  produce nonsense, so the honest behaviour is to refuse the second.
*/
let current = null;

function localOnly(req, res, next) {
  if (!isAvailable()) return res.status(404).json({ error: 'Not found' });
  const ip = req.ip || '';
  // Express reports IPv4 loopback as ::ffff:127.0.0.1 behind the IPv6 stack.
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!loopback) {
    return res.status(403).json({ error: 'Developer tools are available on the local machine only.' });
  }
  return next();
}

// What the Health page asks before deciding whether to render the section
// at all. On production this 404s, and the section simply never appears.
router.get('/tasks', localOnly, requireAdmin, (req, res) => {
  res.json({
    available: true,
    tasks: Object.entries(TASKS).map(([id, t]) => ({
      id, label: t.label, description: t.description, minutes: t.minutes, spends: t.spends,
    })),
    running: current ? { id: current.id, startedAt: current.startedAt } : null,
  });
});

router.post('/run/:taskId', localOnly, requireAdmin, (req, res) => {
  const task = TASKS[req.params.taskId];
  if (!task) return res.status(404).json({ error: 'No such check.' });
  if (current && current.status === 'running') {
    return res.status(409).json({ error: 'A check is already running. Wait for it to finish.' });
  }

  const runId = `${Date.now()}`;
  current = {
    runId,
    id: req.params.taskId,
    label: task.label,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    output: '',
  };

  /*
    shell:false and a fixed argv. The task id has already been matched
    against the table above, so nothing the caller sent reaches this call.
  */
  const child = spawn(process.execPath, task.args, {
    cwd: REPO_ROOT,
    shell: false,
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  const append = (buf) => {
    if (!current || current.runId !== runId) return;
    current.output += buf.toString();
    // A runaway process must not be able to eat the server's memory. The
    // tail is what matters in a test log anyway: the summary is at the end.
    if (current.output.length > 400000) {
      current.output = `[earlier output trimmed]\n${current.output.slice(-300000)}`;
    }
  };

  child.stdout.on('data', append);
  child.stderr.on('data', append);

  child.on('error', (err) => {
    if (!current || current.runId !== runId) return;
    current.status = 'done';
    current.exitCode = -1;
    current.finishedAt = new Date().toISOString();
    current.output += `\nCould not start the check: ${err.message}\n`;
  });

  child.on('close', (code) => {
    if (!current || current.runId !== runId) return;
    current.status = 'done';
    current.exitCode = code;
    current.finishedAt = new Date().toISOString();
  });

  current.child = child;
  res.json({ runId, label: task.label, startedAt: current.startedAt });
});

// Polled by the page while a check runs. `since` lets it ask only for what
// it has not already shown, so a long log is not re-sent every second.
router.get('/run', localOnly, requireAdmin, (req, res) => {
  if (!current) return res.json({ running: false, run: null });
  const since = Math.max(0, parseInt(req.query.since, 10) || 0);
  res.json({
    running: current.status === 'running',
    run: {
      runId: current.runId,
      id: current.id,
      label: current.label,
      status: current.status,
      startedAt: current.startedAt,
      finishedAt: current.finishedAt,
      exitCode: current.exitCode,
      chunk: current.output.slice(since),
      length: current.output.length,
    },
  });
});

router.post('/stop', localOnly, requireAdmin, (req, res) => {
  if (!current || current.status !== 'running' || !current.child) {
    return res.json({ stopped: false });
  }
  current.child.kill();
  current.output += '\nStopped.\n';
  res.json({ stopped: true });
});

module.exports = router;
module.exports.isAvailable = isAvailable;
