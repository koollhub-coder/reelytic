import { useEffect, useRef, useState } from 'react';

// Fades an element in the first time it scrolls into view, then stops
// watching -- a one-shot reveal, not a replay-every-time scroll animation.
// Originally Pricing.jsx's own local hook; pulled out here once
// HowItsCalculated needed the identical behavior rather than a second copy.
export function useReveal(threshold = 0.15) {
  const ref = useRef(null);
  // Skip the scroll-triggered fade entirely for a reduced-motion
  // preference -- straight to visible=true, not a faster/shorter version of
  // the same animation, since even "less" motion is still what was asked to
  // be turned off.
  const prefersReduced = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  const [visible, setVisible] = useState(prefersReduced);
  useEffect(() => {
    if (prefersReduced) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    // A background/not-yet-focused tab can defer intersection callbacks
    // indefinitely (observed directly: a hidden tab's own freshly-created
    // observer never fires, even for an element already on screen) --
    // real users' active tabs never hit this, but nothing should stay
    // permanently invisible waiting on a callback that might not come.
    // This is a correctness floor, not the common path.
    const fallback = setTimeout(() => setVisible(true), 700);
    return () => { obs.disconnect(); clearTimeout(fallback); };
  }, []);
  return [ref, visible];
}
