#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { connectDb, getDb, isUsingFallback, closeDb } = require('../server/db');
const config = require('../server/config');

/* =====================================================================
   credit-reconcile.js: what the old credit race left behind.

   THE BUG. adjustCredits used to read the balance, add the delta in Node,
   and write the result back. The job engine charges one item at a time and
   does not await each charge, so a run with N successes had N of those
   read-modify-write cycles overlapping. They all read the same starting
   balance and wrote their own total over each other, so most of the charges
   in a batch were simply lost. Fixed in 6d6b089 by doing the arithmetic
   inside the update as an aggregation pipeline.

   WHAT THAT MEANS FOR THE DATA. Three figures are recorded independently
   per run: creditsBefore (a real balance read at start), creditsSpent (an
   in-process counter, one increment per successful item) and creditsAfter
   (a real balance read at the end). The race never touched the counter, so
   creditsSpent is the truth about what a client consumed. What it corrupted
   was the balance itself, which fell by less than it should have.

   So an affected run reads: after > before - spent. The client kept credits
   the run counted as used. They were UNDERCHARGED, and the credit audit
   shows the gap as "off by N".

   This script does not decide what to do about that. By default it only
   reports, because the remedy is a business call and not an arithmetic one:
   writing the drift off costs you the credits, collecting it takes credits
   back from paying clients for a fault that was ours. Both are implemented,
   neither runs without being asked for by name.
   ===================================================================== */

const MODES = ['report', 'writeoff', 'collect'];
const args = process.argv.slice(2);
const applyArg = args.find((a) => a.startsWith('--apply'));
const mode = applyArg ? (applyArg.split('=')[1] || '') : 'report';
const userFilter = (args.find((a) => a.startsWith('--user=')) || '').split('=')[1] || null;

