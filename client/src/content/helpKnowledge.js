/*
  The help assistant's whole brain: what it knows, and nothing else.

  Nothing here is generated. Every answer is written by us, so the assistant
  can never invent a policy, a price or a promise. When a question is not
  covered, the assistant says so and hands over to support, and that question
  is logged so a new answer can be added here.

  WHAT MUST NEVER APPEAR IN THIS FILE: anything about how we fetch the data,
  who supplies it, what it costs us, margins, or internal pipelines. Only what
  the product does. tests/helpbot.test.js scans this file for that vocabulary
  and fails the regression run if any of it slips in. Rupee and dollar
  amounts are out too: prices live on the Pricing page and change there.

  ANSWER FORMAT (rendered by HelpBot.jsx, no HTML):
    blank line   new paragraph
    "- text"     bullet
    **text**     bold
  An answer is a string, or a function of the person's context so it can say
  "you have 412 credits" instead of "check your balance".

  ENTRY SHAPE
    id         stable id, also used by "related" and by the feedback log
    topic      one of TOPICS
    q          the question as a person would ask it (shown in suggestions)
    variants   other ways to ask it. The more real phrasings, the smarter the
               matcher, so add generously.
    keywords   single words or short phrases that strongly signal this entry
    a          the answer
    actions    buttons under the answer: { label, to } inside the app
    related    ids offered as "You might also ask"
    signedIn   true when it only makes sense for a logged-in person
*/

export const SUPPORT_EMAIL = 'support@reelytic.com';

export const TOPICS = [
  { id: 'start', label: 'Getting started' },
  { id: 'reports', label: 'Running reports' },
  { id: 'numbers', label: 'Understanding numbers' },
  { id: 'problems', label: 'Something went wrong' },
  { id: 'credits', label: 'Credits and plans' },
  { id: 'premium', label: 'Premium features' },
  { id: 'organize', label: 'History and campaigns' },
  { id: 'creators', label: 'Creator database' },
  { id: 'account', label: 'Account and privacy' },
  { id: 'support', label: 'Talk to us' },
];

// What each page is about, so an answer given while someone is on the
// Creators page can lean toward creator questions.
export const ROUTE_TOPICS = {
  '/reels': 'reports',
  '/profiles': 'reports',
  '/history': 'organize',
  '/creators': 'creators',
  '/dashboard': 'organize',
  '/settings': 'account',
  '/billing': 'credits',
  '/pricing': 'credits',
  '/checkout': 'credits',
  '/how-it-works': 'numbers',
};

// Where "take me to..." goes. `words` are what people call the page.
export const NAV_TARGETS = [
  { to: '/reels', label: 'Reel report', words: ['reel report', 'reels', 'reel', 'new reel report', 'reel reports'] },
  { to: '/profiles', label: 'Profile report', words: ['profile report', 'profiles', 'profile', 'new profile report', 'profile reports'] },
  { to: '/history', label: 'History', words: ['history', 'past reports', 'old reports', 'my reports', 'reports list', 'campaigns', 'campaign'] },
  { to: '/creators', label: 'Creator database', words: ['creators', 'creator database', 'creator list', 'creator db', 'influencers'] },
  { to: '/dashboard', label: 'Dashboard', words: ['dashboard', 'home', 'overview', 'stats'] },
  { to: '/settings', label: 'Settings', words: ['settings', 'workspace settings', 'account settings', 'profile settings', 'branding', 'team', 'password', 'tour'] },
  { to: '/billing', label: 'Pricing and plans', words: ['pricing', 'plans', 'billing', 'upgrade', 'pricing and plans', 'subscription'] },
  { to: '/how-it-works', label: 'How is this calculated', words: ['how is this calculated', 'calculation', 'calculations', 'methodology', 'formula', 'formulas'] },
];

const has = (ctx, key) => !!(ctx && ctx.features && ctx.features[key]);
const planName = (ctx) => {
  const p = ctx && ctx.user && ctx.user.plan;
  if (!p || p === 'free') return 'Free';
  if (p === 'admin') return 'Admin';
  return p.charAt(0).toUpperCase() + p.slice(1);
};
/*
  Plan facts come from the live plan list (ctx.plans, fetched from the public
  Pricing endpoint by HelpBot), not from anything typed here. Plans are edited
  in the admin Pricing Editor, so a hard-coded "Starter has 2 seats" would
  quietly go stale. Only names, credits, seats and feature flags are used.
  Prices are deliberately never read.
*/
const FEATURE_LABELS = {
  reportBranding: 'custom-branded reports',
  shareableLinks: 'shareable links',
  creatorDatabase: 'the creator database',
  teamSeats: 'team seats',
  clientPortal: 'client portals',
};
// Live numbers from the server (see GET /api/help/facts), with today's values
// as the fallback so an answer never reads "undefined".
const fact = (ctx, key, fallback) => (ctx && ctx.facts && ctx.facts[key] != null ? ctx.facts[key] : fallback);
const paidPlans = (ctx) => ((ctx && ctx.plans) || []).filter((p) => p && p.name);
const joinNames = (names) => {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};
const planNames = (ctx) => {
  const names = paidPlans(ctx).map((p) => `**${p.name}**`);
  return names.length ? joinNames(names) : 'paid plans';
};
const plansWith = (ctx, key) => {
  const names = paidPlans(ctx).filter((p) => p.featureFlags && p.featureFlags[key] === true).map((p) => p.name);
  return names.length ? joinNames(names) : null;
};
const planFeatureLines = (ctx) => paidPlans(ctx).map((p) => {
  const feats = Object.keys(FEATURE_LABELS)
    .filter((k) => p.featureFlags && p.featureFlags[k] === true)
    .map((k) => (k === 'teamSeats' && p.maxTeamSeats ? `team seats (up to ${p.maxTeamSeats})` : FEATURE_LABELS[k]));
  const credits = p.credits ? `${Number(p.credits).toLocaleString()} credits a month` : null;
  return `**${p.name}**: ${[credits, ...feats].filter(Boolean).join(', ')}`;
});
const seatLine = (ctx) => {
  const withSeats = paidPlans(ctx).filter((p) => p.maxTeamSeats);
  if (!withSeats.length) return 'How many seats you get depends on your plan, and the count includes you.';
  return `Seats include you. ${withSeats.map((p) => `${p.name} has ${p.maxTeamSeats}`).join(', ')}.`;
};
const featureLine = (ctx, key, what, fallbackPlans) => (
  has(ctx, key)
    ? `${what}: **included** on your plan.`
    : `${what}: available on ${plansWith(ctx, key) || fallbackPlans}. It shows as locked on your plan, and you can open it any time to see what it does.`
);

