/*
  Editing a report's sheet after it was uploaded.

  THE PROBLEM THIS SOLVES.
  Someone uploads the wrong file, or forgets a batch of links, and until now
  the only way out was to discard the report and start again, re-running (and
  re-paying for) everything that had already finished. This lets them upload a
  corrected sheet, or add more links, and carry on from where the report was.

  HOW A CHANGE IS APPLIED.
  Rows are matched on their normalized URL, the same key the ledger uses for
  its one-charge-per-link guarantee:
    - a link that already finished keeps its result and is never scraped or
      charged again;
    - a link that failed last time is queued for another try;
    - a link that is new is queued to run;
    - in replace mode, a link that is not in the new sheet is removed.
  The report is then left PAUSED at the first row still to run (or DONE if
  nothing is left). It is never started here: starting spends credits, and
  that stays an explicit click, same as it always was.

  WHY THIS FILE DOES NOT TOUCH BILLING.
  Nothing here charges, refunds or writes to the ledger. Charging still
  happens only in jobEngine.service.js when a row succeeds, gated by the
  unique index on (jobId, url). Keeping finished rows in place is what makes
  a resumed report cheap and safe: the engine already walks past 'done' rows
  without re-scraping them (see processReelBatch / processProfileBatch).

  planSheetEdit is a pure function so the rules can be tested without a
  database; applySheetEdit is the thin part that writes the result.
*/

const { getDb, queryId } = require('../db');
const { isJobBusy } = require('./jobEngine.service');

const MODES = ['replace', 'add'];

const isRunnable = (state) => state !== 'invalid' && state !== 'duplicate' && state !== 'skipped';

function planSheetEdit(job, parsed, { mode = 'replace', fileName = null } = {}) {
  const oldRows = job.rows || [];
  const started = job.status !== 'preview';

  // Only finished or failed rows carry anything worth keeping; a row that was
  // still waiting has no result, so re-reading it from the new sheet loses
  // nothing.
  const oldByUrl = new Map();
  for (const r of oldRows) {
    if (r.input && r.input.url && (r.state === 'done' || r.state === 'failed') && !oldByUrl.has(r.input.url)) {
      oldByUrl.set(r.input.url, r);
    }
  }

  const summary = { kept: 0, added: 0, retry: 0, removed: 0, removedWithResults: 0, invalid: 0, duplicates: 0, alreadyInReport: 0 };
  let rows;

  if (mode === 'add') {
    const known = new Set(oldRows.filter((r) => r.input && r.input.url).map((r) => r.input.url));
    rows = oldRows.slice();
    let n = oldRows.length;
    for (const pr of parsed.rows) {
      n += 1;
      if (pr.state === 'invalid') { rows.push({ ...pr, i: n }); summary.invalid += 1; continue; }
      if (pr.state === 'duplicate') { rows.push({ ...pr, i: n }); summary.duplicates += 1; continue; }
      if (known.has(pr.input.url)) {
        // Kept as a visible row rather than silently dropped, so nobody
        // wonders where a link they added went.
        rows.push({ ...pr, i: n, state: 'duplicate', error: 'Already in this report' });
        summary.alreadyInReport += 1;
        continue;
      }
      known.add(pr.input.url);
      rows.push({ ...pr, i: n });
      summary.added += 1;
    }
    summary.kept = oldRows.filter((r) => r.state === 'done').length;
  } else {
    const newUrls = new Set(parsed.rows.filter((r) => r.state === 'pending').map((r) => r.input.url));
    rows = parsed.rows.map((pr, idx) => {
      const base = { ...pr, i: idx + 1 };
      if (pr.state === 'invalid') { summary.invalid += 1; return base; }
      if (pr.state === 'duplicate') { summary.duplicates += 1; return base; }
      const old = oldByUrl.get(pr.input.url);
      if (old && old.state === 'done') {
        summary.kept += 1;
        return { ...base, state: 'done', error: null, result: old.result, fromCache: old.fromCache, flag: old.flag, note: old.note };
      }
      if (old && old.state === 'failed') { summary.retry += 1; return base; }
      summary.added += 1;
      return base;
    });
    for (const r of oldRows) {
      if (!r.input || !isRunnable(r.state) || newUrls.has(r.input.url)) continue;
      summary.removed += 1;
      if (r.state === 'done') summary.removedWithResults += 1;
    }
  }

  // A duplicate row shows a free copy of the result it duplicates (the engine
  // fills that in as it walks past). Rows the engine will not walk again, the
  // ones before the resume point, need it filled in here or they would show
  // up empty.
  const resultByUrl = new Map(rows.filter((r) => r.state === 'done' && r.result).map((r) => [r.input.url, r.result]));
  rows = rows.map((r) => (r.state === 'duplicate' && !r.result && resultByUrl.has(r.input.url)
    ? { ...r, result: resultByUrl.get(r.input.url), fromCache: true }
    : r));

  const firstPending = rows.findIndex((r) => r.state === 'pending');
  const toRun = rows.filter((r) => r.state === 'pending').length;
  const count = (state) => rows.filter((r) => r.state === state).length;

  // A report that never started is simply a fresh preview of the new rows.
  // One that did resumes at its first unfinished row. `processed` is that
  // position, because the engine re-walks finished rows after it and counts
  // them again as it passes (see the 'already-done' branch of processJobLoop).
  const cursor = !started ? 0 : (firstPending === -1 ? rows.length : firstPending);
  const counts = {
    ...(job.counts || {}),
    total: rows.length,
    processed: !started ? 0 : cursor,
    success: count('done'),
    failed: 0,
    skipped: count('skipped'),
    valid: rows.filter((r) => isRunnable(r.state)).length,
    invalid: count('invalid'),
    duplicates: count('duplicate'),
    creditsSpent: (job.counts && job.counts.creditsSpent) || 0,
  };

  const update = { rows, counts, cursor, updatedAt: new Date() };
  if (started) {
    if (firstPending === -1) {
      update.status = 'done';
      update.finishedAt = job.finishedAt || new Date();
      update.pausedReason = null;
    } else {
      update.status = 'paused';
      update.pausedReason = 'sheet-updated';
      update.finishedAt = null;
    }
  }
  if (mode === 'replace') {
    update.originalColumns = parsed.originalColumns;
    if (fileName) update.fileName = fileName;
  }

  return { update, summary: { ...summary, toRun, total: rows.length, started }, status: update.status || job.status };
}

// Refuses anything that could race the engine, then writes the plan.
async function applySheetEdit(jobId, plan) {
  const db = getDb();
  await db.collection('jobs').updateOne({ _id: queryId(jobId) }, { $set: plan.update });
}

// Why a report cannot be edited right now, or null when it can.
function editBlocker(job) {
  if (job.isDemo) return { code: 'DEMO_JOB', error: 'The sample report cannot be edited. Start a new report with your own links.' };
  if (job.status === 'running') return { code: 'JOB_RUNNING', error: 'Pause the report first, then edit the sheet.' };
  if (isJobBusy(job._id)) return { code: 'JOB_BUSY', error: 'The report is still finishing its current batch. Give it a few seconds and try again.' };
  return null;
}

module.exports = { planSheetEdit, applySheetEdit, editBlocker, MODES };