// A marker on every row this script has already explained, so a second run
// is a no-op rather than a second deduction.
const REASON = 'known-credit-race-2026-08';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function main() {
  if (!MODES.includes(mode)) {
    fail(`Unknown mode "${mode}". Use --apply=writeoff or --apply=collect, or pass nothing to only report.`);
    return;
  }

  await connectDb();

  /*
    The fallback is a local JSON file, not the real database. A reconciliation
    run against it would report confidently on the wrong data, and in collect
    mode would move credits in a store nothing else reads. Refusing is the
    only safe answer.
  */
  if (isUsingFallback()) {
    fail('The database connection fell back to the local JSON store, so this would report on the wrong data. Refusing to run.');
    return;
  }

  const db = getDb();
  console.log(`Database: ${config.dbName}`);
  console.log(`Mode:     ${mode}${mode === 'report' ? ' (read-only)' : '  *** THIS WILL WRITE ***'}\n`);

  const filter = {
    creditsBefore: { $ne: null },
    creditsAfter: { $ne: null },
  };
  if (userFilter) filter.ownerUsername = userFilter;

  const jobs = await db.collection('jobs').find(filter, {
    projection: {
      ownerUsername: 1, type: 1, counts: 1, startedAt: 1, createdAt: 1,
      creditsBefore: 1, creditsAfter: 1, creditDriftReason: 1, fileName: 1,
    },
  }).toArray();

  const byUser = new Map();
  let checkable = 0;
  let alreadyExplained = 0;

  for (const j of jobs) {
    if (j.creditsBefore == null || j.creditsAfter == null) continue;
    checkable += 1;
    const spent = (j.counts && j.counts.creditsSpent) || 0;
    const expected = j.creditsBefore - spent;
    const drift = j.creditsAfter - expected;
    if (drift === 0) continue;
    if (j.creditDriftReason === REASON) { alreadyExplained += 1; continue; }

    const name = j.ownerUsername || '(no owner)';
    if (!byUser.has(name)) {
      byUser.set(name, { runs: [], under: 0, over: 0, netDrift: 0 });
    }
    const bucket = byUser.get(name);
    bucket.runs.push({
      id: j._id,
      at: j.startedAt || j.createdAt,
      type: j.type,
      before: j.creditsBefore,
      spent,
      after: j.creditsAfter,
      drift,
    });
    bucket.netDrift += drift;
    if (drift > 0) bucket.under += drift; else bucket.over += -drift;
  }

  if (byUser.size === 0) {
    console.log(`${checkable} runs have both balances recorded and every one of them balances.`);
    if (alreadyExplained) console.log(`(${alreadyExplained} were already marked as explained by a previous run.)`);
    await closeDb();
    return;
  }

  let totalUnder = 0;
  let totalOver = 0;
  const affectedJobIds = [];

  console.log(`${checkable} runs checkable, ${[...byUser.values()].reduce((n, b) => n + b.runs.length, 0)} do not balance.\n`);

  for (const [name, bucket] of [...byUser.entries()].sort((a, b) => b[1].netDrift - a[1].netDrift)) {
    const user = await db.collection('users').findOne({ username: name }, { projection: { credits: 1, plan: 1 } });
    const balance = user ? (user.credits || 0) : null;
    totalUnder += bucket.under;
    totalOver += bucket.over;

    console.log(`  ${name}  (plan ${user ? user.plan : '?'}, balance now ${balance == null ? '?' : balance.toLocaleString()})`);
    console.log(`    ${bucket.runs.length} run(s) off. Undercharged ${bucket.under}, overcharged ${bucket.over}, net ${bucket.netDrift > 0 ? '+' : ''}${bucket.netDrift}`);

    for (const r of bucket.runs) {
      affectedJobIds.push(r.id);
      const when = r.at ? new Date(r.at).toISOString().slice(0, 10) : 'unknown date';
      const dir = r.drift > 0 ? 'undercharged' : 'overcharged';
      console.log(`      ${when}  ${String(r.type).padEnd(7)}  ${r.before} - ${r.spent} = ${r.before - r.spent}, actually ${r.after}  (${dir} by ${Math.abs(r.drift)})`);
    }

    if (mode === 'collect' && bucket.netDrift > 0 && balance != null && balance < bucket.netDrift) {
      console.log(`    NOTE: collecting ${bucket.netDrift} would take them below zero (they hold ${balance}). It will stop at zero.`);
    }
    console.log('');
  }

  console.log(`Totals: undercharged ${totalUnder} credits, overcharged ${totalOver} credits.`);
  console.log(`Net, undercharged by ${totalUnder - totalOver} credits across ${byUser.size} account(s).\n`);

  if (mode === 'report') {
    console.log('Nothing was changed. To act on this, re-run with one of:');
    console.log('  --apply=writeoff   mark these runs as explained by the known bug. Balances untouched,');
    console.log('                     the audit page stops flagging them, clients keep the credits.');
    console.log('  --apply=collect    the above, AND deduct the net drift from each balance, which takes');
    console.log('                     credits back from clients for a fault that was ours.');
    await closeDb();
    return;
  }

  /*
    Both write modes mark the runs. Marking is what stops the audit page
    reporting a fixed bug as an open mismatch forever, and it is also what
    makes a second run idempotent -- without it, --apply=collect twice would
    charge the same drift twice.
  */
  const marked = await db.collection('jobs').updateMany(
    { _id: { $in: affectedJobIds } },
    { $set: { creditDriftReason: REASON, creditDriftMarkedAt: new Date() } }
  );
  console.log(`Marked ${marked.modifiedCount} run(s) as explained by the known race.`);

  if (mode === 'collect') {
    for (const [name, bucket] of byUser.entries()) {
      if (bucket.netDrift <= 0) continue;
      const prior = await db.collection('users').findOne({ username: name }, { projection: { credits: 1 } });
      const before = prior ? (prior.credits || 0) : null;
      const res = await db.collection('users').findOneAndUpdate(
        { username: name },
        [{ $set: { credits: { $max: [0, { $subtract: [{ $ifNull: ['$credits', 0] }, bucket.netDrift] }] } } }],
        { returnDocument: 'after', projection: { credits: 1 } }
      );
      const doc = res && (res.value !== undefined ? res.value : res);
      const now = doc ? doc.credits : null;
      /*
        What was owed and what was actually taken are two different numbers
        whenever the balance floors at zero, and recording the intent as
        though it were the movement would put a figure in the audit trail
        that never happened. Both are kept.
      */
      const applied = (before != null && now != null) ? (before - now) : null;
      const shortfall = applied != null ? bucket.netDrift - applied : null;

      // An explicit, readable trail. Nothing else in the app writes here, so
      // a row in this collection always means a human ran this script.
      await db.collection('creditAdjustments').insertOne({
        username: name,
        owed: bucket.netDrift,
        delta: applied != null ? -applied : null,
        balanceBefore: before,
        balanceAfter: now,
        // Non-zero only where the balance ran out before the drift did.
        uncollected: shortfall,
        reason: REASON,
        note: 'Credits consumed but never deducted, because of the pre-6d6b089 lost-update race.',
        at: new Date(),
      });
      console.log(shortfall
        ? `  ${name}: -${applied} credits, now holds ${now}. ${shortfall} of the ${bucket.netDrift} owed could not be taken.`
        : `  ${name}: -${applied} credits, now holds ${now}`);
    }
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error('Reconcile crashed:', err.message);
  process.exitCode = 1;
  try { await closeDb(); } catch (e) { /* already gone */ }
});
