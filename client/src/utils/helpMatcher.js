/*
  The help assistant's understanding: turns whatever someone types into the
  best entry from helpKnowledge.js. No network, no model, no cost. It runs in
  the browser and is fast enough to run on every keystroke if it ever needs to.

  WHAT MAKES IT SMARTER THAN KEYWORD SEARCH
    1. Normalizing. "Can't", "cant" and "cannot" are the same word, and
       "log in", "sign in" and "login" are the same request.
    2. Synonym folding. "price", "cost", "fee" and "how much" all become one
       concept, so asking in different words still lands on the same answer.
    3. Typo repair. A word that is not in our vocabulary is snapped to the
       nearest word that is ("pasword" becomes "password").
    4. Weighted scoring. Rare, meaningful words ("portal", "retry") count for
       far more than everyday ones ("report", "link"), so the bot cares about
       the words that actually carry the question.
    5. Context. The page someone is on, and the answer they just read, both
       nudge the result. "And for profiles?" only makes sense after a
       previous answer.
    6. Honesty. Below a confidence line it does not guess. It offers the
       closest questions, then hands over to support.

  Deliberately no machine learning: every behavior here can be read, tested
  and explained, and it can never say something we did not write.
*/

import { ENTRIES, SMALL_TALK, NAV_TARGETS, ROUTE_TOPICS } from '../content/helpKnowledge.js';

/* ------------------------------------------------------------ thresholds */
export const CONFIDENT = 0.5;   // answer directly
export const TENTATIVE = 0.34;  // answer, but say what we think was asked
export const SUGGEST = 0.2;     // do not answer, offer the closest questions

