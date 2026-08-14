import React, { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/*
  The guided product tour.

  Six stops that follow the order an agency actually works in: read the
  report, take the numbers, brand it, send it, set your logo once, done.

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

const CHAPTERS = ['Your report', 'Your report', 'The client version', 'The client version', 'Your branding', 'Done'];

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

export function DemoGuide({ username }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, setState] = useState(() => readState(username));
  const [rect, setRect] = useState(null);
  // Set when a step's target never turned up. Without it, a step whose anchor
  // is missing waits for a measurement that will never arrive and shows
  // nothing at all: the dim layer sits there with no card and no way forward,
  // which is what a free account hit on the share step because the locked
  // version of that button carried no tour anchor.
  const [gaveUp, setGaveUp] = useState(false);
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [cardH, setCardH] = useState(220);
  const cardRef = useRef(null);
  const raised = useRef(null);

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
    What this step is pointing at right now.

    A step has two anchors: the one it highlights once you are on the right
    page, and (optionally) the control that gets you there. Resolving both
    through one value means the measuring, the ring and the placement all work
    the same whether the card is explaining something or offering to travel.
  */
  const activeTarget = current
    ? (needsTravel ? (current.announceTarget || null) : (current.target || null))
    : null;

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
    setRect(null);
    if (back && back !== window.location.pathname + window.location.search) {
      navigate(back);
    } else if (!back) {
      navigate('/dashboard');
    }
  }, [release, username, state, navigate]);

  // Swap immediately. The new step's card is a fresh element (see its key)
  // so it plays its own entrance animation, which is what makes the change
  // read as a transition rather than a jump.
  const goTo = useCallback((n) => {
    release();
    setRect(null);
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
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h && Math.abs(h - cardH) > 4) setCardH(h);
    // cardWidth is included because a narrower card is a taller one, and the
    // vertical clamp needs the real height. It is derived from the target and
    // the viewport only, never from cardH, so this cannot feed back on itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, needsTravel, isMobile, vp.w, vp.h, cardWidth]);

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

  // Track the target: raise it above the dim layer, scroll it into view once,
  // and measure it. Polls because the element usually belongs to a page that
  // is still mounting.
  useEffect(() => {
    if (!current) return undefined;
    // Fresh step, fresh chance to find its anchor.
    setGaveUp(false);

    // Nothing to point at (the closing step, or a travel card with no anchor
    // of its own): no measuring to wait for, so show it straight away.
    if (!activeTarget) {
      setRect(null);
      return undefined;
    }

    /*
      Measure on a plain interval, and nothing else.

      An earlier version also tracked, in component state, whether the card
      was allowed to be visible yet, and drove that from these measurements.
      Placement depends on the card, the card depends on the measurement, and
      the two chased each other every frame: transitions restarted from zero
      forever and the main thread never settled, so the card stayed invisible
      and the page locked up. The reveal is a CSS animation now (see the
      card's key and rl-tour-pop) and this loop only reports geometry.
    */
    let scrolls = 0;
    const tick = () => {
      const el = document.querySelector(activeTarget);
      if (el) {
        if (raised.current !== el) {
          release();
          el.classList.add('rl-tour-raised');
          raised.current = el;
        }
        const r = el.getBoundingClientRect();
        const tall = r.height >= window.innerHeight * 0.8;
        /*
          Scroll with a purpose, rather than just centring the target.

          Centring looks tidy but spends the whole viewport on the target,
          which on a laptop-height window left no room above or below for the
          card and forced it to overlap the very thing it points at. So we
          work out the highest position that still leaves a card-sized gap
          underneath, and put the target there: as close to centred as we can
          afford, and no lower.
        */
        // Up to two corrections per step. One is not always enough: a page
        // that finishes loading its data after we have scrolled re-renders and
        // drops the scroll position back to the top, leaving the target parked
        // off screen. Two is enough to recover from that, and bounded so the
        // loop can never fight the page.
        const done = scrolls;
        if (done < 2) {
          const headroom = isMobileRef.current ? 68 : EDGE;
          const latest = window.innerHeight - BAR - cardHRef.current - GAP - r.height;
          // A target taller than the screen can never be framed, but it still
          // has to be brought into view: skipping the scroll entirely left the
          // Settings branding card sitting below the fold, highlighted and
          // completely invisible.
          const wantTop = (!tall && latest >= headroom)
            ? Math.min(Math.max(headroom, (window.innerHeight - r.height) / 2), latest)
            : headroom;
          const delta = r.top - wantTop;
          // The follow-up correction uses a slacker threshold so normal
          // settling never counts as drift worth re-scrolling for.
          if (Math.abs(delta) > (done === 0 ? 4 : 24)) {
            scrolls += 1;
            // Instant, not smooth. The card and ring are positioned from this
            // measurement, so animating the page underneath them means every
            // frame is measured against a position that has already moved on.
            // We jump the page before the step is ever shown, so there is
            // nothing to see mid-flight anyway.
            window.scrollBy(0, delta);
            return;
          }
        }
        setRect((prev) => {
          if (prev && Math.abs(prev.top - r.top) < 1 && Math.abs(prev.left - r.left) < 1
            && Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1) return prev;
          return { top: r.top, left: r.left, width: r.width, height: r.height };
        });
      }
    };
    tick();
    const poll = window.setInterval(tick, 200);
    // Safety net: if the anchor has not appeared by now it is not going to.
    // Show the card docked so the step can still be read and, crucially, so
    // Next and End tour are still reachable.
    const giveUp = window.setTimeout(() => setGaveUp(true), 2500);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(giveUp);
      release();
    };
  }, [current, activeTarget, release, location.pathname, location.search]);

  useEffect(() => () => release(), [release]);

  // Pick up a tour started elsewhere in this same session (welcome modal,
  // Getting Started checklist, Settings' replay) without needing a reload.
  useEffect(() => {
    const sync = () => setState(readState(username));
    window.addEventListener(TOUR_EVENT, sync);
    return () => window.removeEventListener(TOUR_EVENT, sync);
  }, [username]);

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

  /*
    A step that points at something renders nothing until its target has been
    measured.

    Without this the card painted on its very first frame, before any
    measurement existed, and with no rect to work from placeCard fell through
    to the bottom-right dock. A moment later the measurement arrived and the
    card slid from that corner to where it actually belonged. That drift is
    the single most amateur thing a guided tour can do, and it was visible on
    every step. The wait is one measure tick; the card then appears already in
    the right place and simply fades in.
  */
  const awaitingTarget = !!activeTarget && !rect && !gaveUp;

  const travel = () => {
    const want = routeFor(current);
    if (want) navigate(want);
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
          tour's own controls. */}
      <div
        onClick={(e) => e.stopPropagation()}
        aria-hidden="true"
        style={{
          position: 'fixed', inset: 0, background: 'rgba(6,8,11,0.62)', zIndex: 1290,
        }}
      />

      {showRing && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed', zIndex: 1296, pointerEvents: 'none',
            top: rect.top - 6, left: rect.left - 6,
            width: rect.width + 12, height: rect.height + 12,
            borderRadius: 10, boxShadow: '0 0 0 2px var(--accent)',
            // Animates only while it is tracking the same target; a new step
            // gets a new key below, so it never slides across the screen.
            transition: 'top 260ms cubic-bezier(.4,0,.2,1), left 260ms cubic-bezier(.4,0,.2,1), width 260ms cubic-bezier(.4,0,.2,1), height 260ms cubic-bezier(.4,0,.2,1)',
          }}
        />
      )}

      {/* The key is what produces the transition between steps: a new step is
          a new element, so it plays rl-tour-pop on arrival instead of the old
          card sliding across the screen to its next position. Within a step
          the element persists, so it eases to a new spot if the page reflows. */}
      {!awaitingTarget && (
      <div
        key={`${step}-${needsTravel ? 'travel' : 'point'}`}
        ref={cardRef}
        role="dialog"
        aria-label={current.title}
        className="card rl-tour-pop"
        style={{
          position: 'fixed', zIndex: 1300,
          width: isMobile ? 'auto' : cardWidth,
          maxWidth: isMobile ? 'none' : 'calc(100vw - 32px)',
          padding: 'var(--s5)', boxShadow: 'var(--shadow-lg)',
          ...place,
          /*
            Position changes apply instantly, deliberately.

            The card's own height feeds its placement, so the first paint uses
            an estimated height and the real one lands a frame later, moving it
            a few pixels. Eased, that reads as the card settling into place
            after it has arrived, which is the drifting look we are trying to
            be rid of; applied instantly it happens inside the entrance fade
            and nobody sees it. Has to be spelled out rather than simply
            omitted, because the .card class carries `transition: all` and
            would otherwise animate the correction anyway.
          */
          transition: 'none',
        }}
      >
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.14em', color: 'var(--accent)', marginBottom: 8 }}>
          {CHAPTERS[step].toUpperCase()}
        </div>

        {needsTravel ? (
          <>
            <p style={{ fontSize: 'var(--fs-base)', lineHeight: 1.55, color: 'var(--text)', margin: '0 0 var(--s5)' }}>
              {/* Fallbacks, not decoration: any step can end up needing travel
                  if someone navigates away mid-tour, and a step without its
                  own announce copy used to render a blank card above a blank
                  button, which reads as the tour having crashed. */}
              {current.announce || 'This step is on another page. We will take you straight there.'}
            </p>
            <button type="button" className="btn btn-primary" style={{ width: '100%', height: 38 }} onClick={travel}>
              {current.announceCta || 'Take me there'}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-md)', marginBottom: 6 }}>{current.title}</div>
            <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', lineHeight: 1.55, margin: '0 0 var(--s4)' }}>
              {current.body}
            </p>
            {current.hint && (
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)', margin: '0 0 var(--s4)' }}>{current.hint}</p>
            )}
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', height: 38 }}
              onClick={() => (current.final ? end() : goTo(step + 1))}
            >
              {current.final ? 'Finish' : 'Next'}
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
      )}

      {/* The desktop tour bar. Always on screen for the whole run: position,
          and a way out that works on the very first click. */}
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
