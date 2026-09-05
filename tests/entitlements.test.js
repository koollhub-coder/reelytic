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
      assert.equal(
        features.creatorDatabase, tier.expect.creatorDatabase,
        `${tier.key} creatorDatabase should be ${tier.expect.creatorDatabase}`
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

describe('creator database', () => {
  // Same enforce-at-the-endpoint reasoning as shareable links/report
  // branding above: the flag drives what the UI draws, GET /creators is
  // what actually protects it from a client that ignores the flag and
  // hits the endpoint directly.
  for (const tier of TIERS) {
    const shouldAllow = tier.expect.creatorDatabase;

    test(`${tier.key}: GET /creators is ${shouldAllow ? 'allowed' : 'refused'}`, async () => {
      const res = await agents[tier.key].get('/creators');
      if (shouldAllow) {
        assert.equal(res.status, 200, `${tier.key} paid for this feature and must be able to reach it`);
      } else {
        assert.equal(res.status, 403);
        assert.equal(res.data.code, 'FEATURE_LOCKED');
      }
    });
  }

  test('a non-admin only ever sees their own account\'s creators, whatever scope it asks for', async () => {
    // pro is entitled to the feature but must never see another account's
    // rows -- ?scope=all is an admin-only escape hatch. Seeds a row owned
    // by a DIFFERENT account first: without that, an empty result set would
    // make this assertion vacuously true whether or not the leak exists.
    const { getDb } = require('../server/db');
    await getDb().collection('analyzedCreators').insertOne({
      _id: `${usernameFor('agency')}::rgr_creator_leak_check`,
      ownerUsername: usernameFor('agency'),
      username: 'rgr_creator_leak_check',
      lastAnalyzedAt: new Date(),
      firstAnalyzedAt: new Date(),
    });

    const res = await agents.pro.get('/creators?scope=all');
    assert.equal(res.status, 200);
    assert.ok(
      !res.data.creators.some((c) => c.username === 'rgr_creator_leak_check'),
      'a non-admin request with ?scope=all leaked another account\'s creator'
    );
    for (const creator of res.data.creators) {
      assert.equal(creator.ownerUsername, usernameFor('pro'), 'a non-admin request leaked another account\'s creator');
    }
  });

  test('campaignId filters to only creators whose recent jobs are tagged to that campaign', async () => {
    // The campaign filter is a two-step lookup (buildFilter in
    // creatorDb.service.js): find which jobs currently belong to the
    // campaign, then match creators whose jobIds overlaps that set. Two
    // creator fixtures -- one WITH a job in the campaign, one without --
    // so the assertion actually proves separation rather than passing
    // vacuously on an all-or-nothing result set.
    const { getDb } = require('../server/db');
    const db = getDb();

    const campaignRes = await agents.pro.post('/campaigns', { name: 'rgr_filter_campaign', avatarUrl: null });
    assert.ok(campaignRes.ok, `campaign creation should succeed, got ${campaignRes.status}`);
    const campaignId = campaignRes.data.campaign.id;

    const taggedJobId = 'rgr_job_campaign_filter';
    await db.collection('jobs').insertOne({
      _id: taggedJobId,
      ownerUsername: usernameFor('pro'),
      type: 'reel',
      status: 'done',
      fileName: 'fixture.xlsx',
      campaignId,
      counts: { total: 1, success: 1, failed: 0, creditsSpent: 1 },
      createdAt: new Date(),
      rows: [],
    });

    await db.collection('analyzedCreators').insertMany([
      {
        _id: `${usernameFor('pro')}::rgr_creator_in_campaign`,
        ownerUsername: usernameFor('pro'),
        username: 'rgr_creator_in_campaign',
        lastAnalyzedAt: new Date(),
        firstAnalyzedAt: new Date(),
        jobIds: [taggedJobId],
      },
      {
        _id: `${usernameFor('pro')}::rgr_creator_outside_campaign`,
        ownerUsername: usernameFor('pro'),
        username: 'rgr_creator_outside_campaign',
        lastAnalyzedAt: new Date(),
        firstAnalyzedAt: new Date(),
        jobIds: [],
      },
    ]);

    const res = await agents.pro.get(`/creators?campaignId=${campaignId}`);
    assert.equal(res.status, 200);
    const usernames = res.data.creators.map((c) => c.username);
    assert.ok(usernames.includes('rgr_creator_in_campaign'), 'the creator tagged to this campaign should be included');
    assert.ok(!usernames.includes('rgr_creator_outside_campaign'), 'a creator with no jobs in this campaign should be excluded');
  });

  describe('CSV export', () => {
    test('free: GET /creators/export.csv is refused', async () => {
      const res = await agents.free.get('/creators/export.csv');
      assert.equal(res.status, 403);
      assert.equal(res.data.code, 'FEATURE_LOCKED');
    });

    test('pro: GET /creators/export.csv returns a CSV with the expected header row', async () => {
      const res = await agents.pro.get('/creators/export.csv');
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/csv'), `expected a text/csv response, got ${res.headers.get('content-type')}`);
      // A CSV isn't JSON -- the test client's helper (tests/helpers/client.js)
      // falls back to { raw: text } for a non-JSON body, so this is the CSV
      // text itself, truncated.
      const body = (res.data && res.data.raw) || '';
      assert.ok(body.startsWith('"Name","Username"'), `CSV should start with the expected header row, got: ${body.slice(0, 80)}`);
    });
  });

  describe('saved filter segments', () => {
    test('create, list, and delete round-trip', async () => {
      const createRes = await agents.pro.post('/creators/segments', {
        name: 'rgr_test_segment',
        filters: { search: 'abc', followerTier: 'micro', minEr: 5, sort: 'followers', campaignId: '' },
      });
      assert.ok(createRes.ok, `segment creation should succeed, got ${createRes.status}`);
      const segmentId = createRes.data.segment.id;
      assert.equal(createRes.data.segment.filters.followerTier, 'micro', 'the filter combination should be stored as sent');

      const listRes = await agents.pro.get('/creators/segments');
      assert.ok(listRes.data.segments.some((s) => s.id === segmentId), 'the created segment should appear in the list');

      const deleteRes = await agents.pro.del(`/creators/segments/${segmentId}`);
      assert.ok(deleteRes.ok, `segment deletion should succeed, got ${deleteRes.status}`);

      const listAfter = await agents.pro.get('/creators/segments');
      assert.ok(!listAfter.data.segments.some((s) => s.id === segmentId), 'the deleted segment should no longer appear');
    });

    test('a client cannot delete another account\'s saved segment', async () => {
      const createRes = await agents.pro.post('/creators/segments', { name: 'rgr_pro_only_segment', filters: {} });
      const segmentId = createRes.data.segment.id;

      const res = await agents.agency.del(`/creators/segments/${segmentId}`);
      assert.equal(res.status, 404, 'a segment owned by a different account must not be deletable by another account');

      const stillThere = await agents.pro.get('/creators/segments');
      assert.ok(stillThere.data.segments.some((s) => s.id === segmentId), 'the segment must survive another account\'s delete attempt');

      await agents.pro.del(`/creators/segments/${segmentId}`);
    });

    test('an arbitrary filters object is not stored verbatim', async () => {
      // The route only persists the specific keys it understands (see
      // creators.routes.js POST /segments) -- proves an extra/unexpected key
      // sent by a client doesn't get replayed straight into a future query.
      const res = await agents.pro.post('/creators/segments', {
        name: 'rgr_sanitized_segment',
        filters: { search: 'x', unexpectedKey: 'should not persist', minEr: 'not-a-number' },
      });
      assert.ok(res.ok);
      assert.equal(res.data.segment.filters.unexpectedKey, undefined, 'an unrecognized filter key must not be stored');
      assert.equal(res.data.segment.filters.minEr, 0, 'a non-numeric minEr must not be stored as-is');
      await agents.pro.del(`/creators/segments/${res.data.segment.id}`);
    });
  });
});