/* -------------------------------------------------------- text preparing */
const CONTRACTIONS = [
  [/\bcan'?t\b/g, 'cannot'], [/\bwon'?t\b/g, 'will not'], [/\bdon'?t\b/g, 'do not'],
  [/\bdoesn'?t\b/g, 'does not'], [/\bdidn'?t\b/g, 'did not'], [/\bisn'?t\b/g, 'is not'],
  [/\baren'?t\b/g, 'are not'], [/\bwasn'?t\b/g, 'was not'], [/\bcouldn'?t\b/g, 'could not'],
  [/\bwouldn'?t\b/g, 'would not'], [/\bshouldn'?t\b/g, 'should not'], [/\bhaven'?t\b/g, 'have not'],
  [/\bhasn'?t\b/g, 'has not'], [/\bi'?m\b/g, 'i am'], [/\bthat'?s\b/g, 'that is'],
  [/\bwhat'?s\b/g, 'what is'], [/\bhow'?s\b/g, 'how is'], [/\bwhere'?s\b/g, 'where is'],
  [/\bit'?s\b/g, 'it is'], [/\bthere'?s\b/g, 'there is'], [/\b(\w+)'ll\b/g, '$1 will'],
  [/\b(\w+)'ve\b/g, '$1 have'], [/\b(\w+)'re\b/g, '$1 are'], [/\b(\w+)'s\b/g, '$1'],
];

// Multi-word ideas collapsed into one token before splitting into words.
const PHRASES = [
  ['log in', 'login'], ['log on', 'login'], ['sign in', 'login'], ['signin', 'login'],
  ['sign up', 'signup'], ['top up', 'buy'], ['topup', 'buy'], ['white label', 'brand'],
  ['whitelabel', 'brand'], ['paid partnership', 'sponsored'], ['branded content', 'sponsored'],
  ['money back', 'refund'], ['how much', 'price'], ['start over', 'reset'], ['not started', 'notstarted'],
  ['carry on', 'resume'], ['pick up', 'resume'], ['engagement rate', 'engagement'],
  ['credit card', 'creditcard'], ['debit card', 'creditcard'], ['net banking', 'netbanking'],
  ['out of credits', 'nocredit'], ['no credits', 'nocredit'], ['run out', 'nocredit'], ['ran out', 'nocredit'],
  ['not enough credits', 'nocredit'], ['at once', 'together'], ['per month', 'monthly'],
  ['client portal', 'portal'], ['shareable link', 'share'], ['share link', 'share'],
  ['go back', 'goback'], ['double charge', 'doublecharge'], ['charged twice', 'doublecharge'],
  ['charged again', 'doublecharge'], ['pay twice', 'doublecharge'],
];

const STOPWORDS = new Set((
  'a an the is are was were be been am do does did i me my mine we our you your it its this that these those '
  + 'to of in on at for from by with as and or but if then so than too very just can could should would will shall '
  + 'may might have has had how what why when where which who whom please tell show want wanna need get got let lets '
  + 'know like about into also any some there here them they their he she him her us kindly hi hello hey ok okay '
  + 'thanks thank really actually basically simply later mean means meaning used use using'
).split(' '));

// Different words for the same idea fold into one canonical token.
const SYNONYM_GROUPS = [
  ['credit', 'credits'],
  ['price', 'cost', 'costs', 'pricing', 'fee', 'fees', 'rate', 'rates', 'expensive', 'cheap', 'cheaper', 'cheapest', 'charges', 'amount'],
  ['charge', 'charged', 'lose', 'deduct', 'deducted', 'debit', 'debited', 'billed', 'bill', 'deduction'],
  ['fail', 'failed', 'failure', 'failing', 'fails', 'unsuccessful', 'errored', 'error', 'errors'],
  ['stuck', 'frozen', 'freeze', 'hang', 'hanging', 'hangs', 'stalled', 'stall'],
  ['delete', 'remove', 'erase', 'discard', 'clear', 'trash'],
  ['edit', 'modify', 'update', 'fix', 'correct', 'amend', 'replace', 'swap', 'alter', 'change', 'changing'],
  ['export', 'download', 'extract'],
  ['save', 'keep', 'store', 'remember', 'bookmark', 'saved'],
  ['lock', 'padlock', 'locks', 'locked', 'unlock', 'unlocked'],
  ['upload', 'import', 'attach', 'uploaded', 'uploading'],
  ['sheet', 'spreadsheet', 'worksheet'],
  ['link', 'links', 'url', 'urls', 'hyperlink', 'row', 'rows', 'entry', 'entries'],
  ['report', 'reports', 'analysis', 'analytics'],
  ['creator', 'creators', 'influencer', 'influencers', 'kol', 'kols'],
  ['team', 'teammate', 'teammates', 'colleague', 'colleagues', 'employee', 'employees', 'staff', 'coworker', 'coworkers', 'member', 'members', 'seat', 'seats', 'user', 'users'],
  ['password', 'passcode', 'pwd', 'passwords'],
  ['support', 'helpdesk', 'representative', 'agent', 'human', 'person', 'someone', 'staffer'],
  ['refund', 'reimburse', 'reimbursement', 'refunds', 'chargeback'],
  ['slow', 'slowly', 'delay', 'delayed', 'forever', 'ages', 'long', 'wait', 'waiting', 'duration', 'eta'],
  ['view', 'views', 'plays'],
  ['dark', 'night'],
  ['private'],
  ['sponsored', 'sponsor', 'sponsors', 'sponsorship', 'ad', 'ads', 'promotion', 'promoted', 'paid'],
  ['collab', 'collabs', 'collaboration', 'collaborations', 'collaborated', 'collaborative', 'joint'],
  ['average', 'avg', 'typical', 'averaged', 'averages'],
  ['zero', '0', 'blank', 'empty', 'missing', 'none', 'nothing'],
  ['free', 'complimentary', 'trial', 'freebie'],
  ['demo', 'tour', 'walkthrough', 'tutorial', 'sample', 'onboarding', 'guide', 'guided', 'example'],
  ['safe', 'secure', 'security', 'privacy', 'protected'],
  ['gender', 'male', 'female', 'sex'],
  ['filter', 'filters', 'filtering', 'narrow', 'refine', 'segment'],
  ['sort', 'order', 'rank', 'ranking'],
  ['search', 'find', 'lookup', 'locate', 'looking'],
  ['pause', 'halt', 'stop', 'hold', 'paused', 'pausing'],
  ['resume', 'continue', 'proceed', 'resuming'],
  ['duplicate', 'duplicates', 'repeat', 'repeated', 'repeats', 'repeating'],
  ['invalid', 'malformed', 'bad', 'incorrect'],
  ['brand', 'branding', 'branded', 'logo', 'logos', 'colors', 'colours', 'color', 'colour'],
  ['share', 'shareable', 'sharing', 'shared'],
  ['plan', 'plans', 'subscription', 'subscriptions', 'tier', 'tiers', 'package', 'packages'],
  ['upgrade', 'upgrading', 'upgraded'],
  ['mobile', 'phone', 'android', 'iphone', 'ipad', 'ios', 'tablet', 'smartphone'],
  ['buy', 'purchase', 'subscribe', 'recharge', 'pay', 'payment', 'paying', 'payments'],
  ['refresh', 'reload', 'realtime', 'live'],
  ['contact', 'reach', 'email', 'mail', 'call', 'phone'],
  ['begin', 'start', 'started', 'starting', 'first', 'new'],
  ['how', 'howto'],
  ['engagement', 'er', 'engaged'],
  ['follower', 'followers', 'fans', 'subscribers'],
  ['campaign', 'campaigns', 'project', 'projects', 'brief'],
  ['history', 'past', 'previous', 'old', 'earlier', 'archive'],
  ['verify', 'verification', 'confirm', 'confirmation', 'otp', 'code'],
  ['pinned', 'pin', 'pins'],
];

const CANON = new Map();
for (const group of SYNONYM_GROUPS) {
  const head = group[0];
  for (const w of group) if (!CANON.has(w)) CANON.set(w, head);
}

export function normalize(text) {
  let t = String(text || '').toLowerCase().replace(/[’‘`]/g, "'");
  for (const [re, to] of CONTRACTIONS) t = t.replace(re, to);
  t = t.replace(/\b\d{3,}\b/g, 'bignum').replace(/%/g, ' percent ').replace(/[^a-z0-9'\s]/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  for (const [from, to] of PHRASES) {
    t = t.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }
  return t;
}

// Very light stemming: enough to treat "uploading", "uploads" and "upload"
// as one word without ever mangling a short one.
function stem(w) {
  if (w.length <= 4) return w;
  if (/ies$/.test(w) && w.length > 5) return `${w.slice(0, -3)}y`;
  if (/ing$/.test(w) && w.length > 6) return w.slice(0, -3);
  if (/ed$/.test(w) && w.length > 5) return w.slice(0, -2);
  if (/(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w) && w.length > 4) return w.slice(0, -1);
  return w;
}

function canonical(w) {
  if (CANON.has(w)) return CANON.get(w);
  const s = stem(w);
  if (CANON.has(s)) return CANON.get(s);
  return s;
}

export function tokenize(text) {
  const out = [];
  for (const w of normalize(text).split(' ')) {
    if (!w || STOPWORDS.has(w)) continue;
    out.push(canonical(w));
  }
  return out;
}

/* ----------------------------------------------------------- typo repair */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j += 1) {
      const above = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + cost);
      // A swapped pair ("pasword" vs "password") counts as one slip.
      diagonal = above;
      if (prev[j] < rowMin) rowMin = prev[j];
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

/* ------------------------------------------------------------- the index */
let INDEX = null;

function buildIndex() {
  const docs = ENTRIES.map((entry) => {
    const variantSets = [entry.q, ...(entry.variants || [])].map((v) => new Set(tokenize(v)));
    const keywordTokens = new Set();
    const keywordPhrases = [];
    for (const k of entry.keywords || []) {
      const normalized = normalize(k);
      if (normalized.includes(' ')) keywordPhrases.push(normalized);
      for (const t of tokenize(k)) keywordTokens.add(t);
    }
    // The exact wording, before any word folding. When two answers fold to the
    // same words, the one that literally lists what was typed wins.
    const exact = new Set([entry.q, ...(entry.variants || [])].map((v) => normalize(v)));
    const all = new Set();
    for (const s of variantSets) for (const t of s) all.add(t);
    for (const t of keywordTokens) all.add(t);
    return { entry, variantSets, keywordTokens, keywordPhrases, all, exact };
  });

  const df = new Map();
  for (const d of docs) for (const t of d.all) df.set(t, (df.get(t) || 0) + 1);
  const n = docs.length;
  const idf = new Map();
  let maxIdf = 0;
  for (const [t, c] of df) {
    const v = Math.log(1 + n / (1 + c));
    idf.set(t, v);
    if (v > maxIdf) maxIdf = v;
  }
  const vocabByLength = new Map();
  for (const t of df.keys()) {
    if (t.length < 4) continue;
    if (!vocabByLength.has(t.length)) vocabByLength.set(t.length, []);
    vocabByLength.get(t.length).push(t);
  }
  return { docs, df, idf, maxIdf, vocabByLength, byId: new Map(ENTRIES.map((e) => [e.id, e])) };
}

const index = () => INDEX || (INDEX = buildIndex());

// Snap an unknown word to the closest word we know, if one is close enough.
function repair(token, idx) {
  if (idx.df.has(token) || token.length < 4 || /^\d+$/.test(token)) return token;
  const max = token.length >= 8 ? 2 : 1;
  let best = null;
  let bestDist = max + 1;
  let bestDf = -1;
  for (let len = token.length - max; len <= token.length + max; len += 1) {
    const bucket = idx.vocabByLength.get(len);
    if (!bucket) continue;
    for (const cand of bucket) {
      const d = editDistance(token, cand, max);
      const cdf = idx.df.get(cand);
      if (d < bestDist || (d === bestDist && cdf > bestDf)) {
        best = cand; bestDist = d; bestDf = cdf;
      }
    }
  }
  return best && bestDist <= max ? best : token;
}

/* --------------------------------------------------------------- scoring */
function scoreQuery(text, opts = {}) {
  const idx = index();
  const normalized = normalize(text);
  const rawTokens = tokenize(text).map((t) => repair(t, idx));
  const tokens = [...new Set(rawTokens)];
  if (!tokens.length) return { scored: [], tokens };

  const unknownW = idx.maxIdf * 0.45;
  const w = (t) => (idx.idf.has(t) ? idx.idf.get(t) : unknownW);
  const totalW = tokens.reduce((s, t) => s + w(t), 0);

  const scored = idx.docs.map((d) => {
    let matched = 0;
    for (const t of tokens) {
      if (d.all.has(t)) matched += w(t) * (d.keywordTokens.has(t) ? 1.3 : 1);
    }
    const coverage = Math.min(1, matched / totalW);

    let bestDice = 0;
    for (const v of d.variantSets) {
      let shared = 0;
      let vw = 0;
      for (const t of v) vw += w(t);
      for (const t of tokens) if (v.has(t)) shared += w(t);
      const dice = (2 * shared) / (totalW + vw || 1);
      if (dice > bestDice) bestDice = dice;
    }

    let bonus = 0;
    for (const p of d.keywordPhrases) if (normalized.includes(p)) { bonus = 0.1; break; }

    if (d.exact.has(normalized)) bonus += 0.2;

    let score = 0.5 * bestDice + 0.5 * coverage + bonus;
    if (opts.routeTopic && d.entry.topic === opts.routeTopic) score += 0.05;
    if (opts.lastEntry && (opts.lastEntry.related || []).includes(d.entry.id)) score += opts.followUp ? 0.12 : 0.04;
    return { entry: d.entry, score: Math.min(1.2, score) };
  });
  scored.sort((a, b) => b.score - a.score);
  return { scored, tokens };
}

/* -------------------------------------------------------------- shortcuts */
const bare = (s) => normalize(s).replace(/\b(a|an|the)\b/g, ' ').replace(/\s+/g, ' ').trim();

function isSmallTalk(normalized) {
  if (!normalized) return null;
  const target = bare(normalized);
  for (const item of SMALL_TALK) {
    for (const m of item.match) {
      if (target === bare(m)) return item;
    }
  }
  // "ok thanks bye": a few short words that all belong to small talk.
  const wordsAll = target.split(' ');
  if (wordsAll.length <= 4) {
    for (const id of ['bye', 'thanks', 'praise', 'greet', 'ok']) {
      const item = SMALL_TALK.find((s) => s.id === id);
      const vocab = new Set(item.match.flatMap((m) => bare(m).split(' ')));
      if (wordsAll.every((w) => vocab.has(w) || ['ok', 'okay', 'thanks', 'thank', 'you', 'bye', 'so', 'much', 'a', 'lot'].includes(w)) && wordsAll.some((w) => vocab.has(w))) return item;
    }
  }
  // "hi there", "hello team": a greeting with a couple of extra words.
  const words = normalized.split(' ');
  if (words.length <= 3) {
    const greet = SMALL_TALK.find((s) => s.id === 'greet');
    if (greet && greet.match.some((m) => normalize(m) === words[0])) return greet;
  }
  return null;
}

const NAV_VERBS = /^(?:please |pls )?(?:can you |could you )?(?:go to|goto|take me to|take me|open|show me|show|navigate to|bring me to|i want to go to|i want to see|visit|switch to|where is|where are|where can i find|where do i find|link to|send me to)\b/;

function findNavTarget(normalized) {
  if (!NAV_VERBS.test(normalized)) return null;
  const rest = normalized.replace(NAV_VERBS, '').trim();
  if (!rest) return null;
  let best = null;
  let bestLen = 0;
  for (const target of NAV_TARGETS) {
    for (const word of target.words) {
      const nw = normalize(word);
      if (new RegExp(`\\b${nw}\\b`).test(rest) && nw.length > bestLen) {
        best = target; bestLen = nw.length;
      }
    }
  }
  return best;
}

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'correct', 'right', 'exactly', 'that one', 'sure', 'yes please', 'that is right', 'thats right']);
const NO = new Set(['no', 'nope', 'nah', 'not that', 'wrong', 'that is not it', 'no not that']);
const MORE = /^(?:tell me more|more|more details|more info|explain|explain more|elaborate|go on|and|what else|anything else|details|why)$/;
const FOLLOW_UP = /^(?:and |what about |how about |also |then |what if )/;

/* ------------------------------------------------------------- public API */
/*
  state: { lastEntryId, pendingIds }   what happened on the previous turn
  ctx:   { user, features, route }     who is asking, and from where

  Returns { kind, ... } where kind is one of:
    'smalltalk'  { reply, id }
    'nav'        { target }
    'answer'     { entries: [entry], tentative, alternatives }
    'suggest'    { suggestions: [entry] }
    'fallback'   {}
    'more'       { entry }
*/
export function ask(text, state = {}, ctx = {}) {
  const idx = index();
  const normalized = normalize(text);
  if (!normalized) return { kind: 'empty' };

  if (state.pendingIds && state.pendingIds.length) {
    if (YES.has(normalized)) {
      const e = idx.byId.get(state.pendingIds[0]);
      if (e) return { kind: 'answer', entries: [e], tentative: false, alternatives: [] };
    }
    if (NO.has(normalized)) return { kind: 'fallback', declined: true };
  }

  const talk = isSmallTalk(normalized);
  if (talk) return { kind: 'smalltalk', id: talk.id, reply: talk.reply(ctx) };

  const target = findNavTarget(normalized);
  if (target) return { kind: 'nav', target };

  const lastEntry = state.lastEntryId ? idx.byId.get(state.lastEntryId) : null;
  if (lastEntry && MORE.test(normalized)) return { kind: 'more', entry: lastEntry };

  const routeTopic = ROUTE_TOPICS[ctx.route] || null;
  const followUp = !!lastEntry && (FOLLOW_UP.test(normalized) || tokenize(normalized).length <= 2);
  const { scored } = scoreQuery(text, { routeTopic, lastEntry, followUp });
  const top = scored[0];

  if (!top || top.score < SUGGEST) return { kind: 'fallback' };

  // A question with two parts ("how do I edit a sheet and will I be charged")
  // gets both answers, provided each part stands on its own.
  if (top.score < 0.85) {
    const parts = String(text).split(/\?|\band\b|\balso\b|\bplus\b|;/i).map((p) => p.trim()).filter((p) => tokenize(p).length >= 2);
    if (parts.length >= 2) {
      const found = [];
      for (const part of parts.slice(0, 3)) {
        const r = scoreQuery(part, { routeTopic });
        const best = r.scored[0];
        if (best && best.score >= CONFIDENT && !found.some((f) => f.id === best.entry.id)) found.push(best.entry);
      }
      if (found.length >= 2) return { kind: 'answer', entries: found.slice(0, 2), tentative: false, alternatives: [] };
    }
  }

  if (top.score >= CONFIDENT) {
    const second = scored[1];
    const alternatives = second && second.score >= TENTATIVE && top.score - second.score < 0.08 ? [second.entry] : [];
    return { kind: 'answer', entries: [top.entry], tentative: false, alternatives, score: top.score };
  }
  if (top.score >= TENTATIVE) {
    return { kind: 'answer', entries: [top.entry], tentative: true, alternatives: scored.slice(1, 3).filter((s) => s.score >= SUGGEST).map((s) => s.entry), score: top.score };
  }
  return { kind: 'suggest', suggestions: scored.slice(0, 3).filter((s) => s.score >= SUGGEST).map((s) => s.entry), score: top.score };
}

// Used by the UI to turn an entry's answer into text for this person.
export function renderAnswer(entry, ctx = {}) {
  return typeof entry.a === 'function' ? entry.a(ctx) : entry.a;
}

export function getEntry(id) {
  return index().byId.get(id) || null;
}

// For "start with these" chips and the empty state.
export function starterEntries() {
  return ['first-report', 'credit-cost', 'report-types', 'edit-sheet', 'which-plan-has'].map(getEntry).filter(Boolean);
}
