/*
  The help assistant, tested without a browser, a database or any network.

  Three things are guarded here, in order of how much a failure would hurt:

  1. NOTHING CONFIDENTIAL IN THE ANSWERS. The assistant talks to customers.
     It must never mention where data comes from, what it costs us, margins
     or internal machinery. This scans every answer for that vocabulary.
  2. THE CONTENT IS SOUND. Ids are unique, every "related" points at
     something real, there are no dashes in the copy, dynamic answers do not
     throw for a free user, a paid user or a logged-out visitor.
  3. IT UNDERSTANDS PEOPLE. A table of realistic questions, each phrased
     differently from the wording in the knowledge base (otherwise this would
     only prove it can match itself), must land on the right answer.
     Below-threshold questions must fall back honestly instead of guessing.
*/

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

let K; // knowledge
let M; // matcher

before(async () => {
  const base = path.resolve(__dirname, '..', 'client', 'src');
  K = await import(pathToFileURL(path.join(base, 'content', 'helpKnowledge.js')).href);
  M = await import(pathToFileURL(path.join(base, 'utils', 'helpMatcher.js')).href);
});

const USERS = {
  free: { user: { username: 'a', name: 'Asha Rao', plan: 'free', credits: 10 }, features: {} },
  pro: {
    user: { username: 'b', name: 'Bala', plan: 'pro', credits: 4200 },
    features: { reportBranding: true, shareableLinks: true, creatorDatabase: true, teamSeats: true, clientPortal: true },
  },
  admin: { user: { username: 'c', plan: 'admin', credits: 1793, role: 'admin' }, features: {} },
  visitor: { user: null, features: {} },
};

const allText = (ctx) => {
  const chunks = [];
  for (const e of K.ENTRIES) {
    chunks.push(e.q, ...(e.variants || []));
    const a = typeof e.a === 'function' ? e.a(ctx) : e.a;
    chunks.push(a);
    for (const act of e.actions || []) chunks.push(act.label);
  }
  for (const s of K.SMALL_TALK) chunks.push(s.reply(ctx));
  return chunks.join('\n');
};

describe('help assistant: nothing confidential', () => {
  // Words that would reveal how the product works underneath, or what it
  // costs to run. Plain product words like "credit" and "plan" are fine.
  const BANNED = [
    'apify', 'actor', 'scraper', 'scraping', 'scrape', 'pipeline', 'ledger', 'margin', 'profit',
    'razorpay', 'stripe', 'openai', 'anthropic', 'claude', 'gemini', 'groq', 'mongo', 'render.com',
    'cost to us', 'our cost', 'wholesale', 'per-result', 'api key', 'endpoint', 'canary', 'express mode',
    'legacy', 'v2', 'rupee', '₹', '$', 'usd', 'inr', ' gst ',
  ];
  for (const who of Object.keys(USERS)) {
    test(`no banned vocabulary in any answer (${who})`, () => {
      const text = allText(USERS[who]).toLowerCase();
      for (const word of BANNED) {
        assert.ok(!text.includes(word), `answers must not contain "${word}"`);
      }
    });
  }

  test('no em dashes or double hyphens in the copy', () => {
    const text = allText(USERS.pro);
    assert.ok(!text.includes('—'), 'em dash found');
    assert.ok(!text.includes('--'), 'double hyphen found');
  });
});