export const ENTRIES = [
  /* ---------------------------------------------------------------- start */
  {
    id: 'what-is',
    topic: 'start',
    q: 'What is Reelytic?',
    variants: ['what does reelytic do', 'what is this tool', 'tell me about reelytic', 'what can i do here', 'what are the features', 'what do you offer', 'explain the product', 'why should i use this', 'overview of features', 'what does this app do'],
    keywords: ['what is', 'features', 'overview', 'about', 'offer', 'capabilities'],
    a: 'Reelytic turns a sheet of Instagram links into a report you can hand straight to a client.\n\n- **Reel reports**: views, likes, comments, shares, saves and engagement rate for every Reel link you give us.\n- **Profile reports**: a fair "typical performance" number for each creator, so one viral post cannot fool you.\n- **Client-ready output**: Excel, CSV, your own branding and shareable links on paid plans.\n- **Creator database**: every creator you analyze is saved and searchable.\n- **Campaigns, team seats and client portals** to keep the whole agency organized.\n\nAsk me about any of these, or try a topic below.',
    actions: [{ label: 'Start a Reel report', to: '/reels' }, { label: 'See the plans', to: '/billing' }],
    related: ['first-report', 'report-types', 'plans'],
  },
  {
    id: 'first-report',
    topic: 'start',
    q: 'How do I run my first report?',
    variants: ['how to upload profile links', 'how do i upload creator links', 'how do i start', 'how to use reelytic', 'how do i get started', 'how do i create a report', 'how to make a report', 'steps to generate a report', 'how does it work', 'where do i begin', 'i am new what do i do', 'how do i upload links', 'new report'],
    keywords: ['start', 'first', 'begin', 'create', 'new report', 'how to use', 'get started', 'generate'],
    a: 'Three steps:\n\n- **1. Add your links.** Open Reel Report or Profile Report, then upload an Excel, CSV or TXT file, or paste the links straight in.\n- **2. Check the preview.** You will see every link, how many are valid, and how many credits the run will use. Nothing is charged yet.\n- **3. Press Start.** The report fills in live. When it is done, download it or share it.\n\nTip: a Reel report wants links to individual Reels. A Profile report wants links to creator accounts.',
    actions: [{ label: 'New Reel report', to: '/reels' }, { label: 'New Profile report', to: '/profiles' }],
    related: ['report-types', 'file-formats', 'preview-screen'],
  },
  {
    id: 'free-credits',
    topic: 'start',
    q: 'What do I get on the free plan?',
    variants: ['is there a free trial', 'is reelytic free', 'free credits', 'can i try it for free', 'do i need a credit card', 'how many free credits', 'free account', 'free version', 'what is free', 'free tier', 'is it free'],
    keywords: ['free', 'trial', 'try', 'credit card', 'free plan'],
    a: (ctx) => `Yes. A new account starts with **${fact(ctx, 'freeCredits', 10)} free credits** and no card is needed, so you can run a real report before deciding anything.\n\nThere is also a sample report with a guided tour, which is a safe way to look around without using credits.`,
    actions: [{ label: 'Open Settings to start the tour', to: '/settings' }, { label: 'See the plans', to: '/billing' }],
    related: ['sample-tour', 'credit-cost', 'plans'],
  },
  {
    id: 'sample-tour',
    topic: 'start',
    q: 'Is there a sample report or a guided tour?',
    variants: ['show me a demo', 'demo report', 'sample report', 'guided tour', 'product tour', 'replay the tour', 'restart the tour', 'walkthrough', 'tutorial', 'show me around', 'how do i see the tour again', 'onboarding'],
    keywords: ['demo', 'tour', 'sample', 'walkthrough', 'tutorial', 'onboarding', 'replay'],
    a: 'Yes. The guided tour walks you through a sample report in about six quick steps. It uses sample data, uses no credits, and never touches your real reports.\n\nYou can replay it any time from **Settings**, under the tour card.',
    actions: [{ label: 'Open Settings', to: '/settings' }],
    related: ['first-report', 'what-is'],
  },
  {
    id: 'report-types',
    topic: 'start',
    q: 'What is the difference between a Reel report and a Profile report?',
    variants: ['reel vs profile', 'reel report or profile report', 'which report should i use', 'difference between reel and profile', 'when to use profile report', 'when to use reel report', 'what is a profile report', 'what is a reel report'],
    keywords: ['difference', 'reel report', 'profile report', 'which', 'versus', 'vs'],
    a: '**Reel report**: you give us links to specific Reels and get one row per Reel, with nothing averaged. Best for tracking a campaign.\n\n**Profile report**: you give us creator profile links and get one row per creator, based on their recent Reels. Best for choosing creators before a campaign.\n\nTheir engagement rates are not the same measure, so do not compare them directly. A Reel report divides by views. A Profile report divides by followers.',
    actions: [{ label: 'How it is calculated', to: '/how-it-works' }],
    related: ['er-reel', 'er-profile', 'profile-how'],
  },
  {
    id: 'file-formats',
    topic: 'start',
    q: 'What files and links can I upload?',
    variants: ['supported file types', 'can i upload excel', 'can i upload csv', 'txt file', 'file format', 'which formats', 'xlsx', 'what kind of file', 'upload file', 'file not accepted', 'unsupported file'],
    keywords: ['excel', 'csv', 'txt', 'xlsx', 'xls', 'format', 'file type', 'upload'],
    a: 'You can upload **Excel (.xlsx, .xls), CSV or TXT** files, or simply paste links in one per line.\n\nFiles can be up to 15 MB. We find the column with your links automatically, and any other columns you have are kept and come back in your export.',
    actions: [{ label: 'Start a report', to: '/reels' }],
    related: ['link-limits', 'which-links', 'paste-links'],
  },
  {
    id: 'link-limits',
    topic: 'start',
    q: 'How many links can I add to one report?',
    variants: ['my list has 3000 links is that ok', 'more than 2000 links', 'can i upload 5000 links', 'my sheet is huge', 'maximum links', 'link limit', 'how many links per report', 'is there a limit', '2000 links', 'too many links', 'large sheet', 'big file', 'how many rows', 'limit per upload'],
    keywords: ['limit', 'maximum', 'max', 'how many links', '2000', 'rows'],
    a: 'A single report can hold up to **2,000 links**. If your sheet has more, we will ask before running the first 2,000. The rest are set aside and marked, and you can put them in a second report.',
    related: ['file-formats', 'how-long'],
  },
  {
    id: 'which-links',
    topic: 'start',
    q: 'Which Instagram links work?',
    variants: ['what links are supported', 'link format', 'do share links work', 'links with igsh', 'can i use handles', 'username instead of link', 'instagram link types', 'reel link format', 'p link', 'does the link need to be clean', 'link with tracking', 'utm link', 'qr link'],
    keywords: ['link', 'links', 'url', 'igsh', 'utm', 'share link', 'handle', 'username', 'format'],
    a: '- **Reel reports**: links to Reels (instagram.com/reel/...), post links, and the share links Instagram gives you from the app.\n- **Profile reports**: creator profile links, or just the @handle.\n\nExtra bits on the end, like tracking codes, are cleaned off for you, so you can paste links exactly as you copied them.\n\nPrivate accounts cannot be read, because we only ever use public information.',
    related: ['private-accounts', 'invalid-link', 'file-formats'],
  },
  {
    id: 'paste-links',
    topic: 'start',
    q: 'Can I paste links instead of uploading a file?',
    variants: ['paste links', 'no file', 'copy paste links', 'paste instead of upload', 'name my list', 'rename pasted links', 'pasted links txt', 'give the report a name', 'name the file'],
    keywords: ['paste', 'pasted', 'copy', 'name'],
    a: 'Yes. On the upload screen choose **Paste links instead**, put one link per line, and press Process.\n\nThere is a quiet optional box under it, "Name this list", if you want the report to show a name in History instead of "pasted-links.txt".',
    actions: [{ label: 'Open Reel report', to: '/reels' }],
    related: ['file-formats', 'which-links'],
  },
  {
    id: 'mobile',
    topic: 'start',
    q: 'Does Reelytic work on my phone?',
    variants: ['can i use it on ipad', 'does it work on a tablet', 'works on iphone', 'mobile', 'phone', 'is there an app', 'tablet', 'android', 'iphone', 'ios app', 'mobile friendly', 'use on mobile'],
    keywords: ['mobile', 'phone', 'app', 'android', 'iphone', 'tablet'],
    a: 'Yes. Reelytic works in your phone browser and adapts to a small screen, so you can check on a report or open a client link from anywhere. There is no separate app to install.',
    related: ['leave-page'],
  },
  {
    id: 'dark-mode',
    topic: 'start',
    q: 'Is there a dark mode?',
    variants: ['dark theme', 'light mode', 'change theme', 'switch to dark', 'night mode', 'change colors'],
    keywords: ['dark', 'light', 'theme', 'night'],
    a: 'Yes. Use the moon or sun button at the bottom of the left menu to switch between light and dark. It remembers your choice.',
    related: ['mobile'],
  },

  /* -------------------------------------------------------------- reports */
  {
    id: 'preview-screen',
    topic: 'reports',
    q: 'What is the preview screen before a report starts?',
    variants: ['preview', 'before i start', 'review my links', 'rename columns', 'reorder columns', 'remove a row', 'delete a link before running', 'check before charging', 'what happens after upload', 'column names', 'change column order'],
    keywords: ['preview', 'before', 'columns', 'rename', 'reorder', 'review'],
    a: 'After you upload, nothing runs and nothing is charged. The preview lets you:\n\n- see every link and whether it is valid, a repeat, or not a proper Instagram link\n- rename or reorder your own columns\n- see exactly how many credits the run will use\n\nWhen it looks right, press **Start**.',
    related: ['first-report', 'when-charged', 'edit-sheet'],
  },
  {
    id: 'how-long',
    topic: 'reports',
    q: 'How long does a report take?',
    variants: ['how much time will 500 links take', 'how long for 1000 links', 'time for a big sheet', 'how many minutes for a large report', 'how long will it take', 'is it slow', 'time to complete', 'eta', 'estimated time', 'speed', 'why so slow', 'how fast', 'how many minutes', 'processing time', 'how long until my report is ready'],
    keywords: ['long', 'time', 'slow', 'fast', 'eta', 'minutes', 'speed', 'wait'],
    a: 'It depends on how many links you gave us, and bigger sheets take longer. The running screen shows a live time estimate that gets more accurate as it goes. Profile reports look at several Reels per creator, so they take longer per link than Reel reports.\n\nYou do not need to wait on the page. See the next question.',
    related: ['leave-page', 'stuck'],
  },
  {
    id: 'leave-page',
    topic: 'reports',
    q: 'Can I close the tab while a report is running?',
    variants: ['can i leave the page', 'do i have to keep the tab open', 'close browser', 'come back later', 'run in background', 'will it keep running', 'log out while running', 'switch tabs'],
    keywords: ['close', 'leave', 'background', 'tab', 'come back', 'keep running'],
    a: 'Yes. Reports run on our side, not in your browser, so you can close the tab or switch to other work. Come back to **History** whenever you like and open the report to see where it got to.',
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['pause-resume', 'how-long'],
  },
  {
    id: 'pause-resume',
    topic: 'reports',
    q: 'How do I pause or resume a report?',
    variants: ['pause a report', 'stop a report', 'resume report', 'continue a report', 'cancel a running report', 'stop processing', 'restart where it left off', 'paused report', 'how to continue', 'pick up where i left off'],
    keywords: ['pause', 'resume', 'stop', 'continue', 'paused', 'cancel'],
    a: 'On a running report, press **Pause**. It stops after the batch it is on. A paused report shows **Paused** in History with a **Resume** button, and resuming carries on from where it stopped.\n\nLinks that already finished keep their results and are never charged twice.',
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['edit-sheet', 'when-charged', 'retry-failed'],
  },
  {
    id: 'retry-failed',
    topic: 'reports',
    q: 'How do I retry links that failed?',
    variants: ['retry failed', 'try again', 'rerun failed links', 'failed rows', 'some links did not work run again', 're-run only failed', 'redo failed'],
    keywords: ['retry', 'failed', 'again', 'rerun', 're-run', 'redo'],
    a: 'When a report finishes with some links that could not be fetched, you will see a **Retry failed** option. It re-runs only those links, nothing else, and you are only charged for the ones that now succeed.\n\nIf the same link keeps failing, see "Couldn\'t fetch".',
    related: ['couldnt-fetch', 'when-charged'],
  },
  {
    id: 'reset-report',
    topic: 'reports',
    q: 'What does Reset do?',
    variants: ['reset a report', 'start over', 'clear results', 'run again from the beginning', 'reset button', 'redo whole report'],
    keywords: ['reset', 'start over', 'clear'],
    a: '**Reset** clears the results and puts the report back to **Not started**, so you can run all of its links again from scratch. You will see the preview and its credit estimate again before anything runs.\n\nIf you only want to fix the sheet, use **Edit sheet** instead. That keeps the links that already finished.',
    related: ['edit-sheet', 'retry-failed', 'when-charged'],
  },
  {
    id: 'stuck',
    topic: 'reports',
    q: 'My report looks stuck. What should I do?',
    variants: ['report stays at the same number', 'progress is not changing', 'same number for ages', 'it has not moved for a long time', 'report not moving', 'stuck at', 'not progressing', 'frozen', 'nothing is happening', 'progress bar not moving', 'report is taking forever', 'report stopped', 'hanging', 'still processing'],
    keywords: ['stuck', 'frozen', 'not moving', 'hanging', 'stalled', 'forever', 'not progressing'],
    a: 'A few things to try:\n\n- Give it a minute. Reports work in batches, so the count can sit still for a moment and then jump.\n- Refresh the page. Your report keeps running on our side and picks its live progress back up.\n- If it is marked **Paused**, press **Resume**.\n\nStill nothing after a few minutes? Email us with the report name and we will look into it.',
    actions: [{ label: 'Open History', to: '/history' }, { label: 'Contact support', to: 'mailto:support@reelytic.com' }],
    related: ['pause-resume', 'leave-page', 'contact-support'],
  },
  {
    id: 'edit-sheet',
    topic: 'reports',
    q: 'Can I edit my sheet after uploading it?',
    variants: ['can i undo an upload', 'cancel my upload', 'i want to redo my upload', 'edit sheet', 'change the file', 'uploaded the wrong file', 'wrong sheet', 'upload a corrected file', 'replace the sheet', 'add more links to a report', 'add links later', 'i forgot some links', 'fix my upload', 'mistake in my excel', 'swap the file', 'update links', 'remove links from report', 'uploaded by mistake'],
    keywords: ['edit', 'wrong', 'mistake', 'replace', 'corrected', 'add more', 'forgot', 'change file', 'update'],
    a: 'Yes, and it is safe. Open the report and press **Edit sheet**. You can either:\n\n- **Replace with a new file** if you uploaded the wrong one. Links that are not in the new file are removed.\n- **Add more links** to keep everything and add new ones.\n\nBefore anything changes, you see a summary of exactly what will happen. Links that already finished keep their results and are **never charged again**, links that failed get another try, and only the new ones run. The report is left paused until you press Resume.',
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['pause-resume', 'when-charged', 'duplicates'],
  },
  {
    id: 'duplicates',
    topic: 'reports',
    q: 'What happens with repeated links?',
    variants: ['why is my link marked duplicate', 'what is a duplicate', 'why does it say duplicate', 'duplicate links', 'same link twice', 'repeated links', 'duplicates in my sheet', 'are duplicates charged', 'what does duplicate mean', 'same reel appears twice'],
    keywords: ['duplicate', 'duplicates', 'repeat', 'repeated', 'twice', 'same link'],
    a: 'If the same link appears more than once in a sheet, it is marked **Duplicate**. It is only fetched once and the repeats show the same result. Repeats are **not charged**.',
    related: ['when-charged', 'preview-screen'],
  },
  {
    id: 'notes-flags',
    topic: 'reports',
    q: 'Can I add notes or flag rows in a report?',
    variants: ['add a note', 'notes on a row', 'flag a creator', 'approve a reel', 'mark as approved', 'comment on a row', 'mark rows', 'approve flag', 'internal notes'],
    keywords: ['note', 'notes', 'flag', 'approve', 'approved', 'comment', 'mark'],
    a: 'Yes. Every result row has a **+ Note** button. Use it to write a note and mark the row as **Approved** or **Flagged**. It is a handy way to record decisions as you review a report, and it is saved with the report.',
    related: ['filter-rows'],
  },
  {
    id: 'filter-rows',
    topic: 'reports',
    q: 'How do I filter or search the results?',
    variants: ['filter results', 'search inside a report', 'show only failed', 'show only valid', 'find a row', 'sort results', 'filter the table', 'see only invalid links'],
    keywords: ['filter', 'search', 'sort', 'find', 'show only'],
    a: 'On the results and preview screens, the cards at the top (valid, invalid, repeated, and so on) work as filters. Click one to show only those rows. The table is paged, so use the page controls at the bottom for long reports.',
    related: ['notes-flags'],
  },
  {
    id: 'export',
    topic: 'reports',
    q: 'How do I download my report?',
    variants: ['download report', 'export to excel', 'export csv', 'download excel', 'get the file', 'save report', 'export results', 'download xlsx', 'how do i get my data out', 'export', 'get the report as excel'],
    keywords: ['download', 'export', 'excel', 'csv', 'save', 'xlsx'],
    a: 'Open the report from **History** and use the menu on its row (or the download buttons on the finished report) to choose **Download Excel (.xlsx)** or **Download CSV**. Your own columns come back next to the new numbers, so the file is ready to send on.\n\nThe menu appears once at least one link in the report has succeeded.',
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['branded-report', 'share-links', 'pdf'],
  },

  /* -------------------------------------------------------------- numbers */
  {
    id: 'columns-reel',
    topic: 'numbers',
    q: 'What numbers does a Reel report give me?',
    variants: ['reel report columns', 'what metrics', 'what data do i get', 'what is included in a reel report', 'views likes comments', 'shares saves reposts', 'what is in the report', 'metrics list'],
    keywords: ['metrics', 'columns', 'data', 'views', 'likes', 'comments', 'shares', 'saves', 'reposts'],
    a: 'For each Reel you get: **followers, views, likes, comments, shares, reposts, saves and engagement rate**, next to your own original columns.\n\nA few numbers can be blank if Instagram does not share them for that Reel. We never guess or fill in a made-up number.',
    actions: [{ label: 'How it is calculated', to: '/how-it-works' }],
    related: ['er-reel', 'hidden-likes'],
  },
  {
    id: 'columns-profile',
    topic: 'numbers',
    q: 'What numbers does a Profile report give me?',
    variants: ['profile report columns', 'profile metrics', 'what is average views', 'followers avg views avg er', 'what do i get in a profile report', 'reels analyzed meaning'],
    keywords: ['profile', 'average', 'avg', 'followers', 'analyzed'],
    a: 'For each creator you get: **followers, average views, average engagement rate, how many Reels were analyzed, and how many were not counted**. Click the Reels analyzed number to see every post we looked at and why each one was or was not counted.',
    related: ['profile-how', 'er-profile', 'view-considered'],
  },
  {
    id: 'er-reel',
    topic: 'numbers',
    q: 'How is engagement rate calculated for a Reel?',
    variants: ['reel engagement rate', 'er formula reel', 'how do you calculate er', 'engagement rate formula', 'what is er', 'engagement rate meaning', 'how is engagement calculated', 'er per view', 'formula'],
    keywords: ['engagement rate', 'er', 'formula', 'calculate', 'calculated'],
    a: 'For a Reel: **ER % (views) = (Likes + Comments) ÷ Views × 100**.\n\nIt measures how much people who actually watched the Reel interacted with it. You can try it yourself with the calculator on the "How is this calculated?" page.',
    actions: [{ label: 'Open the calculator page', to: '/how-it-works' }],
    related: ['er-profile', 'columns-reel', 'good-er'],
  },
  {
    id: 'er-profile',
    topic: 'numbers',
    q: 'How is engagement rate calculated for a Profile?',
    variants: ['profile engagement rate', 'profile er formula', 'why is profile er different', 'er per follower', 'engagement per follower', 'profile er vs reel er', 'why do the two er numbers differ'],
    keywords: ['profile er', 'per follower', 'follower', 'formula'],
    a: 'For a profile: **Avg ER % (followers) = (Average likes + Average comments) ÷ Followers × 100**.\n\nThis divides by followers, not views. That is the standard way to compare creators of different sizes, but it means a Profile ER and a Reel ER answer different questions and should not be compared directly.',
    actions: [{ label: 'See a worked example', to: '/how-it-works' }],
    related: ['profile-how', 'er-reel', 'good-er'],
  },
  {
    id: 'profile-how',
    topic: 'numbers',
    q: 'How does a Profile report work out a creator\'s average?',
    variants: ['how is profile average calculated', 'which reels are used', 'how do you pick reels', 'outliers', 'viral reel', 'how many reels are averaged', 'profile calculation', 'typical performance', 'average views calculation', 'geometric average', 'why is the average different from my own', 'how do you calculate average views'],
    keywords: ['average', 'outlier', 'outliers', 'viral', 'typical', 'calculation', 'pick', 'select'],
    a: 'We look at the creator\'s most recent Reels, then:\n\n- set aside pinned posts, because they are old and skew the picture\n- set aside the very best and very worst performers (about the top and bottom 15%), so one viral hit or one flop cannot decide the number\n- average the rest with a "typical value" average that stays close to what a normal Reel does\n\nEvery other Reel counts, **including sponsored posts and collabs**. The "How is this calculated?" page has a worked example with real numbers you can check by hand.',
    actions: [{ label: 'Worked example', to: '/how-it-works' }],
    related: ['reels-analyzed', 'sponsored', 'pinned', 'view-considered'],
  },
  {
    id: 'reels-analyzed',
    topic: 'numbers',
    q: 'Why were only a few Reels analyzed for a creator?',
    variants: ['why only 5 reels', 'why only 6 reels', 'reels analyzed is low', 'not enough reels', 'why are fewer reels used', 'why less than 6', 'reels analyzed number', 'sample size', 'why not more reels', 'how many reels are checked'],
    keywords: ['reels analyzed', 'only', 'fewer', 'less', 'sample', 'not enough'],
    a: 'We look at a creator\'s latest Reels, then set aside pinned ones and the extreme highs and lows. What is left is usually **5 to 6 Reels**, and can be fewer if the creator has posted very little recently.\n\nAn account with few Reels simply has few to look at. Click the number to see every post we considered and why.',
    related: ['not-counted', 'view-considered', 'profile-how'],
  },
  {
    id: 'not-counted',
    topic: 'numbers',
    q: 'What does "Not Counted" mean in a Profile report?',
    variants: ['not counted column', 'what is not counted', 'skipped reels', 'excluded reels', 'why were reels left out', 'what is skipped', 'reels skipped', 'reels left out', 'ignored posts'],
    keywords: ['not counted', 'skipped', 'excluded', 'left out', 'ignored'],
    a: '**Not Counted** is how many of the creator\'s fetched posts were left out of the average: pinned posts, anything that is not a Reel, posts with no view data, and the extreme highs and lows.\n\nSponsored posts and collabs are **not** in this number. They are counted. Click the number to see each post and its reason.',
    related: ['sponsored', 'pinned', 'view-considered'],
  },
  {
    id: 'sponsored',
    topic: 'numbers',
    q: 'Are sponsored posts and collabs counted?',
    variants: ['paid partnership', 'sponsored reels', 'collab posts', 'branded content', 'are collaborations included', 'do you skip sponsored', 'ads included', 'partnership posts', 'collab reels included'],
    keywords: ['sponsored', 'collab', 'collabs', 'collaboration', 'paid partnership', 'branded', 'ads'],
    a: 'Yes. Every Reel a creator posted counts toward their average, including **paid partnerships and joint collabs**. You can still see which posts were sponsored or collabs: click the Reels analyzed number and look for the small Sponsored or Collab tag, plus the share of them at the top.',
    related: ['profile-how', 'view-considered'],
  },
  {
    id: 'pinned',
    topic: 'numbers',
    q: 'Why are pinned posts left out?',
    variants: ['do pinned reels count', 'is a pinned reel included', 'what happens to pinned content', 'pinned reels', 'pinned post', 'why is pinned excluded', 'are pinned reels counted', 'pinned content'],
    keywords: ['pinned', 'pin'],
    a: 'Pinned posts are often much older and much bigger than a creator\'s everyday content. Including them would make a creator look far bigger than they usually are, so they are left out. Everything else recent counts.',
    related: ['not-counted', 'profile-how'],
  },
  {
    id: 'view-considered',
    topic: 'numbers',
    q: 'Can I see which posts were used for a creator?',
    variants: ['see the reels used', 'which posts were considered', 'show reels behind the average', 'posts considered', 'transparency', 'proof of average', 'verify the average', 'see the individual reels', 'drill down'],
    keywords: ['considered', 'which posts', 'which reels', 'drill', 'verify', 'see the posts'],
    a: 'Yes. In a Profile report, click the **Reels analyzed** number (or the Not Counted number) on any creator. You get every post we looked at, most recent first, with views, likes, comments, engagement and the reason each one was counted or not.',
    related: ['not-counted', 'sponsored', 'profile-how'],
  },
  {
    id: 'numbers-differ',
    topic: 'numbers',
    q: 'Why do the numbers differ from what I see in Instagram?',
    variants: ['is data accurate', 'how accurate are the numbers', 'can i trust these numbers', 'how reliable is the data', 'numbers dont match', 'different from instagram', 'views are different', 'instagram shows different views', 'mismatch', 'not the same as the app', 'wrong numbers', 'numbers changed', 'outdated numbers', 'instagram numbers are not the same as yours'],
    keywords: ['different', 'mismatch', 'match', 'wrong', 'changed', 'outdated'],
    a: 'The most common reasons:\n\n- Numbers keep moving. A report is a snapshot from the moment it ran, so a Reel that is still growing will have moved on.\n- We only use what is publicly visible, so anything a creator keeps private will not appear.\n\nIf a number looks properly off, email us with the link and the report name and we will take a look.',
    related: ['hidden-likes', 'data-fresh', 'contact-support'],
  },
  {
    id: 'data-fresh',
    topic: 'numbers',
    q: 'How fresh is the data?',
    variants: ['what is cached', 'is data cached', 'are results cached', 'do you cache results', 'is the data live', 'how up to date', 'when was it fetched', 'real time', 'latest numbers', 'refresh numbers', 'update my report', 'how do i refresh'],
    keywords: ['fresh', 'live', 'realtime', 'real time', 'latest', 'refresh', 'up to date', 'update'],
    a: 'Each result is fetched when the report runs, so it is as current as that moment. To get fresh numbers later, run the links again in a new report. A repeat of a link you checked very recently may reuse that recent result.',
    related: ['numbers-differ'],
  },
  {
    id: 'hidden-likes',
    topic: 'numbers',
    q: 'Why are likes or other numbers blank or zero?',
    variants: ['my report shows 0 views', 'views showing zero', 'why are views zero', 'likes hidden', 'zero likes', 'likes not showing', 'hidden likes', 'shares blank', 'saves blank', 'missing numbers', 'why is it zero', 'no likes data', 'like count hidden by creator'],
    keywords: ['hidden', 'blank', 'zero', 'missing', 'likes', 'not showing', 'empty'],
    a: 'Creators can hide the like count on their posts, and Instagram does not share some numbers (like saves or shares) for every Reel. In those cases we show what is genuinely available and never invent a value. A hidden number is not an error in your report.',
    related: ['er-zero', 'columns-reel'],
  },
  {
    id: 'er-zero',
    topic: 'numbers',
    q: 'Why is a creator\'s engagement rate 0%?',
    variants: ['er is zero', '0% engagement', 'engagement rate zero', 'why is er 0', 'engagement missing', 'er not showing', 'engagement shows 0 percent'],
    keywords: ['0%', 'zero', 'er', 'engagement'],
    a: 'A 0% means there was no engagement to measure for the posts we looked at, or the numbers behind it were not available, for example when a creator hides their likes. Click the Reels analyzed number to see the posts behind it.\n\nIf it still looks wrong for a creator who is clearly active, email us the profile link.',
    related: ['hidden-likes', 'view-considered', 'contact-support'],
  },
  {
    id: 'good-er',
    topic: 'numbers',
    q: 'What is a good engagement rate?',
    variants: ['what is a good er', 'is 2 percent good', 'benchmark', 'average engagement rate', 'what does the green badge mean', 'good engagement', 'how do i judge a creator', 'what is high engagement'],
    keywords: ['good', 'benchmark', 'high', 'badge', 'green', 'healthy'],
    a: 'There is no single answer, since it depends on the niche and the creator\'s size. As a simple guide we mark creators with an engagement rate **above 2%** with a green badge in the Creator database, so strong performers stand out at a glance.\n\nRemember that Reel ER and Profile ER are measured differently, so compare like with like.',
    actions: [{ label: 'Open Creators', to: '/creators' }],
    related: ['er-reel', 'er-profile', 'creators-er-badge'],
  },

  /* ------------------------------------------------------------- problems */
  {
    id: 'couldnt-fetch',
    topic: 'problems',
    q: 'What does "Couldn\'t fetch" mean?',
    variants: ['why did my link fail', 'why did my link not work', 'what does a failed link mean', 'what does failed mean', 'my link failed', 'why did the link fail', 'why did my reel fail', 'why is my link failing', 'why did my profile fail', 'why did some rows fail', 'some of my rows failed', 'why did some links fail', 'some rows show an error', 'could not fetch', 'failed row', 'link failed', 'why did my link fail', 'no data returned', 'returned no data', 'instagram returned no data', 'link not working', 'error on a row', 'failed links', 'why failed'],
    keywords: ['fetch', 'failed', 'fail', 'error', 'no data', 'not working'],
    a: 'It means the link looked fine but we could not get data back for it. Common reasons:\n\n- the account is **private**\n- the creator has **no Reels** yet, or the Reel was deleted\n- a temporary hiccup on the way\n\nFailed links are **never charged**. Use **Retry failed** to try them again, and if one keeps failing, check the link opens in a browser while logged out.',
    related: ['retry-failed', 'private-accounts', 'invalid-link', 'when-charged'],
  },
  {
    id: 'invalid-link',
    topic: 'problems',
    q: 'What does "Invalid link" mean?',
    variants: ['invalid url', 'link says invalid', 'not a valid link', 'why is my link invalid', 'invalid entry', 'wrong link', 'link not recognised', 'bad link'],
    keywords: ['invalid', 'not valid', 'wrong link', 'bad link'],
    a: '**Invalid link** means the entry is not a proper Instagram link for this report type, for example a profile link in a Reel report, a blank cell, or text that is not a link. Invalid entries are skipped and **never charged**.\n\nCheck you are in the right report type: Reel links go in Reel Report, creator links go in Profile Report.',
    actions: [{ label: 'Reel report', to: '/reels' }, { label: 'Profile report', to: '/profiles' }],
    related: ['which-links', 'couldnt-fetch', 'edit-sheet'],
  },
  {
    id: 'private-accounts',
    topic: 'problems',
    q: 'Can Reelytic read private accounts?',
    variants: ['private account', 'private profile', 'locked account', 'can you see private', 'account is private', 'private instagram'],
    keywords: ['private', 'locked'],
    a: 'No. Reelytic only ever uses public information and never asks for an Instagram login, so private accounts cannot be read. Those links show as **Couldn\'t fetch** and are not charged.',
    related: ['couldnt-fetch', 'privacy'],
  },
  {
    id: 'all-failed',
    topic: 'problems',
    q: 'All my links failed. What is wrong?',
    variants: ['every link failed', 'nothing worked', 'all rows failed', 'everything failed', 'zero results', 'no results at all', 'report is empty', 'no rows succeeded'],
    keywords: ['all', 'everything', 'nothing', 'every', 'empty'],
    a: 'Take a breath, you have not been charged for failed links. Check these first:\n\n- Are they in the right report? Reel links go in a Reel report, profile links in a Profile report.\n- Do the links open in a browser when you are logged out of Instagram?\n- Are the accounts public?\n\nIf all of that looks fine, try **Retry failed** once. Still nothing? Email us with the report name and we will investigate.',
    actions: [{ label: 'Contact support', to: 'mailto:support@reelytic.com' }],
    related: ['couldnt-fetch', 'retry-failed', 'invalid-link'],
  },
  {
    id: 'not-enough-credits',
    topic: 'problems',
    q: 'What happens if I run out of credits?',
    variants: ['out of credits', 'not enough credits', 'insufficient credits', 'credits finished', 'credits ran out', 'cant start report no credits', 'balance too low', 'zero credits', 'credits over', 'no credits left'],
    keywords: ['out of credits', 'not enough', 'insufficient', 'ran out', 'no credits', 'balance', 'low'],
    a: 'If a run needs more credits than you have, we tell you before anything starts, and nothing is half-charged. You can:\n\n- run a smaller batch that fits your balance\n- upgrade your plan for more credits\n\nIf a report has already partly run, the finished links keep their results, and you can resume once you have more credits.',
    actions: [{ label: 'See the plans', to: '/billing' }],
    related: ['my-credits', 'upgrade', 'edit-sheet'],
  },
  {
    id: 'upload-error',
    topic: 'problems',
    q: 'My file would not upload. What should I try?',
    variants: ['upload failed', 'cant upload file', 'error uploading', 'file rejected', 'file too big', 'we couldnt read that file', 'excel not opening', 'upload error', 'upload not working', 'could not find a url column'],
    keywords: ['upload', 'error', 'rejected', 'too big', 'could not read', 'not working', 'column'],
    a: 'Try these in order:\n\n- Make sure it is **.xlsx, .xls, .csv or .txt** and under **15 MB**.\n- Check it has at least one column with links, ideally with a heading like "URL" or "Link".\n- If it still fails, paste the links in using **Paste links instead**, which always works.\n\nStill stuck? Send the file to support and we will check it for you.',
    actions: [{ label: 'Contact support', to: 'mailto:support@reelytic.com' }],
    related: ['file-formats', 'paste-links'],
  },
  {
    id: 'login-problem',
    topic: 'problems',
    q: 'I cannot sign in',
    variants: ['cant login', 'login not working', 'wrong password', 'unable to sign in', 'login error', 'account locked', 'sign in issue', 'password not accepted', 'forgot my login', 'cannot access my account'],
    keywords: ['login', 'log in', 'sign in', 'signin', 'locked', 'cannot access', 'password'],
    a: 'Try these:\n\n- Check for typos and that caps lock is off.\n- Use **Forgot password** on the sign-in page and we will email you a reset link.\n- Your team may have given you a temporary password. If so, you will be asked to choose a new one when you first sign in.\n\nStill locked out? Email us from the address on your account.',
    actions: [{ label: 'Contact support', to: 'mailto:support@reelytic.com' }],
    related: ['forgot-password', 'verify-email'],
  },

  /* -------------------------------------------------------------- credits */
  {
    id: 'what-is-credit',
    topic: 'credits',
    q: 'What is a credit?',
    variants: ['what are credits', 'how do credits work', 'credit meaning', 'explain credits', 'what do credits do', 'credit system'],
    keywords: ['credit', 'credits', 'how do credits work'],
    a: (ctx) => `Credits are what a report uses up. **One Reel costs ${fact(ctx, 'creditsPerReel', 1)} ${fact(ctx, 'creditsPerReel', 1) === 1 ? 'credit' : 'credits'}** and **one creator profile costs ${fact(ctx, 'creditsPerProfile', 5)} credits**, because a profile looks at several Reels.\n\nYou are only charged for links that succeed. Your balance is always shown at the bottom of the left menu.`,
    related: ['when-charged', 'my-credits', 'plans'],
  },
  {
    id: 'credit-cost',
    topic: 'credits',
    q: 'How many credits does a report use?',
    variants: ['cost of a report', 'how much does a reel cost', 'how much for a profile', 'credits per reel', 'credits per profile', 'how many credits per link', 'price per report', 'estimate credits', 'how much will this run cost', 'what does it cost', 'how much do i pay for one reel', 'whats the price of running a profile report'],
    keywords: ['cost', 'how much', 'per reel', 'per profile', 'price', 'credits per', 'estimate'],
    a: (ctx) => `- **Reel report**: ${fact(ctx, 'creditsPerReel', 1)} ${fact(ctx, 'creditsPerReel', 1) === 1 ? 'credit' : 'credits'} per Reel\n- **Profile report**: ${fact(ctx, 'creditsPerProfile', 5)} credits per creator\n\nThe preview screen shows the total for your sheet before you start, and it is the most you can be charged. Failed, invalid and repeated links are not charged, so the real total is often lower.`,
    actions: [{ label: 'See plans and credit amounts', to: '/billing' }],
    related: ['when-charged', 'what-is-credit'],
  },
  {
    id: 'when-charged',
    topic: 'credits',
    q: 'When am I charged? Am I charged for failed links?',
    variants: ['why was i charged more than expected', 'i was charged twice', 'do i get charged if instagram returns nothing', 'am i charged when nothing comes back', 'charged if there is no data for a link', 'do i pay when a link returns no data', 'will i lose credits if links do not work', 'do i lose credits when a link fails', 'are credits lost on failed links', 'do i lose credits for bad links', 'are failed links charged', 'do i pay for failed', 'charged for invalid', 'charged for duplicates', 'when are credits deducted', 'will i be charged twice', 'charged again', 'double charge', 'credit deducted', 'does editing cost credits', 'is the preview free'],
    keywords: ['charged', 'charge', 'deducted', 'pay', 'twice', 'double', 'refund for failed'],
    a: 'Simple rules:\n\n- Uploading and the preview are **free**.\n- Credits are used only when a link **succeeds**.\n- **Failed, invalid and repeated** links are never charged.\n- A link that already finished is **never charged twice**, even if you pause, resume, retry or edit the sheet.\n\nEditing a sheet costs nothing by itself. Only new links that run afterwards use credits.',
    related: ['credit-cost', 'refund', 'edit-sheet'],
  },
  {
    id: 'my-credits',
    topic: 'credits',
    q: 'How many credits do I have?',
    variants: ['my credits', 'credit balance', 'check my balance', 'how many credits left', 'remaining credits', 'what is my balance', 'credits remaining', 'balance'],
    keywords: ['balance', 'left', 'remaining', 'my credits', 'how many credits do i have'],
    signedIn: true,
    a: (ctx) => {
      const u = ctx && ctx.user;
      if (!u) return 'Sign in and I can show you your balance. It is also always shown at the bottom of the left menu.';
      return `You have **${Number(u.credits || 0).toLocaleString()} credits** on the **${planName(ctx)}** plan. It is always visible at the bottom of the left menu too.`;
    },
    actions: [{ label: 'See the plans', to: '/billing' }],
    related: ['credit-cost', 'not-enough-credits', 'upgrade'],
  },
  {
    id: 'my-plan',
    topic: 'credits',
    q: 'Which plan am I on?',
    variants: ['my plan', 'what plan do i have', 'current plan', 'which subscription', 'am i on free', 'what am i on'],
    keywords: ['my plan', 'current plan', 'which plan', 'subscription'],
    signedIn: true,
    a: (ctx) => {
      if (!(ctx && ctx.user)) return 'Sign in and I can tell you which plan you are on. You can compare all of them on the Pricing page.';
      const name = planName(ctx);
      const on = ['reportBranding', 'shareableLinks', 'creatorDatabase', 'teamSeats', 'clientPortal'].filter((k) => has(ctx, k));
      const labels = { reportBranding: 'custom report branding', shareableLinks: 'shareable links', creatorDatabase: 'the creator database', teamSeats: 'team seats', clientPortal: 'client portals' };
      const list = on.length ? `\n\nYour plan includes: ${on.map((k) => labels[k]).join(', ')}.` : '\n\nPaid plans unlock branding, sharing, the creator database, team seats and client portals.';
      return `You are on the **${name}** plan.${list}`;
    },
    actions: [{ label: 'Compare plans', to: '/billing' }],
    related: ['plans', 'upgrade', 'which-plan-has'],
  },
  {
    id: 'plans',
    topic: 'credits',
    q: 'What plans do you offer and how much are they?',
    variants: ['pricing', 'how much is it', 'plan prices', 'subscription cost', 'monthly price', 'starter pro agency', 'what plans are there', 'price list', 'how much per month', 'cost of plans', 'plan comparison', 'which plan should i pick', 'cheapest plan', 'what are your subscription tiers'],
    keywords: ['pricing', 'price', 'plans', 'plan', 'starter', 'pro', 'agency', 'monthly', 'subscription', 'per month'],
    a: (ctx) => `There is a free plan to try things, then ${planNames(ctx)} as you grow. Higher plans bring more monthly credits, more team seats and extras like custom branding and shareable links.\n\nThe Pricing page always has the current prices and exactly what each plan includes, so I will send you there rather than quote numbers that may have changed.`,
    actions: [{ label: 'Open Pricing and plans', to: '/billing' }],
    related: ['which-plan-has', 'upgrade', 'free-credits'],
  },
  {
    id: 'which-plan-has',
    topic: 'credits',
    q: 'Which plan includes which feature?',
    variants: ['compare plans', 'compare the plans', 'what is included in agency', 'what do i get in the pro plan', 'what comes with starter', 'what is in each plan', 'feature comparison', 'what does pro include', 'what does agency include', 'what does starter include', 'plan features', 'which plan for branding', 'which plan for team seats', 'which plan for client portal', 'do i need pro', 'difference between plans', 'which plan do i need for client portal'],
    keywords: ['include', 'includes', 'which plan', 'features', 'comparison', 'need pro', 'difference between plans'],
    a: (ctx) => {
      const lines = planFeatureLines(ctx);
      if (!lines.length) return 'Every paid plan comes with a monthly pool of credits. Higher plans add team seats and extras like custom report branding and shareable links.\n\nThe Pricing page has the full, current list for each plan.';
      return `Here is what each plan includes right now:\n\n${lines.map((l) => `- ${l}`).join('\n')}\n\nThe Pricing page always has the complete list.`;
    },
    actions: [{ label: 'Open Pricing and plans', to: '/billing' }],
    related: ['plans', 'locked-feature', 'upgrade'],
  },
  {
    id: 'upgrade',
    topic: 'credits',
    q: 'How do I upgrade or get more credits?',
    variants: ['how do i upgrade my account', 'upgrade my account', 'how to upgrade', 'i want a higher plan', 'upgrade plan', 'buy credits', 'get more credits', 'top up', 'change plan', 'switch plan', 'subscribe', 'purchase', 'how do i pay', 'add credits', 'recharge', 'buy a plan'],
    keywords: ['upgrade', 'buy', 'top up', 'topup', 'subscribe', 'purchase', 'more credits', 'recharge', 'pay'],
    a: 'Open **Pricing and plans**, pick a plan and follow the checkout. Your new credits are added as soon as the payment goes through.\n\nIf you are a team member on someone else\'s workspace, billing is handled by the account owner.',
    actions: [{ label: 'Open Pricing and plans', to: '/billing' }],
    related: ['payment', 'plans', 'team-member'],
  },
  {
    id: 'payment',
    topic: 'credits',
    q: 'Is payment secure? Which payment methods work?',
    variants: ['payment methods', 'is payment safe', 'card details', 'do you store my card', 'upi', 'credit card', 'debit card', 'net banking', 'how do i pay', 'secure payment'],
    keywords: ['payment', 'card', 'upi', 'secure', 'safe', 'netbanking'],
    a: 'Payments go through a secure, well-known payment provider. Your full card details are handled by them and are **never stored by Reelytic**. The checkout shows the payment methods available to you.',
    actions: [{ label: 'Open Pricing and plans', to: '/billing' }],
    related: ['upgrade', 'refund'],
  },
  {
    id: 'refund',
    topic: 'credits',
    q: 'What is your refund policy?',
    variants: ['refund', 'money back', 'get a refund', 'cancel and refund', 'refund policy', 'can i get my money back', 'credits refund', 'charged wrongly'],
    keywords: ['refund', 'money back', 'chargeback', 'wrongly charged'],
    a: 'Credits that have already been used are generally not refundable, and our Terms of Service has the full details. That said, if something went wrong on our side, such as a charge that does not look right, please email us and we will look into it properly.',
    actions: [{ label: 'Read the Terms', to: '/terms' }, { label: 'Contact support', to: 'mailto:support@reelytic.com' }],
    related: ['when-charged', 'contact-support'],
  },
  {
    id: 'invoice-cancel',
    topic: 'credits',
    q: 'Can I get an invoice, or cancel my plan?',
    variants: ['invoice', 'gst invoice', 'receipt', 'cancel subscription', 'cancel my plan', 'stop subscription', 'billing history', 'tax invoice', 'downgrade'],
    keywords: ['invoice', 'receipt', 'cancel', 'gst', 'downgrade', 'billing history'],
    a: 'For invoices, receipts, plan changes or cancellations, email us from your account address and we will sort it out quickly.',
    actions: [{ label: 'Contact support', to: 'mailto:support@reelytic.com' }],
    related: ['upgrade', 'refund'],
  },

  /* -------------------------------------------------------------- premium */
  {
    id: 'locked-feature',
    topic: 'premium',
    q: 'Why does a feature show a lock on my account?',
    variants: ['why is creators page locked', 'i cannot see the creators page', 'why cant i use the creator database', 'why is portal locked', 'padlock on a feature', 'why is there a padlock', 'why is this feature locked', 'what is the lock icon', 'unlock this feature', 'locked', 'why is it locked', 'feature locked', 'lock icon', 'cant use this feature', 'premium feature', 'grayed out', 'not available on my plan', 'what is unlocked for me'],
    keywords: ['lock', 'locked', 'unlock', 'premium', 'not available'],
    a: (ctx) => {
      const lines = [
        featureLine(ctx, 'reportBranding', 'Custom report branding', 'a paid plan'),
        featureLine(ctx, 'shareableLinks', 'Shareable report links', 'a paid plan'),
        featureLine(ctx, 'creatorDatabase', 'Creator database', 'a paid plan'),
        featureLine(ctx, 'teamSeats', 'Team seats', 'a paid plan'),
        featureLine(ctx, 'clientPortal', 'Client portals', 'a paid plan'),
      ];
      const head = ctx && ctx.user ? `A lock means the feature is part of a higher plan. You are on **${planName(ctx)}**, so here is where things stand:` : 'A lock means the feature is part of a paid plan. Here is what sits where:';
      return `${head}\n\n${lines.map((l) => `- ${l}`).join('\n')}`;
    },
    actions: [{ label: 'Compare plans', to: '/billing' }],
    related: ['which-plan-has', 'upgrade'],
  },
  {
    id: 'branding',
    topic: 'premium',
    q: 'How do I put my own logo and colors on reports?',
    variants: ['white label', 'custom branding', 'add my logo', 'brand my reports', 'agency logo', 'change report colors', 'branded reports', 'my company name on the report', 'white labeled reports', 'remove reelytic branding'],
    keywords: ['brand', 'branding', 'logo', 'white label', 'white-label', 'colors', 'colours', 'agency name'],
    a: (ctx) => `Add your logo and brand color once in **Settings**, and every branded report carries your name, so your client only ever sees you.\n\n${featureLine(ctx, 'reportBranding', 'Custom branding', 'a paid plan')}`,
    actions: [{ label: 'Open Settings', to: '/settings' }],
    related: ['branded-report', 'share-links', 'locked-feature'],
  },
  {
    id: 'branded-report',
    topic: 'premium',
    q: 'What is the branded report?',
    variants: ['client report', 'client ready report', 'report for my client', 'branded report view', 'print report', 'presentable report', 'report to send to client', 'branded sheet'],
    keywords: ['branded report', 'client report', 'client-ready', 'presentable', 'print'],
    a: (ctx) => `The branded report is a clean, presentable version of your results with your logo and colors, made to be shown or printed for a client. Open it from a finished report in **History**, using the **Branded report** option.\n\n${featureLine(ctx, 'reportBranding', 'Branded reports', 'a paid plan')}`,
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['branding', 'share-links', 'pdf'],
  },
  {
    id: 'pdf',
    topic: 'premium',
    q: 'Can I download a PDF?',
    variants: ['pdf download', 'export as pdf', 'save as pdf', 'pdf report', 'download report pdf'],
    keywords: ['pdf'],
    a: (ctx) => (has(ctx, 'pdfExport')
      ? 'Yes. Open a finished report, go to the **Branded report**, and press **Download PDF** at the top. You get a clean PDF with your branding, ready to send.\n\nExcel and CSV downloads are there too, from **History** or the finished report.'
      : 'A one-click PDF download is coming soon and is not switched on for your account yet. Today you can download **Excel or CSV**, and you can open the **branded report** and use your browser\'s print option to save it as a PDF.'),
    related: ['export', 'branded-report'],
  },
  {
    id: 'share-links',
    topic: 'premium',
    q: 'How do I share a report with a client?',
    variants: ['client can view the report without an account', 'let my client see a report without signing up', 'send my client a link to the report', 'shareable link', 'share a report', 'send a link to my client', 'share report link', 'public link', 'client link', 'send report to client', 'get shareable link', 'view only link', 'stop sharing', 'revoke share link', 'how can my client see the report without an account'],
    keywords: ['share', 'shareable', 'link to client', 'send to client', 'public link', 'view only'],
    a: (ctx) => `Open the report's **Branded report** page (from **History**, use the row menu) and press **Get shareable link**. Anyone with the link sees a clean, view-only copy, with no Reelytic account needed. You can switch the link off at any time from the same place.\n\n${featureLine(ctx, 'shareableLinks', 'Shareable links', 'a paid plan')}\n\nFor a link that keeps updating across a whole campaign, see client portals.`,
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['portal', 'branding'],
  },
  {
    id: 'portal',
    topic: 'premium',
    q: 'What is a client portal?',
    variants: ['can my client log in', 'can clients see it themselves', 'what is a portal link', 'what does the portal do', 'tell me about the portal', 'client portal', 'portal for my client', 'campaign link', 'persistent link', 'live link for client', 'always updated link', 'campaign dashboard for client', 'one link per campaign', 'what is the portal'],
    keywords: ['portal', 'client portal', 'campaign link', 'living link', 'always updated'],
    a: (ctx) => `A client portal is **one living link per campaign**. Your client opens it any time and always sees the latest numbers, so you stop sending a new file every time something updates. It needs no login for your client and is view only.\n\n${featureLine(ctx, 'clientPortal', 'Client portals', 'a paid plan')}`,
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['portal-how', 'campaigns', 'share-links'],
  },
  {
    id: 'portal-how',
    topic: 'premium',
    q: 'How do I create or turn off a client portal link?',
    variants: ['create a portal', 'set up client portal', 'make portal link', 'turn off portal', 'revoke portal link', 'disable client portal', 'new portal link', 'portal not working', 'stop client seeing'],
    keywords: ['create portal', 'turn off', 'revoke', 'disable', 'portal link'],
    a: 'In **History**, switch to **Campaigns**, open the menu on a campaign and choose **Client portal**. Create the link, copy it and send it to your client.\n\nTo cut off access, open the same dialog and turn the link off. The old link stops working straight away, and you can create a fresh one later.',
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['portal', 'campaigns'],
  },
  {
    id: 'team',
    topic: 'premium',
    q: 'Can I add my teammates?',
    variants: ['team seats', 'invite a teammate', 'add team members', 'add colleague', 'share my account', 'multiple users', 'how many users', 'team access', 'invite someone', 'add someone to my workspace', 'seat limit', 'add employees', 'invite link expired', 'how many seats do i get'],
    keywords: ['team', 'teammate', 'seats', 'invite', 'colleague', 'members', 'multiple users', 'employees'],
    a: (ctx) => `Yes. Invite teammates from **Settings**, in the team card. They get an email, accept it, and join your workspace. They see the same reports, campaigns and creators, and use the same credits.\n\n${seatLine(ctx)}\n\n${featureLine(ctx, 'teamSeats', 'Team seats', 'a paid plan')}`,
    actions: [{ label: 'Open Settings', to: '/settings' }],
    related: ['team-member', 'locked-feature'],
  },
  {
    id: 'team-member',
    topic: 'premium',
    q: 'What can a team member do or not do?',
    variants: ['team member permissions', 'what can members see', 'can members buy credits', 'remove a team member', 'remove teammate', 'member billing', 'member access', 'who pays', 'leave a team', 'revoke an invite'],
    keywords: ['member', 'permissions', 'remove', 'access', 'leave', 'revoke invite'],
    a: 'Team members work in the same workspace as the owner: same reports, campaigns and creators, same credit balance. They **cannot** see or change billing. Only the owner can buy or change plans.\n\nThe owner can remove a member or cancel a pending invite any time from **Settings**.',
    actions: [{ label: 'Open Settings', to: '/settings' }],
    related: ['team', 'upgrade'],
  },

  /* ------------------------------------------------------------- organize */
  {
    id: 'campaigns',
    topic: 'organize',
    q: 'What are campaigns and how do I use them?',
    variants: ['campaign', 'group reports', 'organize reports', 'create a campaign', 'add report to campaign', 'assign to campaign', 'campaign logo', 'folders', 'group by client', 'organise by brand', 'delete a campaign'],
    keywords: ['campaign', 'campaigns', 'group', 'organize', 'organise', 'folder', 'brand', 'client'],
    a: 'A campaign groups related reports, for example one brand or one launch, so everything sits together and rolls up into one view. You can:\n\n- create a campaign when you start a report, or from **History**\n- move any report into a campaign with the picker on its row\n- give a campaign its own logo\n- send a campaign\'s client portal link\n\nDeleting a campaign does not delete its reports.',
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['portal', 'history-find'],
  },
  {
    id: 'history-status',
    topic: 'organize',
    q: 'What do the report statuses mean?',
    variants: ['what does paused mean in the history list', 'what does not started mean in history', 'what does paused mean', 'what does running mean', 'what does complete mean', 'what do the statuses mean', 'status meaning', 'not started', 'paused status', 'running status', 'complete status', 'what does not started mean', 'report states', 'what is in progress'],
    keywords: ['history', 'status', 'not started', 'paused', 'running', 'complete', 'state'],
    a: '- **Not started**: uploaded and previewed, waiting for you to press Start. Nothing has been charged.\n- **Running**: being processed right now.\n- **Paused**: stopped part way. Press Resume to carry on.\n- **Complete**: every link has been processed.',
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['pause-resume', 'history-find'],
  },
  {
    id: 'history-find',
    topic: 'organize',
    q: 'How do I find an old report?',
    variants: ['find a report', 'search reports', 'old reports', 'past reports', 'where are my reports', 'lost my report', 'open previous report', 'report history', 'look up a report', 'filter reports by date'],
    keywords: ['find', 'search', 'old', 'past', 'history', 'where', 'previous', 'lost'],
    a: 'Everything you have run lives in **History**. Search by file name, or filter by type (Reel or Profile), status (Completed, Running, Paused, Not started) and date range.',
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['history-status', 'campaigns', 'delete-report'],
  },
  {
    id: 'delete-report',
    topic: 'organize',
    q: 'How do I delete a report?',
    variants: ['remove a report', 'delete reports', 'discard report', 'delete old report', 'bulk delete', 'clear history', 'remove from history', 'delete a file', 'i want to delete my data', 'erase a report'],
    keywords: ['delete', 'remove', 'discard', 'clear', 'erase'],
    a: 'Reports are kept in your **History** so you can always come back to them or download results later, and there is no delete button today.\n\nIf you want a tidy workspace, group finished reports into **campaigns**. If you need a report removed for privacy reasons, email us and we will take care of it.\n\nStarting a new report never deletes the old one.',
    actions: [{ label: 'Open History', to: '/history' }, { label: 'Email support', to: 'mailto:support@reelytic.com' }],
    related: ['campaigns', 'delete-account', 'history-find'],
  },
  {
    id: 'dashboard',
    topic: 'organize',
    q: 'What does the Dashboard show?',
    variants: ['dashboard', 'home page', 'overview page', 'stats page', 'what is on the dashboard', 'activity chart', 'success rate', 'total processed'],
    keywords: ['dashboard', 'stats', 'activity', 'success rate', 'overview'],
    a: 'Your Dashboard is a quick summary of your workspace: how many Reel and Profile reports you ran, total links processed, your success rate, a day-by-day activity chart and your most recent reports. Use the range picker at the top to look at the last 7, 14, 30 or 90 days.',
    actions: [{ label: 'Open Dashboard', to: '/dashboard' }],
    related: ['history-find'],
  },

  /* ------------------------------------------------------------- creators */
  {
    id: 'creators-what',
    topic: 'creators',
    q: 'What is the Creator database?',
    variants: ['creator database', 'creators page', 'list of creators', 'saved creators', 'creator list', 'where are my creators', 'influencer database', 'how do creators get added', 'creator search'],
    keywords: ['creator database', 'creators', 'influencers', 'creator list'],
    a: (ctx) => `Every creator you analyze in a Reel or Profile report is added automatically, with their followers, average views and engagement, which campaigns they appeared in and how often you have analyzed them. It becomes your own searchable shortlist, built without any extra work.\n\n${featureLine(ctx, 'creatorDatabase', 'The creator database', 'a paid plan')}`,
    actions: [{ label: 'Open Creators', to: '/creators' }],
    related: ['creators-filter', 'creators-er-badge', 'creators-gender'],
  },
  {
    id: 'creators-filter',
    topic: 'creators',
    q: 'How do I filter or sort the creators?',
    variants: ['filter by follower count', 'creators with more than 50k followers', 'show creators between two follower sizes', 'filter creators', 'sort creators', 'excel style filter', 'column filter', 'find creators with high engagement', 'filter by followers', 'filter by gender', 'filter by campaign', 'search creators', 'narrow down creators', 'sort by followers'],
    keywords: ['filter', 'sort', 'search', 'column', 'narrow', 'followers', 'range'],
    a: 'Click any column heading in the Creators table, and a small panel opens where you can **sort** and **filter** that column, just like in Excel. For example, followers between two numbers, engagement above a value, or specific campaigns.\n\nAn active filter shows as a chip above the table, and you can clear them one by one. There is also a search box for a handle or name.',
    actions: [{ label: 'Open Creators', to: '/creators' }],
    related: ['creators-views', 'creators-er-badge'],
  },
  {
    id: 'creators-er-badge',
    topic: 'creators',
    q: 'What is the green badge next to a creator?',
    variants: ['engagement badge', 'green badge', 'er badge', 'what does the badge mean', 'why is it green', 'grey badge', 'creator engagement color'],
    keywords: ['badge', 'green', 'grey', 'gray', 'colour', 'color'],
    a: 'It is the creator\'s engagement rate. **Green** means it is above 2%, a simple signal that they are engaging their audience well. Grey means 2% or below. Hover it for a short explanation of how that number is measured.',
    related: ['good-er', 'creators-filter'],
  },
  {
    id: 'creators-gender',
    topic: 'creators',
    q: 'How is a creator\'s gender shown?',
    variants: ['how do you find gender', 'how do you know a creators gender', 'where does gender come from', 'is gender accurate', 'how accurate is gender', 'gender column', 'is gender accurate', 'gender est', 'gender estimated', 'why is gender unknown', 'change gender', 'correct the gender', 'filter by gender', 'gender of creators'],
    keywords: ['gender', 'male', 'female', 'est', 'estimated', 'unknown'],
    a: 'Instagram does not share gender, so it is an **estimate** based on the creator\'s name, marked "est.". It is right most of the time but not always, and it shows Unknown when the name gives no clue.\n\nYou can fix any of them: click the gender tag on a row and pick the right one. Your correction replaces the estimate. You can also filter by gender from the column heading.',
    actions: [{ label: 'Open Creators', to: '/creators' }],
    related: ['creators-filter'],
  },
  {
    id: 'creators-views',
    topic: 'creators',
    q: 'Can I save a filtered list of creators?',
    variants: ['keep my creator filters for later', 'remember my filters', 'store a filtered list', 'save a view', 'saved views', 'save filters', 'save my search', 'reuse filters', 'saved segments', 'bookmark a filter', 'delete saved view'],
    keywords: ['saved', 'save view', 'view', 'segment', 'bookmark'],
    a: 'Yes. Set up your filters, then press **Save this view** and name it. Your saved views appear as tabs above the table, so a favorite shortlist is one click away. You can delete a view any time.',
    actions: [{ label: 'Open Creators', to: '/creators' }],
    related: ['creators-filter', 'creators-export'],
  },
  {
    id: 'creators-export',
    topic: 'creators',
    q: 'Can I export my creators list?',
    variants: ['export creators', 'download creators', 'creators csv', 'creators to excel', 'download creator list', 'export shortlist'],
    keywords: ['export', 'download', 'csv'],
    a: 'Yes. Press **Export CSV** above the table. The file matches whatever you have filtered, searched or sorted at that moment, so filter first and then export exactly the list you want.',
    actions: [{ label: 'Open Creators', to: '/creators' }],
    related: ['creators-filter', 'creators-views'],
  },

  /* -------------------------------------------------------------- account */
  {
    id: 'forgot-password',
    topic: 'account',
    q: 'I forgot my password',
    variants: ['reset password', 'password reset', 'forgot password', 'lost my password', 'cant remember password', 'reset my password', 'new password email', 'reset link not received'],
    keywords: ['forgot', 'reset', 'password', 'lost'],
    a: 'On the sign-in page choose **Forgot password**, enter your email and we will send a reset link. The link expires after a while for your safety, so use it soon. If no email arrives, check your spam folder and that you used the address on your account.',
    related: ['login-problem', 'change-password'],
  },
  {
    id: 'change-password',
    topic: 'account',
    q: 'How do I change my password?',
    variants: ['change my password', 'update password', 'new password', 'set a password', 'password settings', 'change login'],
    keywords: ['change password', 'update password'],
    signedIn: true,
    a: 'Open **Settings**. The security section lets you set a new password. If your account was created for you with a temporary password, you will be asked to choose your own the first time you sign in.',
    actions: [{ label: 'Open Settings', to: '/settings' }],
    related: ['forgot-password'],
  },
  {
    id: 'verify-email',
    topic: 'account',
    q: 'I did not get my verification email',
    variants: ['verify email', 'verification code', 'otp not received', 'confirm email', 'email verification', 'no verification email', 'resend verification', 'verification link'],
    keywords: ['verify', 'verification', 'otp', 'confirm', 'resend'],
    a: 'Check your spam or promotions folder first, then look for a resend option on the verification screen. Make sure the address you signed up with has no typos. If nothing arrives after a few minutes, email us and we will help.',
    actions: [{ label: 'Contact support', to: 'mailto:support@reelytic.com' }],
    related: ['login-problem', 'contact-support'],
  },
  {
    id: 'profile-settings',
    topic: 'account',
    q: 'Where can I change my account details?',
    variants: ['change my name', 'update my email', 'account settings', 'edit profile', 'workspace settings', 'update my details', 'where is settings', 'change my username'],
    keywords: ['settings', 'account', 'details', 'name', 'email', 'username'],
    signedIn: true,
    a: 'Open **Settings** from the left menu. You can see your account details and change your username, set a new password, add your report branding, manage your team, and replay the guided tour.',
    actions: [{ label: 'Open Settings', to: '/settings' }],
    related: ['branding', 'team', 'change-password'],
  },
  {
    id: 'delete-account',
    topic: 'account',
    q: 'How do I delete my account or my data?',
    variants: ['delete my account', 'close account', 'remove my data', 'export my data', 'gdpr', 'data deletion', 'erase my data', 'copy of my data'],
    keywords: ['delete account', 'close account', 'erase', 'gdpr', 'my data'],
    a: 'You can ask for a copy of your data or for your account to be deleted at any time. Email us from your account address and we will take care of it. Our Privacy Policy explains what we keep and why.',
    actions: [{ label: 'Read the Privacy Policy', to: '/privacy' }, { label: 'Contact support', to: 'mailto:support@reelytic.com' }],
    related: ['privacy', 'contact-support'],
  },
  {
    id: 'privacy',
    topic: 'account',
    q: 'Is my data safe? Do you need my Instagram login?',
    variants: ['do you use my instagram account', 'will you access my instagram', 'do i need to connect my instagram', 'do you log in to my account', 'data privacy', 'is my data secure', 'do you need my instagram password', 'instagram login', 'who can see my reports', 'is it safe', 'security', 'do you share my data', 'privacy', 'do you store my data', 'is my data private'],
    keywords: ['privacy', 'safe', 'secure', 'security', 'password', 'instagram login', 'private', 'share my data'],
    a: '- We **never ask for your Instagram login**. Reelytic only uses publicly available information.\n- Your reports, campaigns and creators are visible only to your workspace.\n- Client links (shareable and portal) are private to whoever you send them to, and you can switch them off.\n\nThe Privacy Policy has the full details.',
    actions: [{ label: 'Read the Privacy Policy', to: '/privacy' }],
    related: ['private-accounts', 'delete-account', 'affiliation'],
  },
  {
    id: 'affiliation',
    topic: 'account',
    q: 'Is Reelytic affiliated with Instagram?',
    variants: ['is this official', 'affiliated with meta', 'instagram partner', 'official instagram tool', 'is it approved by instagram', 'meta approved'],
    keywords: ['official', 'affiliated', 'meta', 'approved', 'partner'],
    a: 'No. Reelytic is an independent tool and is not affiliated with, endorsed by or sponsored by Instagram or Meta. It works only with information that is publicly visible.',
    actions: [{ label: 'Read the Terms', to: '/terms' }],
    related: ['privacy'],
  },
  {
    id: 'terms',
    topic: 'account',
    q: 'Where are the Terms and Privacy Policy?',
    variants: ['terms of service', 'terms and conditions', 'privacy policy', 'legal', 'policies', 'tos'],
    keywords: ['terms', 'legal', 'policy', 'policies', 'conditions', 'tos'],
    a: 'You can read both any time:',
    actions: [{ label: 'Terms of Service', to: '/terms' }, { label: 'Privacy Policy', to: '/privacy' }],
    related: ['privacy', 'refund'],
  },

  /* -------------------------------------------------------------- support */
  {
    id: 'contact-support',
    topic: 'support',
    q: 'How do I contact support?',
    variants: ['talk to a human', 'speak to someone', 'customer support', 'email support', 'contact you', 'support email', 'help me', 'need help from a person', 'reach the team', 'human agent', 'phone number', 'call you', 'live chat', 'contact us'],
    keywords: ['support', 'contact', 'human', 'email', 'person', 'agent', 'call', 'phone', 'talk'],
    a: 'Email us at **support@reelytic.com** and a real person will reply. It helps to include the report name and a short description, and a screenshot if something looks wrong, so we can get to the answer faster.\n\nPriority support is included on the higher plans.',
    actions: [{ label: 'Email support', to: 'mailto:support@reelytic.com' }],
    related: ['bug', 'feature-request'],
  },
  {
    id: 'bug',
    topic: 'support',
    q: 'I found a bug or something looks wrong',
    variants: ['report a bug', 'something is broken', 'issue', 'error message', 'not working properly', 'glitch', 'problem with the site', 'page not loading', 'i see an error', 'this looks wrong'],
    keywords: ['bug', 'broken', 'glitch', 'issue', 'error', 'wrong', 'problem'],
    a: 'Sorry about that. Please email **support@reelytic.com** with what you were doing, what you expected, and a screenshot if you can. Mention the report name if it is about a report. That is usually enough for us to find it quickly.',
    actions: [{ label: 'Email support', to: 'mailto:support@reelytic.com' }],
    related: ['contact-support', 'stuck'],
  },
  {
    id: 'feature-request',
    topic: 'support',
    q: 'Can I suggest a feature?',
    variants: ['feature request', 'i have an idea', 'suggestion', 'can you add', 'request a feature', 'would love to see', 'missing feature', 'roadmap', 'do you plan to add', 'coming soon', 'wishlist', 'i have an idea for a new feature'],
    keywords: ['suggest', 'suggestion', 'idea', 'request', 'wish', 'roadmap', 'coming soon', 'missing'],
    a: 'We would love that. Send your idea to **support@reelytic.com** and tell us what you are trying to get done, not just the feature, because that helps us build the right thing.',
    actions: [{ label: 'Email your idea', to: 'mailto:support@reelytic.com' }],
    related: ['contact-support'],
  },
  {
    id: 'why-paused',
    topic: 'reports',
    q: 'Why is my report paused?',
    variants: ['why did my report pause', 'report paused by itself', 'my report is paused and i did not pause it', 'report says paused', 'why is it paused', 'report stopped on its own', 'resume button not working', 'i cannot resume my report'],
    keywords: ['paused', 'why paused', 'resume'],
    a: 'A report shows **Paused** when it was stopped part way. The usual reasons:\n\n- you pressed **Pause**\n- you edited the sheet, which leaves the report paused so nothing runs or is charged until you are ready\n- something interrupted it, such as a connection problem\n\nPress **Resume** to carry on from where it stopped. If Resume says you need more credits, top up or edit the sheet to run fewer links. Finished links keep their results either way.',
    actions: [{ label: 'Open History', to: '/history' }],
    related: ['pause-resume', 'not-enough-credits', 'edit-sheet'],
  },
  {
    id: 'payment-issue',
    topic: 'credits',
    q: 'My payment went through but I did not get my credits',
    variants: ['payment failed', 'money deducted but no credits', 'credits not added after payment', 'paid but plan not upgraded', 'payment successful but no credits', 'transaction failed', 'payment stuck', 'charged but nothing happened', 'plan not activated'],
    keywords: ['payment failed', 'not added', 'deducted', 'transaction', 'plan not activated', 'paid but'],
    a: 'Sorry about that, let us fix it right away. Credits normally appear the moment a payment completes, so first try refreshing the page.\n\nIf they are still missing, email **support@reelytic.com** with the email on your account, the plan you chose, and the payment reference or a screenshot from your bank. We will check it and sort it out quickly.',
    actions: [{ label: 'Email support', to: 'mailto:support@reelytic.com' }],
    related: ['payment', 'refund', 'contact-support'],
  },
  {
    id: 'credit-expiry',
    topic: 'credits',
    q: 'Do unused credits carry over or expire?',
    variants: ['do credits expire', 'credit validity', 'will my credits roll over', 'unused credits', 'credits carry forward', 'what happens to leftover credits', 'credits at the end of the month', 'do credits reset every month'],
    keywords: ['expire', 'expiry', 'validity', 'roll over', 'carry over', 'leftover', 'unused'],
    a: 'The plan details on the Pricing page are the source of truth for how credits are added and how long they last. If you are not sure how it applies to your account, email us and we will give you a straight answer.',
    actions: [{ label: 'Open Pricing and plans', to: '/billing' }, { label: 'Email support', to: 'mailto:support@reelytic.com' }],
    related: ['plans', 'my-credits'],
  },
  {
    id: 'other-platforms',
    topic: 'start',
    q: 'Does it work for Stories, posts, YouTube or TikTok?',
    variants: ['does it work for tiktok', 'youtube support', 'can i analyze stories', 'instagram stories', 'carousel posts', 'photo posts', 'other platforms', 'facebook', 'twitter', 'linkedin', 'can i analyze a post', 'does it support youtube shorts'],
    keywords: ['stories', 'story', 'tiktok', 'youtube', 'shorts', 'facebook', 'twitter', 'linkedin', 'carousel', 'platform', 'platforms'],
    a: 'Reelytic is built for **Instagram Reels and creator profiles**. Stories, photo and carousel posts, and other platforms like YouTube or TikTok are not covered today.\n\nIf another platform would help your work, tell us. It genuinely shapes what we build next.',
    actions: [{ label: 'Email your idea', to: 'mailto:support@reelytic.com' }],
    related: ['report-types', 'feature-request'],
  },
  {
    id: 'integrations',
    topic: 'support',
    q: 'Is there an API or an integration with other tools?',
    variants: ['do you have an api', 'api access', 'integrations', 'zapier', 'google sheets', 'connect to my crm', 'webhook', 'automation', 'connect with other tools', 'export to google sheets', 'developer api'],
    keywords: ['api', 'integration', 'integrations', 'zapier', 'webhook', 'crm', 'automation', 'google sheets'],
    a: 'Reelytic works through the web app today, with Excel and CSV downloads you can drop into any tool. There is no public API or ready-made integration yet.\n\nIf you would like to connect Reelytic to something, tell us what and why. That helps us decide what to build.',
    actions: [{ label: 'Email your idea', to: 'mailto:support@reelytic.com' }],
    related: ['export', 'feature-request'],
  },
  {
    id: 'scheduling',
    topic: 'reports',
    q: 'Can I schedule or repeat a report automatically?',
    variants: ['schedule reports', 'recurring report', 'run weekly automatically', 'automatic reports', 'repeat every month', 'auto refresh a report', 'report every week', 'set it and forget it'],
    keywords: ['schedule', 'scheduled', 'recurring', 'weekly', 'monthly', 'automatic', 'automatically', 'repeat'],
    a: 'Not at the moment. Reports run when you start them. To track a campaign over time, run the links again when you want fresh numbers, and use a **client portal** so your client always sees the latest report.\n\nRecurring reports are a good idea, and we would like to hear how you would use them.',
    actions: [{ label: 'Email your idea', to: 'mailto:support@reelytic.com' }],
    related: ['portal', 'data-fresh', 'feature-request'],
  },
  {
    id: 'annual-billing',
    topic: 'credits',
    q: 'Is there yearly billing?',
    variants: ['can i pay yearly', 'is there an annual plan', 'annual billing', 'yearly plan', 'pay for the whole year', 'annual discount', 'yearly subscription', 'is annual cheaper', 'do you have yearly pricing'],
    keywords: ['yearly', 'annual', 'year', 'annually'],
    a: 'Yes. The Pricing page has a **Monthly / Annual** switch, and it shows you the annual option and what it costs for each plan. I will not quote numbers here in case they change, so the Pricing page is the place to check.',
    actions: [{ label: 'Open Pricing and plans', to: '/billing' }],
    related: ['plans', 'upgrade', 'which-plan-has'],
  },
  {
    id: 'highlights',
    topic: 'numbers',
    q: 'What are Top performer, Lowest performer and the Highlights card?',
    variants: ['what is top performer', 'what is lowest performer', 'what are highlights', 'highlights card', 'best performer', 'worst performer', 'what is the summary at the top of the report', 'copy summary button', 'what does copy summary do', 'who is the top creator'],
    keywords: ['top performer', 'lowest performer', 'highlights', 'best performer', 'worst performer', 'summary', 'copy summary'],
    a: 'At the top of a finished report, the **Highlights** card picks out your **top performer** and your **lowest performer** from the links in that report, with their views and engagement rate, next to the average views and average engagement rate across the whole report.\n\n**Copy summary** puts that in plain text, ready to paste into an email or message to your client.',
    related: ['columns-reel', 'er-reel', 'export'],
  },
  {
    id: 'log-out',
    topic: 'account',
    q: 'How do I log out?',
    variants: ['sign out', 'logout', 'how to log out', 'how do i sign out', 'switch account', 'log out of my account', 'change account', 'sign in as someone else'],
    keywords: ['logout', 'log out', 'sign out', 'switch account'],
    signedIn: true,
    a: 'Click your name at the bottom of the left menu, then choose **Log out**. The same menu lets you switch to a different account.',
    related: ['login-problem', 'profile-settings'],
  },
  {
    id: 'browsers',
    topic: 'start',
    q: 'Which browsers work? Can I use it offline?',
    variants: ['which browsers work', 'browser support', 'does it work on chrome', 'does it work on safari', 'firefox', 'edge browser', 'can i use it offline', 'do i need internet', 'system requirements', 'do i need to install anything', 'is there a desktop app'],
    keywords: ['browser', 'browsers', 'chrome', 'safari', 'firefox', 'edge', 'offline', 'install', 'internet'],
    a: 'Reelytic runs in your web browser, so any up-to-date browser such as Chrome, Edge, Firefox or Safari should work, on a computer, tablet or phone. There is nothing to install, and you do need an internet connection.',
    related: ['mobile', 'leave-page'],
  },
  {
    id: 'compare-creators',
    topic: 'creators',
    q: 'Can I compare creators side by side?',
    variants: ['compare two creators', 'compare creators', 'side by side comparison', 'which creator is better', 'rank creators', 'shortlist creators', 'find the best creators', 'how do i choose between creators'],
    keywords: ['comparison', 'rank', 'shortlist', 'side by side'],
    a: 'There is no side-by-side comparison screen today. The **Creator database** is the closest thing: sort and filter by engagement, followers and average views, and the green badge marks creators above 2% engagement. A **Profile report** on a shortlist also puts creators in one table.',
    actions: [{ label: 'Open Creators', to: '/creators' }],
    related: ['creators-filter', 'creators-er-badge', 'report-types'],
  },
  {
    id: 'missing-followers',
    topic: 'numbers',
    q: 'Why is a creator\'s follower count missing or 0?',
    variants: ['why are some creators missing followers', 'followers not showing', 'follower count is zero', 'followers blank', 'no follower count', 'followers missing in profile report', 'why is followers 0'],
    keywords: ['missing followers', 'followers not showing', 'follower count'],
    a: 'Follower counts come from the creator\'s public profile. If we could not read one for a creator, the number shows as blank or 0, and their engagement rate cannot be worked out properly either, since it divides by followers.\n\nRunning that creator again later often fills it in. If it keeps happening for an active public account, email us the profile link.',
    related: ['er-zero', 'couldnt-fetch', 'contact-support'],
  },
  {
    id: 'single-creator',
    topic: 'start',
    q: 'How do I run a report for just one creator or one Reel?',
    variants: ['how to run report for one creator', 'analyze one reel', 'just one link', 'single profile', 'check one creator', 'quick check on a single reel', 'can i run one link', 'test with one link', 'only one link'],
    keywords: ['one', 'single', 'just one', 'only one'],
    a: 'Choose **Profile Report** for a creator or **Reel Report** for a Reel, use **Paste links instead**, and paste that one link. It works exactly like a bigger report, and you are only charged for what succeeds, which is one Reel or one creator.',
    actions: [{ label: 'New Profile report', to: '/profiles' }, { label: 'New Reel report', to: '/reels' }],
    related: ['paste-links', 'credit-cost', 'first-report'],
  },
  {
    id: 'columns-kept',
    topic: 'reports',
    q: 'Will my own columns be kept in the report?',
    variants: ['my file has 3 columns will they be kept', 'do you keep my columns', 'extra columns in my sheet', 'will my original columns stay', 'campaign name column', 'do you remove my other columns', 'my own data columns', 'extra data in excel'],
    keywords: ['columns', 'column', 'kept', 'original columns', 'my columns'],
    a: 'Yes. Your own columns stay exactly where you put them, and the new numbers (views, likes, comments, engagement rate and so on) are added alongside them, in the report and in the Excel or CSV download. In the preview you can rename or reorder your columns before you start.',
    related: ['preview-screen', 'export', 'file-formats'],
  },
  {
    id: 'numbers-change-rerun',
    topic: 'numbers',
    q: 'Why did the numbers change when I ran the same links again?',
    variants: ['why did numbers change when i reran', 'numbers are different this time', 'rerun gives different results', 'results changed', 'why are the views higher now', 'same links different numbers', 'numbers not the same as last week', 'figures updated'],
    keywords: ['reran', 'rerun', 'again', 'different', 'changed', 'higher', 'updated'],
    a: 'Because Instagram numbers keep moving. Every report is a snapshot from the moment it ran, so a Reel that gained views since last time will show more views now. That is a good reason to run the links again when you want fresh figures for a client.',
    related: ['data-fresh', 'numbers-differ'],
  },
  {
    id: 'failed-but-complete',
    topic: 'problems',
    q: 'My report says Complete but some links failed',
    variants: ['report says complete but some failed', 'complete with failures', 'finished but some rows failed', 'report done but errors', 'how can it be complete if links failed', 'some links failed in a finished report'],
    keywords: ['complete', 'finished', 'done', 'some failed', 'errors'],
    a: '**Complete** means every link has been tried. Some can still show **Couldn\'t fetch**, for example private accounts or a Reel that no longer exists. Those are not charged, and you can press **Retry failed** to try just those again.',
    related: ['couldnt-fetch', 'retry-failed', 'when-charged'],
  },
  {
    id: 'account-sharing',
    topic: 'premium',
    q: 'Can two people use the same account?',
    variants: ['can two people use one account', 'share my login', 'my colleague wants access', 'multiple people one workspace', 'can my assistant use it', 'can my manager log in too', 'how do i invite my manager', 'add another user'],
    keywords: ['two people', 'colleague', 'manager', 'assistant', 'share login', 'another user'],
    a: 'The best way is to invite them as a **team member** from **Settings**, so everyone has their own login and the same workspace, reports and credits. Please avoid sharing one password between people.',
    actions: [{ label: 'Open Settings', to: '/settings' }],
    related: ['team', 'team-member'],
  },
  {
    id: 'empty-profile-report',
    topic: 'problems',
    q: 'Why is my profile report empty or showing no reels for a creator?',
    variants: ['why is my profile report empty', 'no reels for this creator', 'profile shows nothing', 'zero reels analyzed', 'profile report has no data', 'creator has no reels', 'profile row is blank'],
    keywords: ['empty', 'no reels', 'nothing', 'blank', 'zero reels'],
    a: 'A creator row comes back empty when there was nothing usable to analyze: the account is **private**, it has **no Reels** yet, or all of its recent posts were pinned or had no view data. Those rows show **Couldn\'t fetch** and are **not charged**.\n\nOpen the row\'s note or hover the chip to see the specific reason.',
    related: ['couldnt-fetch', 'private-accounts', 'reels-analyzed'],
  },
];

