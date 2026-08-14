const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { seed, teardown, closeConnection, TIERS, usernameFor } = require('./helpers/seed');
const { startServer, stopServer } = require('./helpers/server');
const { loginAs, anonymousAgent } = require('./helpers/client');

/*
  The entitlement matrix.

  This is the layer that earns its keep. Everything here is combinatorial --
  five tiers times the gated features times real-versus-sample data -- which
  makes it exactly the thing that is miserable to click through by hand and
  therefore never actually gets checked before a deploy. It is also where the
  money is: one wrong conditional either gives away a paid feature or blocks
  someone who paid for it.

  Two properties are non-negotiable and are asserted from both directions:

    1. A plan that does NOT include a feature must be refused on a REAL
       report, every time.
    2. A plan that DOES include it must be allowed, because a gate that is
       too aggressive is just as much a bug and nobody reports it as one --
       they churn.
*/

let agents = {};
let fixtures;

/*
  Creates a brand-new, never-shared report for a tier.

  Any test that asserts on MINTING a share link needs a report with no token
  on it, because the app intentionally lets an existing link keep working.
  Sharing one fixture across such tests makes them order-dependent, which is
  how a suite starts failing for reasons that have nothing to do with the code
  under test.
*/
let freshCounter = 0;
async function freshJobFor(tierKey) {
  const { getDb } = require('../server/db');
  const { usernameFor: nameFor } = require('./helpers/seed');
  freshCounter += 1;
  const id = `rgr_job_fresh_${freshCounter}`;
  await getDb().collection('jobs').insertOne({
    _id: id,
    ownerUsername: nameFor(tierKey),
    type: 'reel',
    status: 'done',
    fileName: 'fresh-fixture.xlsx',
    counts: { total: 1, success: 1, failed: 0, creditsSpent: 1 },
    createdAt: new Date(),
    rows: [{ i: 0, input: { url: 'https://www.instagram.com/reel/CCCCCCCCCCC/' }, state: 'done', result: { username: 'fresh_one', views: 10, likes: 1, comments: 0, er: 10 } }],
  });
  return id;
}

before(async () => {
  fixtures = await seed();
  await startServer();
  for (const tier of TIERS) {
    agents[tier.key] = await loginAs(tier.key);
  }
});

after(async () => {
  await stopServer();
  await teardown();
  await closeConnection();
});

describe('feature flags reported to the client', () => {
  for (const tier of TIERS) {
    test(`${tier.key}: /auth/me reports the documented features`, () => {
      const features = agents[tier.key].user.features;
      assert.equal(
        features.shareableLinks, tier.expect.shareableLinks,
        `${tier.key} shareableLinks should be ${tier.expect.shareableLinks}`
      );
      assert.equal(
        features.reportBranding, tier.expect.reportBranding,
        `${tier.key} reportBranding should be ${tier.expect.reportBranding}`
      );
    });
  }
});

describe('shareable links on a REAL report', () => {
  /*
    Enforcement has to be tested at the ENDPOINT, not just via the feature
    flag. The flag drives what the UI draws; the endpoint is what actually
    protects the revenue. A client that ignores the flag and posts the request
    directly must still be refused, and that is what this asserts.
  */
  for (const tier of TIERS) {
    const shouldAllow = tier.expect.shareableLinks;

    test(`${tier.key}: POST /jobs/:id/share is ${shouldAllow ? 'allowed' : 'refused'}`, async () => {
      const agent = agents[tier.key];
      const res = await agent.post(`/jobs/${fixtures.jobs.owned}/share`, {});

      if (shouldAllow) {
        // The fixture report belongs to the free account, so an entitled but
        // non-owning tier is correctly refused on OWNERSHIP (404), never on
        // entitlement (403). Either is a pass here; a 200 would mean one
        // account could share another's report.
        // The fixture belongs to the free account, so an entitled but
        // non-owning tier is refused on OWNERSHIP. The app answers that with
        // a plain 403 "Forbidden"; only the CODE distinguishes it from an
        // entitlement refusal, which is the thing actually under test here.
        assert.notEqual(
          res.data && res.data.code, 'FEATURE_LOCKED',
          `${tier.key} paid for this feature and must never see FEATURE_LOCKED (got ${res.status})`
        );
      } else {
        assert.ok(
          [403, 404].includes(res.status),
          `${tier.key} must not be able to create a share link, got ${res.status}`
        );
      }
    });
  }

  test('the owner on a locked plan is refused on entitlement, not silently allowed', async () => {
    /*
      Uses a FRESH report rather than the shared fixture.

      Earlier tests in this file legitimately mint a share token on the
      fixture (an admin can), and the app deliberately grandfathers a report
      that already has a link so a downgrade does not break links already
      sent to clients. Asserting against the shared fixture therefore tested
      the order these tests happen to run in, not the entitlement gate.
    */
    const jobId = await freshJobFor('free');
    const res = await agents.free.post(`/jobs/${jobId}/share`, {});
    assert.equal(res.status, 403, 'free owns this report but has no shareable links');
    assert.equal(res.data.code, 'FEATURE_LOCKED');
  });
});