describe('help assistant: content is sound', () => {
  test('ids are unique', () => {
    const ids = K.ENTRIES.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every related id and action route exists', () => {
    const ids = new Set(K.ENTRIES.map((e) => e.id));
    const routes = new Set(['/reels', '/profiles', '/history', '/creators', '/dashboard', '/settings', '/billing', '/pricing', '/how-it-works', '/terms', '/privacy']);
    for (const e of K.ENTRIES) {
      for (const r of e.related || []) assert.ok(ids.has(r), `${e.id} relates to missing "${r}"`);
      for (const a of e.actions || []) {
        assert.ok(routes.has(a.to) || a.to.startsWith('mailto:'), `${e.id} action goes to unknown "${a.to}"`);
      }
      assert.ok(e.q && e.a, `${e.id} needs a question and an answer`);
      assert.ok((e.variants || []).length >= 3, `${e.id} needs at least 3 variants so it can be found`);
    }
  });

  test('dynamic answers work for every kind of visitor', () => {
    for (const ctx of Object.values(USERS)) {
      for (const e of K.ENTRIES) {
        const out = M.renderAnswer(e, ctx);
        assert.equal(typeof out, 'string');
        assert.ok(out.length > 10);
        assert.ok(!/undefined|NaN|\[object/.test(out), `${e.id} rendered a broken value`);
      }
    }
  });

  test('credits answer uses the real balance', () => {
    const out = M.renderAnswer(M.getEntry('my-credits'), USERS.pro);
    assert.match(out, /4,200/);
    assert.match(M.renderAnswer(M.getEntry('my-credits'), USERS.admin), /1,793/);
    assert.ok(!/unlimited/i.test(M.renderAnswer(M.getEntry('my-credits'), USERS.admin)));
  });
});

/* One row per realistic question. `expect` is the entry id it should land on.
   None of these phrasings appear verbatim in the knowledge base. */
const CASES = [
  ['how much do i pay for one reel', 'credit-cost'],
  ['whats the price of running a profile report', 'credit-cost'],
  ['will i lose credits if links dont work', 'when-charged'],
  ['do failed ones cost me', 'when-charged'],
  ['i uploaded the wrong excel what now', 'edit-sheet'],
  ['can i add a few more links to my running campaign report', 'edit-sheet'],
  ['my list has 3000 links is that ok', 'link-limits'],
  ['what type of files can i drop in', 'file-formats'],
  ['how do i log in if i lost my password', 'forgot-password'],
  ['reset pasword', 'forgot-password'],
  ['cant sign in to my acount', 'login-problem'],
  ['why does my profile report show low reels analyzed', 'reels-analyzed'],
  ['what is the not counted column', 'not-counted'],
  ['do you include paid partnerships when averaging', 'sponsored'],
  ['are pinned reels used in the average', 'pinned'],
  ['how is engagement worked out for a single reel', 'er-reel'],
  ['er formula for profiles', 'er-profile'],
  ['is 3 percent engagement good', 'good-er'],
  ['likes are missing for some reels', 'hidden-likes'],
  ['instagram numbers are not the same as yours', 'numbers-differ'],
  ['what does couldnt fetch mean', 'couldnt-fetch'],
  ['why did some of my rows fail', 'couldnt-fetch'],
  ['it says invalid link but the link is fine', 'invalid-link'],
  ['does it work for private accounts', 'private-accounts'],
  ['everything failed nothing worked', 'all-failed'],
  ['i have no credits left', 'not-enough-credits'],
  ['ran out of credits mid report', 'not-enough-credits'],
  ['my report has been on the same number for ages', 'stuck'],
  ['can i shut my laptop while it runs', 'leave-page'],
  ['how do i stop a report and carry on later', 'pause-resume'],
  ['redo only the ones that failed', 'retry-failed'],
  ['how many credits do i have left', 'my-credits'],
  ['which plan am i on', 'my-plan'],
  ['what are your subscription tiers', 'plans'],
  ['which plan do i need for client portal', 'which-plan-has'],
  ['how do i upgrade my account', 'upgrade'],
  ['is my card information stored', 'payment'],
  ['i want my money back', 'refund'],
  ['i need a gst invoice', 'invoice-cancel'],
  ['why is there a padlock on this feature', 'locked-feature'],
  ['put my agency logo on reports', 'branding'],
  ['how can my client see the report without an account', 'share-links'],
  ['what is a portal link', 'portal'],
  ['turn off the portal link i sent', 'portal-how'],
  ['invite my colleague to my workspace', 'team'],
  ['can team members see billing', 'team-member'],
  ['how do i group reports by brand', 'campaigns'],
  ['what does paused mean in history', 'history-status'],
  ['where did my old report go', 'history-find'],
  ['remove a report i do not need', 'delete-report'],
  ['what do the dashboard tiles mean', 'dashboard'],
  ['how do creators get into my list', 'creators-what'],
  ['filter creators by follower count', 'creators-filter'],
  ['what is the green tag on creators', 'creators-er-badge'],
  ['how accurate is the gender', 'creators-gender'],
  ['keep my creator filters for later', 'creators-views'],
  ['download my creator list', 'creators-export'],
  ['do you need my instagram password', 'privacy'],
  ['is reelytic an official instagram product', 'affiliation'],
  ['how do i reach a real person', 'contact-support'],
  ['something looks broken', 'bug'],
  ['i have an idea for a new feature', 'feature-request'],
  ['is there a free trial', 'free-credits'],
  ['can i see a demo first', 'sample-tour'],
  ['reel report versus profile report', 'report-types'],
  ['can i use it on my phone', 'mobile'],
  ['can i switch to dark theme', 'dark-mode'],
  ['how long until my report is ready', 'how-long'],
  ['can i paste links rather than upload', 'paste-links'],
  ['same link twice in my sheet', 'duplicates'],
  ['can i leave a note on a creator row', 'notes-flags'],
  ['get the report as excel', 'export'],
  ['is there a pdf', 'pdf'],
  ['what is a credit', 'what-is-credit'],
  ['how do i begin', 'first-report'],
  ['what is reelytic', 'what-is'],
  ['are my results live', 'data-fresh'],
  ['which reels were used for a creators average', 'view-considered'],
  ['how do you pick which reels to average', 'profile-how'],
  ['engagement shows 0 percent', 'er-zero'],
  ['what does reset do', 'reset-report'],
  ['what happens after i upload', 'preview-screen'],
  ['verification email never came', 'verify-email'],
  ['delete my account and data', 'delete-account'],
];

describe('help assistant: understands questions phrased differently', () => {
  let right = 0;
  const misses = [];
  for (const [q, expected] of CASES) {
    test(`"${q}"`, () => {
      const r = M.ask(q, {}, USERS.pro);
      const got = r.kind === 'answer' ? r.entries[0].id
        : r.kind === 'suggest' ? `suggest:${r.suggestions.map((s) => s.id).join(',')}` : r.kind;
      const ok = got === expected || (r.kind === 'answer' && r.alternatives.some((a) => a.id === expected))
        || (r.kind === 'suggest' && r.suggestions.some((s) => s.id === expected));
      if (ok) right += 1; else misses.push(`${q}  ->  ${got}  (wanted ${expected})`);
      assert.ok(ok, `"${q}" gave ${got}, wanted ${expected}`);
    });
  }
  test('overall accuracy is high enough', () => {
    const rate = right / CASES.length;
    if (misses.length) console.log(`  accuracy ${(rate * 100).toFixed(1)}%, misses:\n   ${misses.join('\n   ')}`);
    assert.ok(rate >= 0.9, `only ${(rate * 100).toFixed(1)}% of questions matched`);
  });
});

describe('help assistant: behaves like a good assistant', () => {
  test('greetings and thanks get a friendly reply, not a search', () => {
    assert.equal(M.ask('hi', {}, USERS.free).kind, 'smalltalk');
    assert.match(M.ask('hello', {}, USERS.free).reply, /Asha/);
    assert.equal(M.ask('thanks a lot', {}, USERS.pro).kind, 'smalltalk');
    assert.equal(M.ask('are you a human', {}, USERS.pro).id, 'who');
  });

  test('"take me to" opens the right page', () => {
    assert.equal(M.ask('take me to history', {}, USERS.pro).target.to, '/history');
    assert.equal(M.ask('open creators', {}, USERS.pro).target.to, '/creators');
    assert.equal(M.ask('where is settings', {}, USERS.pro).target.to, '/settings');
    assert.equal(M.ask('go to pricing', {}, USERS.free).target.to, '/billing');
    assert.equal(M.ask('show me the dashboard', {}, USERS.pro).target.to, '/dashboard');
  });

  test('nonsense falls back honestly instead of guessing', () => {
    for (const q of ['asdfgh qwerty', 'what is the capital of france', 'xyzzy plugh', 'banana smoothie recipe']) {
      const r = M.ask(q, {}, USERS.pro);
      assert.ok(r.kind === 'fallback' || r.kind === 'suggest', `"${q}" should not be answered confidently, got ${r.kind}`);
    }
  });

  test('a two part question is answered in two parts', () => {
    const r = M.ask('how do i edit my sheet and will i be charged again', {}, USERS.pro);
    assert.equal(r.kind, 'answer');
    const ids = r.entries.map((e) => e.id);
    assert.ok(ids.includes('edit-sheet'), `expected edit-sheet in ${ids}`);
  });

  test('a follow up uses what was just discussed', () => {
    const r = M.ask('tell me more', { lastEntryId: 'edit-sheet' }, USERS.pro);
    assert.equal(r.kind, 'more');
  });

  test('yes accepts the suggestion that was offered', () => {
    const r = M.ask('yes', { pendingIds: ['portal'] }, USERS.pro);
    assert.equal(r.kind, 'answer');
    assert.equal(r.entries[0].id, 'portal');
  });

  test('typing while on a page nudges toward that page\'s topic', () => {
    const r = M.ask('filter', {}, { ...USERS.pro, route: '/creators' });
    assert.ok(r.kind === 'answer' || r.kind === 'suggest');
    if (r.kind === 'answer') assert.equal(r.entries[0].topic, 'creators');
  });

  test('empty input does nothing', () => {
    assert.equal(M.ask('   ', {}, USERS.pro).kind, 'empty');
  });
});

/* A second, messier set: the way people really type. Casual, short, missing
   words, a typo or two. Each row lists the answers that would be acceptable. */
const MESSY = [
  ['why did my link fail', ['couldnt-fetch']],
  ['link failed', ['couldnt-fetch', 'retry-failed']],
  ['some links are not working', ['couldnt-fetch']],
  ['it says invalid', ['invalid-link']],
  ['how to check how many credits i have', ['my-credits']],
  ['do i get charged if instagram returns nothing', ['when-charged']],
  ['what happens to my credits if the report fails', ['when-charged']],
  ['can i download in excel', ['export']],
  ['how to share with brand', ['share-links', 'portal']],
  ['i want to show my client the numbers without giving login', ['share-links', 'portal']],
  ['client should see live updates', ['portal']],
  ['how do i add my agency name to the report', ['branding']],
  ['add team member', ['team']],
  ['my colleague cannot see my reports', ['team', 'team-member']],
  ['is there a limit on number of links', ['link-limits']],
  ['upload csv', ['file-formats']],
  ['report is taking too long', ['how-long', 'stuck']],
  ['how long does a profile report take', ['how-long']],
  ['stop the report', ['pause-resume']],
  ['i closed my browser will the report continue', ['leave-page']],
  ['what is er', ['er-reel', 'er-profile']],
  ['how do you calculate average views', ['profile-how']],
  ['why are there only 4 reels analysed', ['reels-analyzed']],
  ['what is not counted', ['not-counted']],
  ['do you count collab posts', ['sponsored']],
  ['how do you decide outliers', ['profile-how']],
  ['what is a good engagement rate for instagram', ['good-er']],
  ['likes are hidden', ['hidden-likes']],
  ['views not matching with instagram', ['numbers-differ']],
  ['i uploaded wrong file', ['edit-sheet']],
  ['want to add few more links to existing report', ['edit-sheet']],
  ['need to remove some links', ['edit-sheet']],
  ['how to delete report', ['delete-report']],
  ['where can i see my old reports', ['history-find']],
  ['how to group by client', ['campaigns']],
  ['what is a campaign', ['campaigns']],
  ['what is the creators page', ['creators-what']],
  ['how to filter creators by er', ['creators-filter']],
  ['gender is wrong', ['creators-gender']],
  ['export all creators', ['creators-export']],
  ['i forgot my password', ['forgot-password']],
  ['change password', ['change-password']],
  ['i am not getting otp', ['verify-email']],
  ['is my data safe', ['privacy']],
  ['do you use my instagram account', ['privacy']],
  ['how to contact you', ['contact-support']],
  ['i want to talk to someone', ['contact-support']],
  ['refund please', ['refund']],
  ['how much does the pro plan cost', ['plans']],
  ['what is included in agency', ['which-plan-has']],
  ['compare plans', ['which-plan-has', 'plans']],
  ['i need more credits', ['upgrade', 'not-enough-credits']],
  ['payment failed', ['payment-issue']],
  ['credits not added after payment', ['payment-issue']],
  ['do credits expire', ['credit-expiry']],
  ['can i use it on ipad', ['mobile']],
  ['is there a tour', ['sample-tour']],
  ['how to start', ['first-report']],
  ['does it work for tiktok', ['other-platforms']],
  ['do you have an api', ['integrations']],
  ['can i schedule reports', ['scheduling']],
  ['why is my report paused', ['why-paused']],
  ['report says not started', ['history-status']],
  ['invite link expired', ['team', 'team-member']],
  ['how many seats do i get', ['team']],
  ['export to google sheets', ['integrations', 'export']],
  ['pls tell me how do i upload the excel sheet and start the report', ['first-report', 'file-formats']],
  ['whats the difference between reel and profile', ['report-types']],
  ['i cant find my report', ['history-find']],
  ['is it free', ['free-credits']],
  ['how do credits work', ['what-is-credit']],
  ['do failed links use credits', ['when-charged']],
  ['can i undo an upload', ['edit-sheet', 'delete-report']],
  ['what is the lock on branding', ['locked-feature', 'branding']],
  ['can my client login', ['portal', 'share-links']],
  ['profile report shows 0 followers', ['er-zero', 'hidden-likes', 'columns-profile', 'missing-followers']],
];

describe('help assistant: messy real-world questions', () => {
  let right = 0;
  const misses = [];
  for (const [q, okIds] of MESSY) {
    test(`"${q}"`, () => {
      const r = M.ask(q, {}, USERS.pro);
      const got = r.kind === 'answer' ? r.entries.map((e) => e.id)
        : r.kind === 'suggest' ? r.suggestions.map((s) => s.id) : [r.kind];
      const alt = r.kind === 'answer' ? r.alternatives.map((a) => a.id) : [];
      const ok = okIds.includes(got[0]) || (r.kind === 'answer' && okIds.some((id) => alt.includes(id)))
        || (r.kind === 'suggest' && okIds.some((id) => got.includes(id))) || (r.kind === 'answer' && okIds.some((id) => got.includes(id)));
      if (ok) right += 1; else misses.push(`${q}  ->  ${got.join(',')}  (wanted ${okIds.join(' or ')})`);
      assert.ok(ok, `"${q}" gave ${got.join(',')}, wanted ${okIds.join(' or ')}`);
    });
  }
  test('messy accuracy is high enough', () => {
    const rate = right / MESSY.length;
    console.log(`  messy accuracy ${(rate * 100).toFixed(1)}% (${right}/${MESSY.length})${misses.length ? `\n   ${misses.join('\n   ')}` : ''}`);
    assert.ok(rate >= 0.88, `only ${(rate * 100).toFixed(1)}% matched`);
  });
});

describe('help assistant: small talk in the wild', () => {
  test('short pleasantries are recognised', () => {
    for (const q of ['ok thanks bye', 'thank you so much', 'hlo', 'good morning', 'who made you', 'thanks']) {
      assert.equal(M.ask(q, {}, USERS.free).kind, 'smalltalk', `"${q}" should be small talk`);
    }
  });
  test('a greeting followed by a real question is answered, not treated as small talk', () => {
    const r = M.ask('hello i need help with credits', {}, USERS.free);
    assert.equal(r.kind, 'answer');
  });
});

describe('help assistant: what gets logged is masked', () => {
  const { maskText } = require('../server/routes/help.routes');
  test('emails, links and long numbers never reach the database', () => {
    const out = maskText('my email is asha@example.com and link https://instagram.com/reel/AAA phone 9876543210 ok');
    assert.ok(!/asha@|instagram|9876/.test(out), out);
    assert.match(out, /\[email\]/);
    assert.match(out, /\[link\]/);
    assert.match(out, /\[number\]/);
  });
  test('length is capped', () => {
    assert.ok(maskText('a'.repeat(1000)).length <= 200);
  });
});

describe('help assistant: PDF answer follows the account', () => {
  test('promises nothing to an account without PDF export', () => {
    const out = M.renderAnswer(M.getEntry('pdf'), USERS.pro);
    assert.match(out, /coming soon/i);
    assert.ok(!/press \*\*Download PDF/i.test(out));
  });
  test('explains how to download it for an account that has it', () => {
    const ctx = { ...USERS.pro, features: { ...USERS.pro.features, pdfExport: true } };
    assert.match(M.renderAnswer(M.getEntry('pdf'), ctx), /Download PDF/);
  });
});

/* Facts the assistant states must come from the product, not from memory. */
describe('help assistant: facts stay true', () => {
  const fs = require('fs');
  const PLANS = [
    { id: 'starter', name: 'Starter', monthly: 1499, credits: 2000, maxTeamSeats: 2, featureFlags: { creatorDatabase: true, teamSeats: true, clientPortal: true } },
    { id: 'pro', name: 'Pro', monthly: 3499, credits: 5000, maxTeamSeats: 5, featureFlags: { reportBranding: true, shareableLinks: true, creatorDatabase: true, teamSeats: true, clientPortal: true } },
  ];
  const ctx = { ...USERS.free, plans: PLANS, facts: { creditsPerReel: 2, creditsPerProfile: 9, freeCredits: 25 } };

  test('plan answers come from the live plans and never print a price', () => {
    const out = M.renderAnswer(M.getEntry('which-plan-has'), ctx);
    assert.match(out, /Starter/);
    assert.match(out, /up to 5/);
    assert.ok(!/1499|1,499|3499|3,499|₹/.test(out), 'a price leaked into the answer');
    assert.match(M.renderAnswer(M.getEntry('team'), ctx), /Starter has 2, Pro has 5/);
    assert.match(M.renderAnswer(M.getEntry('branding'), ctx), /available on Pro/);
  });

  test('credit rules and free credits come from the server values', () => {
    assert.match(M.renderAnswer(M.getEntry('credit-cost'), ctx), /2 credits per Reel/);
    assert.match(M.renderAnswer(M.getEntry('credit-cost'), ctx), /9 credits per creator/);
    assert.match(M.renderAnswer(M.getEntry('free-credits'), ctx), /25 free credits/);
  });

  test('with nothing loaded yet it still answers with sensible defaults', () => {
    assert.match(M.renderAnswer(M.getEntry('credit-cost'), USERS.visitor), /1 credit per Reel/);
    assert.ok(M.renderAnswer(M.getEntry('which-plan-has'), USERS.visitor).length > 40);
  });

  test('it does not pretend reports can be deleted', () => {
    assert.match(M.renderAnswer(M.getEntry('delete-report'), USERS.pro), /no delete button/i);
  });

  test('limits quoted in answers match the limits in the server code', () => {
    // If either limit changes in the server, this fails and reminds whoever
    // changed it to update the assistant too.
    const jobs = fs.readFileSync(path.resolve(__dirname, '..', 'server', 'routes', 'jobs.routes.js'), 'utf8');
    const upload = fs.readFileSync(path.resolve(__dirname, '..', 'server', 'routes', 'upload.routes.js'), 'utf8');
    assert.match(jobs, /validRowsCount > 2000/);
    assert.match(upload, /15 \* 1024 \* 1024/);
    const text = allText(USERS.pro);
    assert.match(text, /2,000 links/);
    assert.match(text, /15 MB/);
  });
});

/* Third set: questions typed by a real session in Chrome, none tuned for
   beforehand. These were wrong or weak on first contact and are kept so they
   stay right. */
const FIELD = [
  ['why did my link fail', ['couldnt-fetch']],
  ['what does a failed link mean', ['couldnt-fetch']],
  ['why is my profile report empty', ['empty-profile-report', 'all-failed']],
  ['how much time will 500 links take', ['how-long']],
  ['can two people use one account', ['account-sharing', 'team']],
  ['why are some creators missing followers', ['missing-followers']],
  ['how to run report for one creator', ['single-creator']],
  ['my file has 3 columns will they be kept', ['columns-kept']],
  ['how do you find gender', ['creators-gender']],
  ['is data accurate', ['numbers-differ']],
  ['report says complete but some failed', ['failed-but-complete']],
  ['is there an annual plan', ['annual-billing']],
  ['can i pay yearly', ['annual-billing']],
  ['what is lowest performer', ['highlights']],
  ['which browsers work', ['browsers']],
  ['how to log out', ['log-out']],
  ['why is my link marked duplicate', ['duplicates']],
  ['why did numbers change when i reran', ['numbers-change-rerun']],
  ['can i compare two creators', ['compare-creators']],
  ['why is creators page locked', ['locked-feature']],
  ['what is cached', ['data-fresh']],
  ['where do i see my credits', ['my-credits']],
  ['how do i fix a wrong username in my sheet', ['edit-sheet']],
  ['my credits are finished what to do', ['not-enough-credits']],
  ['how do i turn off client link', ['portal-how']],
  ['does reelytic store my instagram password', ['privacy']],
  ['can i use handles instead of urls', ['which-links']],
  ['how do i delete a campaign', ['campaigns']],
  ['why is my report stuck at 0', ['stuck']],
  ['what does not started mean', ['history-status']],
];
describe('help assistant: questions from a live session', () => {
  for (const [q, ok] of FIELD) {
    test(`"${q}"`, () => {
      const r = M.ask(q, {}, USERS.pro);
      const got = r.kind === 'answer' ? r.entries.map((e) => e.id) : [r.kind];
      assert.ok(ok.some((id) => got.includes(id)), `"${q}" gave ${got.join(',')}, wanted ${ok.join(' or ')}`);
    });
  }
});
