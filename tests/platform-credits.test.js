const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { seed, teardown, closeConnection } = require('./helpers/seed');
const { startServer, stopServer } = require('./helpers/server');
const { loginAs } = require('./helpers/client');
const { buildCapacity } = require('../server/services/platformCredits.service');

/*
  Nobody has an unlimited pool, admin included. An admin's credits are what
  Apify's remaining allowance can fund, worked out from two numbers and two
  costs. The arithmetic is checked here independently of the code, so a change
  to the formula cannot quietly agree with itself.
*/

describe('the calculation', () => {
  // A real account's figures: $5 allowance, $0.2568 used.
  const input = { monthlyUsd: 5, spentUsd: 0.2568, reelUsd: 0.002644, profileUsd: 0.0081, creditsPerReel: 1, creditsPerProfile: 5 };

  test('follows the steps a person would do by hand', () => {
    const c = buildCapacity(input);
    const left = 5 - 0.2568;
    assert.ok(Math.abs(c.leftUsd - left) < 1e-9);
    assert.equal(c.ifOnlyReels, Math.floor(left / 0.002644));
    assert.equal(c.ifOnlyProfiles, Math.floor(left / (0.0081 / 5)));
    // The balance is the smaller of the two, so it is covered whatever runs.
    assert.equal(c.guaranteedCredits, Math.min(c.ifOnlyReels, c.ifOnlyProfiles));
  });

  test('a profile credit is cheaper for us than a Reel credit, and the balance uses the dearer one', () => {
    const c = buildCapacity(input);
    assert.ok(c.profileUsdPerCredit < c.reelUsdPerCredit);
    assert.equal(c.dearestUsdPerCredit, c.reelUsdPerCredit);
  });

  test('is zero, never negative or infinite, when the allowance is used up', () => {
    const c = buildCapacity({ ...input, spentUsd: 9 });
    assert.equal(c.leftUsd, 0);
    assert.equal(c.guaranteedCredits, 0);
    assert.ok(Number.isFinite(c.ifOnlyReels) && Number.isFinite(c.ifOnlyProfiles));
  });

  test('a broken cost never produces Infinity or NaN', () => {
    const c = buildCapacity({ ...input, reelUsd: 0, profileUsd: 0 });
    assert.ok(Number.isFinite(c.guaranteedCredits));
  });
});

describe('what people see', () => {
  let admin;
  let client;

  before(async () => {
    await seed();
    await startServer();
    admin = await loginAs('admin');
    client = await loginAs('free');
  });

  after(async () => {
    await stopServer();
    await teardown();
    await closeConnection();
  });

  test('admin gets a real, finite balance from the allowance, not a huge placeholder', async () => {
    const me = await admin.get('/auth/me');
    const calc = await admin.get('/admin/platform-credits');
    assert.equal(calc.status, 200);
    const expected = calc.data.capacity.guaranteedCredits;
    assert.ok(Number.isInteger(expected) && expected > 0 && expected < 100000, `unexpected capacity ${expected}`);
    assert.equal(me.data.user.credits, expected);
    assert.equal(me.data.user.plan, 'admin');
  });

  test('the calculation is fully shown', async () => {
    const calc = (await admin.get('/admin/platform-credits')).data;
    assert.equal(calc.apify.monthlyUsd, 5);
    assert.equal(calc.apify.spentUsd, 0.25);
    assert.ok(calc.costs.reelUsdPerCredit > 0 && calc.costs.profileUsdPerCredit > 0);
    assert.ok(calc.capacity.ifOnlyReels > 0 && calc.capacity.ifOnlyProfiles > 0);
    assert.equal(typeof calc.heldByClients, 'number');
  });

  test('a client cannot read it, and never sees a balance of infinity', async () => {
    assert.equal((await client.get('/admin/platform-credits')).status, 403);
    const me = await client.get('/auth/me');
    assert.ok(Number.isFinite(me.data.user.credits));
  });
});
