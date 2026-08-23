import React, { useId, useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/*
  The one tooltip system for the whole app. Every native title="..." attribute
  in the codebase renders as unstyled OS chrome (the exact "90s black/white
  box" complaint) -- this replaces all of them with one themed, positioned,
  animated bubble.

  Portaled into document.body with JS-computed `position: fixed` coordinates,
  NOT a plain CSS sibling anchored with position:absolute. That used to be
  simpler, but an absolutely positioned bubble is still part of its wrapper's
  layout box even at opacity:0 -- so a bubble sitting inside any scrollable
  ancestor (the collapsed sidebar's overflow-y:auto nav, the Recent Reports
  table's overflow-x:auto wrapper) silently grew that ancestor's scrollable
  area and produced a phantom scrollbar with nothing visibly overflowing.
  `position: fixed` is excluded from an ancestor's scrollable overflow by
  spec, which is what actually fixes it -- portaling to <body> is what makes
  "fixed relative to the viewport" trivial to reason about instead of fixed
  relative to whatever transformed ancestor happens to be nearby.

  Usage:
    <Tooltip content="View report"><button>...</button></Tooltip>
    <Tooltip content={<>...rich JSX...</>} position="bottom">...</Tooltip>

  `children` must be a single focusable-or-hoverable element (button, a,
  span, etc) -- the wrapper wraps it in an inline-flex span so layout is
  unaffected either way.
*/

const GAP = 8;
const EDGE_PAD = 8;
const SHOW_DELAY = 250;

export function Tooltip({ content, children, position = 'top', maxWidth = 240, style }) {
  const id = useId();
  const wrapRef = useRef(null);
  const bubbleRef = useRef(null);
  const showTimer = useRef(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState(null);

  const clearShowTimer = () => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null; }
  };

  // Where the bubble should sit, flipping to the opposite side (and sliding
  // along its own axis) when the naive placement would run off the viewport
  // -- this is the "auto-repositioning near viewport edges" the tooltip
  // spec asked for, which a pure-CSS anchor could never do.
  const place = useCallback(() => {
    const trigger = wrapRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const t = trigger.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    let placement = position;
    if (placement === 'top' && t.top - b.height - GAP < EDGE_PAD) placement = 'bottom';
    else if (placement === 'bottom' && t.bottom + b.height + GAP > window.innerHeight - EDGE_PAD) placement = 'top';
    else if (placement === 'left' && t.left - b.width - GAP < EDGE_PAD) placement = 'right';
    else if (placement === 'right' && t.right + b.width + GAP > window.innerWidth - EDGE_PAD) placement = 'left';

    let top, left;
    if (placement === 'top' || placement === 'bottom') {
      left = t.left + t.width / 2 - b.width / 2;
      top = placement === 'top' ? t.top - b.height - GAP : t.bottom + GAP;
    } else {
      top = t.top + t.height / 2 - b.height / 2;
      left = placement === 'left' ? t.left - b.width - GAP : t.right + GAP;
    }
    left = Math.min(Math.max(left, EDGE_PAD), window.innerWidth - b.width - EDGE_PAD);
    top = Math.min(Math.max(top, EDGE_PAD), window.innerHeight - b.height - EDGE_PAD);
    setCoords({ top, left, placement });
  }, [position]);

  const show = () => {
    clearShowTimer();
    showTimer.current = setTimeout(() => setVisible(true), SHOW_DELAY);
  };
  const hide = () => {
    clearShowTimer();
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return undefined;
    place();
    // Anchored with position:fixed, so it won't track the trigger if the
    // page scrolls underneath it -- closing on scroll (the same call most
    // portal-based tooltip libraries make) beats letting it drift off-anchor.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, place]);

  useEffect(() => clearShowTimer, []);

  const handlePointerDown = (e) => {
    if (e.pointerType !== 'touch') return;
    clearShowTimer();
    setVisible((v) => !v);
  };

  useEffect(() => {
    if (!visible) return undefined;
    const handleOutside = (e) => {
      if (e.pointerType === 'touch' && wrapRef.current && !wrapRef.current.contains(e.target)) hide();
    };
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  }, [visible]);

  if (!content) return children;

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && wrapRef.current && wrapRef.current.contains(document.activeElement)) {
      document.activeElement.blur();
      hide();
    }
  };

  /*
    Tab-focus should show the tooltip (keyboard users have no hover); a mouse
    click that leaves focus sitting on the button must NOT -- that was the
    bug where the sidebar's collapse toggle kept "Expand sidebar" stuck open
    indefinitely after being clicked, because :focus-within has no idea
    which input method produced the focus. :focus-visible does: the browser
    only marks an element focus-visible for keyboard/AT focus, never a bare
    mouse click, and it's queryable straight off the event target.
  */
  const handleFocus = (e) => {
    if (e.target.matches && e.target.matches(':focus-visible')) show();
  };

  return (
    <span
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={handleFocus}
      onBlur={hide}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      className="rl-tooltip-wrap"
      style={{ position: 'relative', display: 'inline-flex', ...style }}
    >
      {React.cloneElement(children, { 'aria-describedby': id })}
      {createPortal(
        <span
          ref={bubbleRef}
          role="tooltip"
          id={id}
          className="rl-tooltip-bubble"
          data-visible={visible && coords ? 'true' : 'false'}
          data-placement={coords ? coords.placement : position}
          style={{
            maxWidth: `${maxWidth}px`,
            top: coords ? `${coords.top}px` : '-9999px',
            left: coords ? `${coords.left}px` : '-9999px',
          }}
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
}

/*
  Rich variant for chart data points: a date/heading plus one or more
  colored-dot rows (series name + value), matching the spec's "10-Aug-26 /
  Reel reports 120 / Profile reports 0" shape. Kept separate from the plain
  Tooltip so simple string tooltips (the overwhelming majority of call
  sites) don't have to build this shape by hand.
*/
export function TooltipRows({ heading, rows }) {
  return (
    <>
      {heading && <div className="rl-tooltip-heading">{heading}</div>}
      {rows.map((r, i) => (
        <div key={i} className="rl-tooltip-row">
          <span className="rl-tooltip-dot" style={{ backgroundColor: r.color }} />
          <span>{r.label}</span>
          {r.value !== undefined && <span className="rl-tooltip-value">{r.value}</span>}
        </div>
      ))}
    </>
  );
}