/* ---------------------------------------------------------------- chit chat
   Small talk lives apart from the entries so it never appears in "did you
   mean" suggestions, and so it is matched first and cheaply. */
export const SMALL_TALK = [
  {
    id: 'greet',
    match: ['hi', 'hello', 'hey', 'hii', 'hiii', 'hola', 'yo', 'good morning', 'good afternoon', 'good evening', 'namaste', 'sup', 'hey there', 'hi there', 'hlo', 'helo', 'hiya', 'good day'],
    reply: (ctx) => `Hi${ctx && ctx.user && ctx.user.name ? ` ${String(ctx.user.name).split(' ')[0]}` : ''}! What can I help you with? You can ask me anything about Reelytic, or pick a topic below.`,
  },
  {
    id: 'thanks',
    match: ['thanks', 'thank you', 'thx', 'ty', 'thanks a lot', 'thank you so much', 'great thanks', 'cheers', 'awesome thanks', 'appreciate it', 'perfect thanks'],
    reply: () => 'Happy to help! Anything else you would like to know?',
  },
  {
    id: 'bye',
    match: ['bye', 'goodbye', 'see you', 'cya', 'later', 'that is all', 'thats all', 'nothing else', 'no thanks', 'nope', 'all good', 'done'],
    reply: () => 'Great, I am here whenever you need me. Good luck with your reports!',
  },
  {
    id: 'who',
    match: ['who are you', 'what are you', 'your name', 'are you a bot', 'are you human', 'are you real', 'are you ai', 'are you chatgpt', 'are you a robot', 'are you a person', 'what is your name', 'who am i talking to', 'is this a human', 'who made you', 'who built you', 'who created you'],
    reply: () => 'I am the Reelytic assistant, a built-in help guide built by the Reelytic team. I am not a person, and I answer from Reelytic\'s own help library, so what I tell you is what we actually do. If you would rather talk to a human, just say so and I will point you to the team.',
  },
  {
    id: 'capabilities',
    match: ['what can you do', 'help', 'help me', 'what can i ask', 'how can you help', 'what do you know', 'menu', 'options', 'commands', 'how do i use you', 'what can i ask you'],
    reply: () => 'I can explain how any part of Reelytic works, help you fix a problem, tell you what a number means, and take you to the right page. Try things like "how are credits charged", "why did my link fail" or "take me to History". Or pick a topic below.',
  },
  {
    id: 'ok',
    match: ['ok', 'okay', 'k', 'cool', 'nice', 'got it', 'alright', 'understood', 'i see', 'sure', 'fine', 'great', 'good', 'sounds good', 'makes sense'],
    reply: () => 'Great. Is there anything else I can help with?',
  },
  {
    id: 'praise',
    match: ['you are great', 'you are amazing', 'good bot', 'nice bot', 'well done', 'love it', 'you are smart', 'brilliant', 'excellent', 'you are helpful', 'this is helpful'],
    reply: () => 'That is kind of you, thank you! If there is anything else, I am right here.',
  },
  {
    id: 'rude',
    match: ['stupid', 'useless', 'idiot', 'dumb', 'you suck', 'worst bot', 'rubbish', 'trash', 'garbage', 'this is bad', 'not helpful'],
    reply: () => 'I am sorry I have not been much help. Please email **support@reelytic.com** and a real person will take it from here, or try asking me again in different words.',
  },
];