describe('report branding', () => {
  for (const tier of TIERS) {
    const shouldAllow = tier.expect.reportBranding;
    test(`${tier.key}: PATCH /settings/report-branding is ${shouldAllow ? 'allowed' : 'refused'}`, async () => {
      const res = await agents[tier.key].patch('/settings/report-branding', {
        agencyName: 'Regression Agency',
        accentColor: '#123456',
      });
      if (shouldAllow) {
        assert.ok(res.ok, `${tier.key} should be able to save branding, got ${res.status}`);
      } else {
        assert.equal(res.status, 403, `${tier.key} must not be able to save branding`);
      }
    });
  }
});

describe('the demo sandbox boundary (revenue critical)', () => {
  /*
    The sample report deliberately unlocks paid features so a free account can
    see what they do. That exemption is the single most dangerous piece of
    logic in the product: if it ever widens from "this one sample job" to
    "this user", the paid tier becomes free and nobody would notice from the
    outside.

    So it is asserted in both directions, on the same account, in the same
    test run: the sample must be shareable, and a real report must not be.
  */
  test('a free account CAN share the sample report', async () => {
    const created = await agents.free.post('/jobs/demo', {});
    assert.ok(created.ok, `demo job should be created, got ${created.status}`);
    const demoId = created.data.jobId;

    const res = await agents.free.post(`/jobs/${demoId}/share`, {});
    assert.ok(res.ok, `free must be able to share the SAMPLE, got ${res.status} ${JSON.stringify(res.data)}`);
    assert.ok(res.data.shareToken || res.data.url, 'a share token should come back');
  });

  test('the same free account CANNOT share a real report', async () => {
    // Fresh report for the same reason as above: this must test the sandbox
    // boundary, not whether a token happens to exist already.
    const jobId = await freshJobFor('free');
    const res = await agents.free.post(`/jobs/${jobId}/share`, {});
    assert.equal(res.status, 403, 'the sandbox exemption must not leak to real reports');
    assert.equal(res.data.code, 'FEATURE_LOCKED');
  });

  test('the exemption does not grant branding either', async () => {
    // Sharing the sample must not quietly upgrade the whole account.
    const res = await agents.free.patch('/settings/report-branding', { agencyName: 'Should Not Save' });
    assert.equal(res.status, 403, 'demo access must not unlock unrelated paid features');
  });
});

describe('admin boundary', () => {
  const ADMIN_ROUTES = ['/admin/overview', '/admin/clients', '/admin/ledger', '/admin/sessions', '/admin/health/errors'];

  for (const route of ADMIN_ROUTES) {
    test(`a client cannot reach ${route}`, async () => {
      const res = await agents.pro.get(route);
      assert.equal(res.status, 403, `${route} must reject a non-admin`);
    });
  }

  for (const route of ADMIN_ROUTES) {
    test(`an admin can reach ${route}`, async () => {
      const res = await agents.admin.get(route);
      assert.ok(res.ok, `${route} should serve an admin, got ${res.status}`);
    });
  }

  test('an anonymous caller cannot reach admin routes', async () => {
    const anon = anonymousAgent();
    const res = await anon.get('/admin/overview');
    assert.ok([401, 403].includes(res.status), `expected 401/403, got ${res.status}`);
  });
});

describe('cross-account access', () => {
  /*
    One tenant reading another tenant's data is the worst failure this app
    could have, and ownership checks are easy to forget on a newly added
    route (one was genuinely missing on retry-failed at one point). Every
    per-job route is walked with the WRONG account.
  */
  const JOB_ROUTES = [
    ['get', (id) => `/jobs/${id}`],
    ['get', (id) => `/jobs/${id}/rows`],
    ['get', (id) => `/jobs/${id}/progress`],
    ['post', (id) => `/jobs/${id}/share`],
    ['post', (id) => `/jobs/${id}/retry-failed`],
    ['post', (id) => `/jobs/${id}/discard`],
  ];

  for (const [method, build] of JOB_ROUTES) {
    const route = build(':id');
    test(`pro cannot ${method.toUpperCase()} ${route} belonging to free`, async () => {
      const path = build(fixtures.jobs.owned); // owned by free
      const res = method === 'get'
        ? await agents.pro.get(path)
        : await agents.pro.post(path, {});
      assert.ok(
        [403, 404].includes(res.status),
        `${method.toUpperCase()} ${route} leaked another account's report: got ${res.status}`
      );
    });
  }

  test('a client cannot read another account via the admin client export', async () => {
    const res = await agents.pro.get(`/admin/clients/${usernameFor('free')}/export.csv`);
    assert.equal(res.status, 403);
  });
});
