import React, { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/*
  The guided product tour.

  Seven stops that follow the order an agency actually works in: read the
  report, take the numbers, brand it, send it, set your logo once, see
  where every creator you analyze ends up automatically, done.

  Rules, each one written because a previous version broke it:

  1. NEVER MOVE SOMEONE WITHOUT SAYING SO. A step that lives on another page
     first shows a card naming where it is about to go and waits for a click.
     The old version yanked the user to Settings mid-sentence, which is what
     made it feel like the app was misbehaving rather than helping.

  2. NEVER LEAVE SOMEONE WITHOUT AN EXIT OR A POSITION. The step counter,
     Back and End tour are on screen for the whole run. "End tour" stops
     instantly, no confirmation.

  3. NEVER STRAND SOMEONE. The last step returns to the report they started
     on, so the tour ends where it began instead of abandoning them three
     pages away.

  4. NEVER COVER WHAT YOU ARE POINTING AT. See placeCard: the card is tried
     below, above, then beside the target, and only falls back to a far
     corner when genuinely nothing fits. A tooltip sitting on top of the
     thing it describes is worse than no tooltip.

  5. NEVER MOVE THE PAGE UNDER SOMEONE. Scrolling is frozen for the duration
     (see the scroll-lock effect) so the layout cannot drift while a card and
     ring are anchored to it. We still scroll programmatically between steps,
     but only while the card is faded out, so the movement is never seen
     mid-flight.

  Interaction is blocked except for the highlighted control: the dim layer
  swallows clicks, and the target is raised above it so it stays usable.
  That is what keeps a guided tour guided.

  State is keyed per user (see storageKey) because localStorage is per
  browser, not per account -- switching accounts used to inherit a
  half-finished tour and float a tooltip over the login form.
*/

const CHAPTERS = ['Your report', 'Your report', 'The client version', 'The client version', 'Your branding', 'Your creators', 'Your team', 'Client portals', 'Done'];

const STEPS = [
  {
    id: 'report',
    // 'report' rather than a bare '/reels': travelling must land on the
    // sample itself, and plain /reels is an empty upload screen.
    route: 'report',
    announce: 'Your sample report is ready. Let us open it and look at it together.',
    announceCta: 'Open my sample report',
    target: '[data-tour="highlights"]',
    title: 'Your finished report',
    body: 'Every creator in the campaign, with a plain-English summary at the top and the best and worst performer picked out for you.',
  },
  {
    id: 'export',
    route: 'report',
    target: '[data-tour="download-excel"]',
    title: 'Take the numbers',
    body: 'Download it as Excel and your own columns come back exactly where you put them. Nothing to reformat before you send it on.',
  },
  {
    id: 'branded',
    route: 'branded',
    announce: 'Next, the version your client actually receives. This is the button that opens it.',
    announceCta: 'Open the client report',
    /*
      The travel card points at the control that does the travelling, instead
      of floating in the middle of the screen. Saying "we will open the client
      report now" without showing which button does it teaches nothing: next
      time they are on their own, they still would not know where it lives.
    */
    announceTarget: '[data-tour="preview-branded"]',
    target: '[data-tour="branded-sheet"]',
    title: 'What your client receives',
    body: 'The same numbers as a clean document carrying your agency name. No login, no attachment, nothing that looks like a tool.',
  },
  {
    id: 'share',
    route: 'branded',
    target: '[data-tour="share-link"]',
    title: 'Send it as a link',
    body: 'Your client opens this without an account. You choose when it stops working, and you can see whether they read it.',
    hint: 'Try clicking it, or press Next.',
  },
  {
    id: 'branding',
    route: '/settings',
    announce: 'That report carried your branding. Here is where you set it, once.',
    announceCta: 'Show me settings',
    target: '[data-tour="branding-card"]',
    title: 'Your logo, your colours',
    body: 'Add your logo and accent colour here and every report you produce from now on uses them automatically.',
  },
  {
    /*
      Shown to EVERY new account, whatever plan they land on -- unlike every
      step above (which lives on the sample report the account already has),
      this is the one paid feature in the whole tour a free/unlimited signup
      cannot actually use yet. That is deliberate, not an oversight: someone
      who never sees a feature never wants it, and the locked view (see
      Creators.jsx's data-tour="creators-page" on BOTH its locked and
      unlocked render branches) makes exactly the same "here's what you'd
      get" case Premium.jsx's LockedFeatureButton already makes everywhere
      else in the app. An entitled account sees the real page instead.
    */
    id: 'creators',
    route: '/creators',
    announce: 'One more thing: every creator you have ever analyzed lives in one place, automatically.',
    announceCta: 'Show me the creator database',
    target: '[data-tour="creators-page"]',
    title: 'Your creator database',
    body: 'Every creator from every report you run, deduped and searchable: follower size, engagement, and which campaigns they showed up in, all filled in automatically as reports finish. Available on Starter, Pro and Agency.',
  },
  {
    /*
      Same "shown to every account regardless of plan" reasoning as the
      creators step above, but deliberately no `target`. TeamCard.jsx's
      locked-overlay branch renders the whole real (dimmed) card underneath
      it, seat list and invite form included, which made this ring a very
      tall element and pushed placeCard into its corner-docked fallback,
      landing on top of the tour's own nav bar. An announcement-only card
      (same shape as the closing 'done' step, which has never carried a
      target either) says the same thing without measuring anything on the
      page, and is the safer choice for a step that's really just "by the
      way, this exists" rather than "look at this exact control".
    */
    id: 'team',
    route: '/settings',
    announce: 'One more thing: you can bring your team into this same workspace.',
    announceCta: 'Show me Settings',
    title: 'Bring your team in',
    body: 'Look for the Team card on this page. Invite teammates by email and they share this workspace: the same reports, campaigns, credits and creator database. You stay the only one who manages billing. Available on Starter, Pro and Agency.',
  },
  {
    // No target for the same reason as the team step above -- a specific
    // campaign's portal icon does not exist yet on a brand new account
    // with no campaigns, and there's nothing else on this page reliably
    // sized to ring instead.
    id: 'portal',
    route: '/history',
    announce: 'Last thing: you can give a client a living link to a whole campaign.',
    announceCta: 'Show me History',
    title: 'A living link for your client',
    body: 'Every campaign gets its own portal icon next to its delete button. Turn it on and your client gets one link that keeps showing the latest numbers as you add more reports, no login needed on their end. Available on Starter, Pro and Agency.',
  },
  {
    id: 'done',
    route: 'report',
    // The final step lives back on the report, so it travels like any other
    // off-page step. Without these two lines it rendered an empty card with a
    // blank button, which is exactly how the tour used to appear to die.
    announce: 'That is the tour. We will drop you back on your sample report.',
    announceCta: 'Back to my report',
    title: 'That is the whole loop',
    body: 'Upload a sheet, check the numbers, brand it, send the link. Your sample stays here to explore, and it cost you nothing. Run the same thing on a real campaign whenever you are ready.',
    final: true,
  },
];

const storageKey = (username) => `rl-tour:${username || 'anon'}`;

/*
  DemoGuide is mounted for the whole signed-in session and reads its state
  from localStorage. Writing that key is therefore not enough on its own: a
  mounted component never notices, so starting the tour from the welcome modal
  or the checklist set the key, navigated, and showed nothing at all. This
  event is how a writer tells the live instance to re-read.
*/
const TOUR_EVENT = 'rl-tour-changed';

const announceChange = () => {
  try { window.dispatchEvent(new CustomEvent(TOUR_EVENT)); } catch (e) { /* older browsers */ }
};

export const startDemoGuide = (jobId, username) => {
  try {
    // Where the user was standing when they started. Captured here, before
    // the caller navigates to the sample, so that ending the tour can put
    // them back rather than abandoning them on a report they did not open.
    const returnTo = window.location.pathname + window.location.search;
    localStorage.setItem(storageKey(username), JSON.stringify({
      step: 0,
      jobId: String(jobId || ''),
      returnTo,
    }));
  } catch (e) { /* private mode */ }
  announceChange();
};

export const clearDemoGuide = (username) => {
  try { localStorage.removeItem(storageKey(username)); } catch (e) { /* private mode */ }
  announceChange();
};

function readState(username) {
  try {
    const raw = localStorage.getItem(storageKey(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Number.isFinite(parsed.step) ? parsed : null;
  } catch (e) { return null; }
}

const CARD_W = 340;
const MIN_W = 236;  // narrowest the card may shrink to and still read well
const MOBILE_BP = 640;
const GAP = 14;   // breathing room between the card and what it points at
const EDGE = 16;  // minimum distance from the viewport edge
const BAR = 76;   // reserved strip along the bottom for the docked tour bar

/*
  Chooses where the card sits so that it never lands on top of its own target.

  Below first (the reading order everyone expects), then above, then beside it
  at full width. Failing all of those, the card SHRINKS to fit whichever side
  gutter is wider: a tall panel that fills the column still leaves the sidebar
  free, and a narrower card sitting cleanly in that space beats a full-width
  one straddling the edge of the panel. Clipping the left edge of a block of
  text ruins every line of it, however little total area is covered.

  Only when even the gutters are too narrow does it dock in a corner, choosing
  the corner that covers the least of the target.

  Returns both the position and the width to render at.
*/
function placeCard(rect, vp, cardH) {
  if (!rect) return { style: { right: EDGE, bottom: BAR + 8 }, width: CARD_W };

  const clampLeft = (l) => Math.min(Math.max(EDGE, l), Math.max(EDGE, vp.w - CARD_W - EDGE));
  const clampTop = (t) => Math.min(Math.max(EDGE, t), Math.max(EDGE, vp.h - BAR - cardH));
  const centredLeft = clampLeft(rect.left + rect.width / 2 - CARD_W / 2);
  const full = (style) => ({ style, width: CARD_W });

  const below = rect.top + rect.height + GAP;
  if (below + cardH <= vp.h - BAR) return full({ top: below, left: centredLeft });

  const above = rect.top - GAP - cardH;
  if (above >= EDGE) return full({ top: above, left: centredLeft });

  const right = rect.left + rect.width + GAP;
  if (right + CARD_W <= vp.w - EDGE) return full({ top: clampTop(rect.top), left: right });

  const left = rect.left - GAP - CARD_W;
  if (left >= EDGE) return full({ top: clampTop(rect.top), left });

  // Squeeze into the wider gutter rather than overlap.
  const leftRoom = rect.left - GAP - EDGE;
  const rightRoom = vp.w - (rect.left + rect.width) - GAP - EDGE;
  const room = Math.max(leftRoom, rightRoom);
  if (room >= MIN_W) {
    const width = Math.min(CARD_W, room);
    const style = leftRoom >= rightRoom
      ? { left: EDGE, top: clampTop(rect.top) }
      : { right: EDGE, top: clampTop(rect.top) };
    return { style, width };
  }

  const corners = [
    { style: { right: EDGE, bottom: BAR + 8 }, box: { left: vp.w - EDGE - CARD_W, top: vp.h - BAR - 8 - cardH } },
    { style: { left: EDGE, bottom: BAR + 8 }, box: { left: EDGE, top: vp.h - BAR - 8 - cardH } },
    { style: { right: EDGE, top: EDGE }, box: { left: vp.w - EDGE - CARD_W, top: EDGE } },
    { style: { left: EDGE, top: EDGE }, box: { left: EDGE, top: EDGE } },
  ];
  const covered = ({ left: l, top: t }) => {
    const w = Math.min(l + CARD_W, rect.left + rect.width) - Math.max(l, rect.left);
    const h = Math.min(t + cardH, rect.top + rect.height) - Math.max(t, rect.top);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const bestCorner = corners.reduce((best, c) => (covered(c.box) < covered(best.box) ? c : best), corners[0]);
  return { style: bestCorner.style, width: CARD_W };
}

/*
  WHEN THE TOUR SHOWS ITSELF (why it feels smooth now)

  The tour used to draw its dim layer and card the instant a step began, and to
  hunt for its target on a 200ms timer. On a slow phone or connection that meant
  a dimmed page with a spinner still turning underneath, a highlight that
  arrived seconds after the card, and dead moments between steps where the
  screen was dark and empty. It read as cheap because it was showing itself
  before the app was ready.

  Now what is on screen is always one complete, consistent snapshot: a step, its
  highlight and its card, all measured against a page that has finished
  loading and stopped moving. Rules:

    - Nothing is shown while the page is still loading (a loader or skeleton is
      on screen). The dim layer, card and highlight fade in together once the
      page has settled. A stuck spinner can hold this back for 8 seconds at
      most, so it can never hide the tour for good.
    - Between two steps on the same page the previous snapshot stays put until
      the next one is measured and steady (a couple of frames), then the
      highlight glides to its new home and the card swaps. There is never an
      empty dimmed screen between steps.
    - Changing page hides the snapshot immediately; the new page's snapshot
      fades in when it is ready.
    - Measuring runs every frame until steady instead of every 200ms, so a step
      lands in tens of milliseconds, not several hundred.
    - The pages later steps need are fetched quietly in the background as soon
      as the tour starts, so travelling to them is instant.
*/

const BUSY_MAX_MS = 8000;   // a spinner that never ends must not hide the tour forever
const GIVE_UP_MS = 4500;    // target never appeared: show the card docked so it can still be read
const QUIET_MS = 160;       // the page must stay free of loaders this long: one loader often hands over to the next
const SETTLE_FRAMES = 2;    // the target must hold still for this many frames before we trust it
const FOLLOW_MS = 180;      // once shown, how often to re-measure in case the page reflows

// True while any loader or skeleton is on screen, which is how every page in
// this app says "I am still loading".
const pageIsBusy = () => !!document.querySelector('.rl-loader-mark, .rl-skel');

const sameRect = (a, b) => (!a && !b) || (!!a && !!b
  && Math.abs(a.top - b.top) < 1 && Math.abs(a.left - b.left) < 1
  && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1);

export function DemoGuide({ username }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState(() => readState(username));
  // The snapshot currently on screen: { step, needsTravel, path, rect, gaveUp }.
  // Display is driven by this, never by the requested step, so what the person
  // sees is always internally consistent.
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(false);
  // Set the moment someone presses a "take me there" button, so the tour fades
  // away with the click instead of lingering over the page it is leaving.
  const [leaving, setLeaving] = useState(false);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [cardH, setCardH] = useState(220);
  const cardRef = useRef(null);
  const raised = useRef(null);
  const lastRing = useRef(null);

  const step = state ? state.step : -1;
  const current = step >= 0 && step < STEPS.length ? STEPS[step] : null;
  const isMobile = vp.w <= MOBILE_BP;

  // Mirrors of values the measure loop needs. Read through refs so that a
  // resize or a card remeasure does not tear down and restart the loop,
  // which would re-trigger the scroll and jerk the page.
  const cardHRef = useRef(cardH);
  const isMobileRef = useRef(isMobile);
  cardHRef.current = cardH;
  isMobileRef.current = isMobile;

  const routeFor = useCallback((s) => {
    if (!s) return null;
    if (s.route === 'branded') return state && state.jobId ? `/reports/${state.jobId}/branded` : null;
    if (s.route === 'report') return state && state.jobId ? `/reels?job=${state.jobId}` : '/reels';
    return s.route;
  }, [state]);

  const onRightPage = current
    ? (() => {
      const want = routeFor(current);
      if (!want) return true;
      return location.pathname === want.split('?')[0] || location.pathname.startsWith(want.split('?')[0]);
    })()
    : false;

  const needsTravel = !!current && !onRightPage;

  /*
    What the requested step is pointing at right now.

    A step has two anchors: the one it highlights once you are on the right
    page, and (optionally) the control that gets you there. Resolving both
    through one value means the measuring, the ring and the placement all work
    the same whether the card is explaining something or offering to travel.
  */
  const activeTarget = current
    ? (needsTravel ? (current.announceTarget || null) : (current.target || null))
    : null;

  const shownStep = shown ? STEPS[shown.step] : null;
  const rect = shown ? shown.rect : null;
  const visible = !!shown && !busy && !leaving && shown.path === location.pathname;

  // Derived here rather than at render time because the card-measuring layout
  // effect below needs the width in its dependencies, and hooks cannot read a
  // value defined after them.
  const placed = isMobile
    ? { style: { left: 12, right: 12, bottom: 12 }, width: null }
    : placeCard(rect, vp, cardH);
  const place = placed.style;
  const cardWidth = placed.width;

  // Release the raised element whenever the step changes or the tour ends,
  // so a highlighted control never keeps an orphan z-index.
  const release = useCallback(() => {
    if (raised.current) {
      raised.current.classList.remove('rl-tour-raised');
      raised.current = null;
    }
  }, []);

  /*
    Ending the tour puts the user back where they were before it started.

    Previously it just dismissed the overlay and left them standing on the
    sample report, three pages from where they began, wondering what they were
    now looking at. The tour borrowed their place; it should give it back.
    Falls back to the dashboard if we never recorded one.
  */
  const end = useCallback(() => {
    const back = state && state.returnTo;
    release();
    clearDemoGuide(username);
    setState(null);
    setShown(null);
    if (back && back !== window.location.pathname + window.location.search) {
      navigate(back);
    } else if (!back) {
      navigate('/dashboard');
    }
  }, [release, username, state, navigate]);

  // The old snapshot stays on screen until the next one is measured, so this
  // only records where the person is now; it never blanks the screen.
  const goTo = useCallback((n) => {
    release();
    if (n >= STEPS.length || n < 0) { end(); return; }
    setState((prev) => {
      const next = { ...(prev || {}), step: n };
      try { localStorage.setItem(storageKey(username), JSON.stringify(next)); } catch (e) { /* private mode */ }
      return next;
    });
  }, [release, end, username]);

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /*
    Measure the card so placement can avoid the target using its real height
    rather than a guess.

    Deliberately scoped to "once per step, per viewport". Running it after
    every render (no dependency array) is what it looked like it wanted to be,
    but the card's height feeds placement and placement feeds the next render,
    so the two can chase each other and lock the renderer up. Measuring only
    when the content or the viewport actually changed removes the cycle.
  */
  const shownKey = shown ? `${shown.step}-${shown.needsTravel ? 't' : 'p'}` : '';
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h && Math.abs(h - cardH) > 4) setCardH(h);
    // cardWidth is included because a narrower card is a taller one, and the
    // vertical clamp needs the real height. It is derived from the target and
    // the viewport only, never from cardH, so this cannot feed back on itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, isMobile, vp.w, vp.h, cardWidth]);

  /*
    Freeze the page for the duration of the tour.

    Deliberately done by refusing scroll events rather than setting
    overflow:hidden on the body: removing the scrollbar reflows the entire
    layout sideways the instant the tour opens, which is exactly the kind of
    jolt this is supposed to prevent. Refusing the events leaves every pixel
    where it was. Programmatic scrolling still works, because scrollIntoView
    does not dispatch these events.
  */
  useEffect(() => {
    if (!current) return undefined;
    const insideCard = (t) => !!cardRef.current && t instanceof Node && cardRef.current.contains(t);
    const block = (e) => { if (!insideCard(e.target)) e.preventDefault(); };
    const blockKeys = (e) => {
      const keys = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'];
      if (keys.includes(e.key) && !insideCard(e.target)) e.preventDefault();
    };
    window.addEventListener('wheel', block, { passive: false });
    window.addEventListener('touchmove', block, { passive: false });
    window.addEventListener('keydown', blockKeys);
    return () => {
      window.removeEventListener('wheel', block);
      window.removeEventListener('touchmove', block);
      window.removeEventListener('keydown', blockKeys);
    };
  }, [current]);

  /*
    Warm the pages later steps travel to, so "Show me..." does not also pay for
    a code download on top of the page's own data.

    Only while a card is on screen and being read, and one file at a time. The
    first version started them all the moment the tour began, which on a slow
    connection competed with the page the person was actually waiting for and
    made things slower, not faster. These are the same modules App.jsx
    lazy-loads, so this only warms the cache.
  */
  // Lets the rest of the app (the help bubble) stay out of the way while the
  // tour is on screen.
  const touring = !!current;
  useEffect(() => {
    if (!touring) return undefined;
    document.documentElement.setAttribute('data-tour-active', '');
    return () => document.documentElement.removeAttribute('data-tour-active');
  }, [touring]);

  const reading = visible;
  useEffect(() => {
    if (!reading) return undefined;
    let cancelled = false;
    const loaders = [
      () => import('../pages/ReportEngine'),
      () => import('../pages/BrandedReport'),
      () => import('../pages/Settings'),
      () => import('../pages/Creators'),
      () => import('../pages/History'),
    ];
    const run = async () => {
      for (const load of loaders) {
        if (cancelled) return;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((res) => window.setTimeout(res, 600));
        if (cancelled) return;
        // eslint-disable-next-line no-await-in-loop
        try { await load(); } catch (e) { /* the real navigation will retry */ }
      }
    };
    run();
    return () => { cancelled = true; };
  }, [reading]);

  /*
    The measuring loop, and the only thing that ever puts a snapshot on screen.

    Runs every animation frame until the target has held still for a couple of
    frames, then commits. After that it keeps watching at a relaxed pace so a
    page that reflows late (data arriving, fonts settling) carries the
    highlight with it instead of leaving it behind.
  */
  useEffect(() => {
    if (!current) return undefined;
    const startedAt = performance.now();
    let raf = 0;
    let stopped = false;
    let scrolls = 0;
    let held = 0;
    let lastKey = '';
    let committed = false;
    let lastFollow = 0;
    let lastBusy = startedAt - QUIET_MS;   // not loading at the start means no wait at all
    const path = location.pathname;

    const commit = (r, gaveUp) => {
      committed = true;
      setLeaving(false);
      setShown((prev) => {
        if (prev && prev.step === step && prev.needsTravel === needsTravel && prev.path === path
          && sameRect(prev.rect, r) && prev.gaveUp === !!gaveUp) return prev;
        return { step, needsTravel, path, rect: r, gaveUp: !!gaveUp };
      });
    };

    const frame = (now) => {
      if (stopped) return;
      if (pageIsBusy() && now - startedAt < BUSY_MAX_MS) lastBusy = now;
      const loading = now - lastBusy < QUIET_MS;
      setBusy((b) => (b === loading ? b : loading));
      if (loading) {
        held = 0;
        raf = requestAnimationFrame(frame);
        return;
      }

      // Nothing to point at (a closing step, or a travel card with no anchor of
      // its own): the page has settled, so the card can go straight up.
      if (!activeTarget) {
        commit(null, false);
        return;
      }

      const el = document.querySelector(activeTarget);
      if (!el) {
        if (!committed && now - startedAt > GIVE_UP_MS) commit(null, true);
        raf = requestAnimationFrame(frame);
        return;
      }

      if (raised.current !== el) {
        release();
        el.classList.add('rl-tour-raised');
        raised.current = el;
      }
      const r = el.getBoundingClientRect();
      const tall = r.height >= window.innerHeight * 0.8;
      /*
        Scroll with a purpose, rather than just centring the target.

        Centring looks tidy but spends the whole viewport on the target, which
        on a laptop-height window left no room above or below for the card and
        forced it to overlap the very thing it points at. So we work out the
        highest position that still leaves a card-sized gap underneath, and put
        the target there: as close to centred as we can afford, and no lower.

        Up to two corrections per step. One is not always enough: a page that
        finishes loading its data after we have scrolled re-renders and drops
        the scroll position back to the top, leaving the target parked off
        screen. Two is enough to recover from that, and bounded so the loop can
        never fight the page.
      */
      if (scrolls < 2) {
        const headroom = isMobileRef.current ? 68 : EDGE;
        const latest = window.innerHeight - BAR - cardHRef.current - GAP - r.height;
        // A target taller than the screen can never be framed, but it still has
        // to be brought into view: skipping the scroll entirely left the
        // Settings branding card sitting below the fold, highlighted and
        // completely invisible.
        const wantTop = (!tall && latest >= headroom)
          ? Math.min(Math.max(headroom, (window.innerHeight - r.height) / 2), latest)
          : headroom;
        const delta = r.top - wantTop;
        // The follow-up correction uses a slacker threshold so normal settling
        // never counts as drift worth re-scrolling for.
        if (Math.abs(delta) > (scrolls === 0 ? 4 : 24)) {
          scrolls += 1;
          held = 0;
          // Instant, not smooth: the card and ring are positioned from this
          // measurement, so animating the page underneath them would mean every
          // frame is measured against a position that has already moved on.
          // The page jumps before the step is ever shown, so nothing is seen.
          window.scrollBy(0, delta);
          raf = requestAnimationFrame(frame);
          return;
        }
      }

      const box = { top: r.top, left: r.left, width: r.width, height: r.height };
      const key = [r.top, r.left, r.width, r.height].map(Math.round).join(',');
      if (key === lastKey) held += 1; else { held = 0; lastKey = key; }

      if (!committed) {
        if (held >= SETTLE_FRAMES) commit(box, false);
      } else if (now - lastFollow > FOLLOW_MS) {
        lastFollow = now;
        commit(box, false);
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      release();
    };
  }, [current, activeTarget, step, needsTravel, release, location.pathname, location.search]);

  useEffect(() => () => release(), [release]);

  // Pick up a tour started elsewhere in this same session (welcome modal,
  // Getting Started checklist, Settings' replay) without needing a reload.
  useEffect(() => {
    const sync = () => setState(readState(username));
    window.addEventListener(TOUR_EVENT, sync);
    return () => window.removeEventListener(TOUR_EVENT, sync);
  }, [username]);

  // Keyboard: Escape leaves, the arrow keys move. Only while the tour is
  // actually on screen, so it never steals keys from the page underneath.
  useEffect(() => {
    if (!current || !visible) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { end(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, visible, end]);

  if (!current) return null;

  /*
    Only a target that genuinely cannot fit on screen is unringable, where the
    outline degenerates into two stray lines down the viewport edges. This
    used to trigger at 80% of the viewport height, which silently dropped the
    ring from panels that fit perfectly well (the Settings branding card is
    523px in a 575px window) and left the step with nothing highlighted.
  */
  const tall = !!rect && rect.height > vp.h - EDGE * 2;
  const showRing = !!rect && !tall;
  // Keep the highlight mounted (faded out) when a step has none, so it does not
  // blink out abruptly while the dim layer stays.
  if (showRing) lastRing.current = rect;
  const ringBox = showRing ? rect : lastRing.current;

  const travel = () => {
    const want = routeFor(shownStep);
    if (want) {
      if (location.pathname !== want.split('?')[0]) setLeaving(true);
      navigate(want);
    }
  };

  const progress = (
    <>
      <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
        Step {step + 1} of {STEPS.length}
      </span>
      <div style={{ display: 'flex', gap: 3 }} aria-hidden="true">
        {STEPS.map((_, i) => (
          <span
            key={i}
            style={{
              width: i === step ? 18 : 6, height: 6, borderRadius: 3,
              background: i <= step ? 'var(--accent)' : 'var(--border-strong)',
              transition: 'all 240ms ease',
            }}
          />
        ))}
      </div>
    </>
  );

  const controls = (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {step > 0 && (
        <button type="button" className="btn btn-secondary" style={{ height: 28, fontSize: 'var(--fs-xs)', padding: '0 var(--s3)' }} onClick={() => goTo(step - 1)}>
          Back
        </button>
      )}
      <button
        type="button"
        onClick={end}
        style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 'var(--fs-xs)', cursor: 'pointer', padding: '0 var(--s2)', whiteSpace: 'nowrap' }}
      >
        End tour
      </button>
    </div>
  );

  return (
    <>
      {/* Dim layer. Swallows every click so the only thing the user can
          interact with is the highlighted control (raised above it) and the
          tour's own controls. Fades with the rest of the snapshot, and lets
          clicks through while the page underneath is still loading. */}
      <div
        onClick={(e) => e.stopPropagation()}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, background: 'rgba(6,8,11,0.62)', zIndex: 1290,
          opacity: visible ? 1 : 0, pointerEvents: visible ? 'auto' : 'none',
          transition: 'opacity 260ms ease',
        }}
      />

      {ringBox && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed', zIndex: 1296, pointerEvents: 'none',
            top: ringBox.top - 6, left: ringBox.left - 6,
            width: ringBox.width + 12, height: ringBox.height + 12,
            borderRadius: 10,
            boxShadow: '0 0 0 2px var(--accent), 0 0 22px 2px color-mix(in srgb, var(--accent) 35%, transparent)',
            opacity: visible && showRing ? 1 : 0,
            // The highlight glides from one target to the next, since it is the
            // same element across steps on a page; it only fades in and out
            // when the page changes or loads.
            transition: 'top 320ms cubic-bezier(.4,0,.2,1), left 320ms cubic-bezier(.4,0,.2,1), width 320ms cubic-bezier(.4,0,.2,1), height 320ms cubic-bezier(.4,0,.2,1), opacity 260ms ease',
          }}
        />
      )}

      {/* The outer box carries position and visibility; the inner card carries
          the arrival animation. They are separate because a finished CSS
          animation outranks an inline opacity, which would keep a "hidden"
          card visible. The key gives every step a fresh card, so a new step
          pops in instead of the old card sliding to its next position. */}
      {shown && shownStep && (
        <div
          style={{
            position: 'fixed', zIndex: 1300,
            width: isMobile ? 'auto' : cardWidth,
            maxWidth: isMobile ? 'none' : 'calc(100vw - 32px)',
            ...place,
            opacity: visible ? 1 : 0,
            pointerEvents: visible ? 'auto' : 'none',
            // Position changes apply instantly, deliberately: the card's own
            // height feeds its placement, so the first paint uses an estimated
            // height and the real one lands a frame later. Eased, that reads as
            // the card settling after it has arrived; instant, it happens
            // inside the entrance fade and nobody sees it. Only opacity eases.
            transition: 'opacity 240ms ease',
          }}
        >
          <div
            key={shownKey}
            ref={cardRef}
            role="dialog"
            aria-label={shownStep.title}
            className="card rl-tour-pop"
            style={{ padding: 'var(--s5)', boxShadow: 'var(--shadow-lg)', transition: 'none' }}
          >
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', color: 'var(--accent)', marginBottom: 8 }}>
              {CHAPTERS[shown.step].toUpperCase()}
            </div>

            {shown.needsTravel ? (
              <>
                <p style={{ fontSize: 'var(--fs-base)', lineHeight: 1.55, color: 'var(--text)', margin: '0 0 var(--s5)' }}>
                  {/* Fallbacks, not decoration: any step can end up needing
                      travel if someone navigates away mid-tour, and a step
                      without its own announce copy used to render a blank card
                      above a blank button, which reads as the tour crashing. */}
                  {shownStep.announce || 'This step is on another page. We will take you straight there.'}
                </p>
                <button type="button" className="btn btn-primary" style={{ width: '100%', height: 38 }} onClick={travel}>
                  {shownStep.announceCta || 'Take me there'}
                </button>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)', marginBottom: 6 }}>{shownStep.title}</div>
                <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', lineHeight: 1.55, margin: '0 0 var(--s4)' }}>
                  {shownStep.body}
                </p>
                {shownStep.hint && (
                  <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)', margin: '0 0 var(--s4)' }}>{shownStep.hint}</p>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', height: 38 }}
                  onClick={() => (shownStep.final ? end() : goTo(shown.step + 1))}
                >
                  {shownStep.final ? 'Finish' : 'Next'}
                </button>
              </>
            )}

            {/* On a phone the floating bar would collide with the card, so the
                same position and controls live inside it instead. */}
            {isMobile && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s3)',
                marginTop: 'var(--s4)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0 }}>{progress}</div>
                {controls}
              </div>
            )}
          </div>
        </div>
      )}

      {/* The desktop tour bar. Always on screen for the whole run: position,
          and a way out that works on the very first click, even while the page
          underneath is still loading. */}
      {!isMobile && (
        <div
          style={{
            position: 'fixed', zIndex: 1300, left: '50%', bottom: 20, transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: 'var(--s4)',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 999, padding: '8px 10px 8px var(--s5)', boxShadow: 'var(--shadow-lg)',
            maxWidth: 'calc(100vw - 24px)',
          }}
        >
          {progress}
          {controls}
        </div>
      )}
    </>
  );
}
