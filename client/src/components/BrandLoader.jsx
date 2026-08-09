import React, { useLayoutEffect, useRef, useState } from 'react';

/*
  The one loading state for the whole app. Same logo-in-a-ring as the HTML
  boot splash (index.html), so wherever the app waits -- first paint, auth
  check, a page fetching its data -- it's visibly the same thing happening
  rather than a different placeholder each time.

  Sizes:
    full  -- owns the viewport (boot handoff, auth check). Shows the wordmark.
    page  -- a page's main content area is loading. Centred in the space it has.
    inline -- a card or section inside an otherwise-rendered page.

  Ring and mark scale down on narrow screens via clamp(), so the same
  component is right on a 375px phone without a second set of props.
*/

const SIZES = {
  full: { ring: 'clamp(72px, 18vw, 92px)', mark: 'clamp(42px, 10vw, 52px)', minHeight: '100vh' },
  page: { ring: 'clamp(64px, 16vw, 78px)', mark: 'clamp(36px, 9vw, 44px)', minHeight: '240px' },
  inline: { ring: 'clamp(44px, 12vw, 52px)', mark: 'clamp(24px, 6vw, 30px)', minHeight: '180px' },
};

export function BrandLoader({ variant = 'page', message = 'Loading...', minHeight }) {
  const size = SIZES[variant] || SIZES.page;
  const showWordmark = variant === 'full';
  const ref = useRef(null);
  const [fillHeight, setFillHeight] = useState(null);

  /*
    "Centred" has to mean centred in the space actually left below the page
    header, and that space is different on every page (and different again on
    mobile, where a 56px topbar replaces the sidebar). A hardcoded
    calc(100vh - 220px) guess put this near the top of History and I shipped
    it twice without catching it.

    So: measure where this element actually starts and claim exactly the rest
    of the viewport. Only for the 'page' variant -- 'inline' lives inside
    modals and cards where stretching to the viewport would be wrong, and
    'full' already owns the screen.
  */
  useLayoutEffect(() => {
    if (variant !== 'page' || minHeight) return undefined;

    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const available = window.innerHeight - top - 24;
      setFillHeight(Math.max(available, 220));
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [variant, minHeight]);

  return (
    <div
      ref={ref}
      style={{
        minHeight: minHeight || (fillHeight != null ? `${fillHeight}px` : size.minHeight),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--s5) var(--s4)',
        backgroundColor: variant === 'full' ? 'var(--bg)' : 'transparent',
        width: '100%',
      }}
    >
      {/* .rl-loader-ring / .rl-loader-mark and their keyframes live in
          components.css so inline spinners elsewhere can use them too. */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', maxWidth: '100%' }}>
        <div
          className="rl-loader-mark"
          style={{
            position: 'relative',
            width: size.ring,
            height: size.ring,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: showWordmark ? 'var(--s5)' : 'var(--s4)',
            flexShrink: 0,
          }}
        >
          <div className="rl-loader-ring" />
          <img
            src="/logo-mark-128.png"
            alt=""
            style={{ width: size.mark, height: size.mark, display: 'block', objectFit: 'contain' }}
          />
        </div>

        {showWordmark && (
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-lg)', letterSpacing: '-0.02em', color: 'var(--text)' }}>
            R<span style={{ fontFamily: 'var(--font-data)', color: 'var(--accent)' }}>e</span>elytic
          </div>
        )}

        {message && (
          <div style={{ marginTop: showWordmark ? 'var(--s2)' : 0, fontSize: 'var(--fs-xs)', color: 'var(--text-3)', maxWidth: '260px' }}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
