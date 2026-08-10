import React, { useState } from 'react';

/*
  The demo report is branded as Reelytic's own.

  This is what a company with no client roster yet should do: show the product
  using your own name rather than borrowing someone else's. Using a real
  agency here meant maintaining their logo in our repo and pinning our
  marketing to a relationship that could change; using a famous brand like
  Nike implied a client we do not have. Our own mark costs nothing, is always
  accurate, and quietly demonstrates the branding feature at the same time:
  what a visitor sees is exactly what their own logo will look like there.

  The figures below are illustrative sample data, the same as any product
  screenshot. They describe a plausible campaign, not a customer.
*/
const AGENCY_NAME = 'Reelytic';
const AGENCY_LOGO = '/logo-mark-128.png';

/*
  The landing hero's product shot: a list of links on one side, the finished
  client report on the other.

  Built in markup rather than shipped as a screenshot on purpose. A PNG goes
  stale the moment the report design changes, costs a few hundred KB, and
  blurs on a retina screen. This stays sharp, weighs nothing, and can never
  show a version of the report that no longer exists.

  It renders the real report's light theme (#FFFFFF sheet, #E23E57 rule,
  bordered stat tiles) so what a visitor sees here is what they get.
*/

const ROWS = [
  { name: '@arjunmehra', views: '412K', er: '4.1%' },
  { name: '@the.simran', views: '288K', er: '3.6%' },
  { name: '@kabirshoots', views: '196K', er: '2.9%' },
  { name: '@nehaonreels', views: '154K', er: '2.4%' },
];

function Tile({ value, label }) {
  return (
    <div style={{ flex: 1, backgroundColor: '#FFFFFF', padding: '8px 10px', minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: '15px', fontWeight: 700, color: '#1A1C20' }}>{value}</div>
      <div style={{ fontSize: '10px', color: '#8B8F98', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
    </div>
  );
}

export function ReportHero() {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <div className="report-hero" aria-hidden="true">
      <div className="report-hero-input">
        <div className="report-hero-filename">campaign-links.xlsx</div>
        {['instagram.com/reel/DZ1aQ...', 'instagram.com/reel/Dbo9F...', 'instagram.com/reel/Dbk2M...', 'instagram.com/reel/Da7Ov...'].map((u) => (
          <div key={u} className="report-hero-link">{u}</div>
        ))}
        <div className="report-hero-more">+ 133 more</div>
      </div>

      <div className="report-hero-arrow" aria-hidden="true">→</div>

      <div className="report-hero-sheet">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '3px solid #E23E57', paddingBottom: '9px', marginBottom: '11px' }}>
          {logoFailed ? (
            <div style={{ width: '26px', height: '26px', backgroundColor: '#1A1C20', borderRadius: '4px', flexShrink: 0 }} />
          ) : (
            <img
              src={AGENCY_LOGO}
              alt=""
              onError={() => setLogoFailed(true)}
              style={{ height: '26px', maxWidth: '120px', objectFit: 'contain', display: 'block', flexShrink: 0 }}
            />
          )}
          {/* Our mark is a symbol, not a wordmark, so the name sits beside
              it rather than being hidden behind it. */}
          <div style={{ fontWeight: 700, fontSize: '13px', color: '#E23E57', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {AGENCY_NAME}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1px', backgroundColor: '#E4E1DA', border: '1px solid #E4E1DA', marginBottom: '10px' }}>
          <Tile value="1.2M" label="Total views" />
          <Tile value="48.9K" label="Engagement" />
          <Tile value="3.4%" label="Typical ER" />
        </div>

        {ROWS.map((r) => (
          <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontFamily: 'var(--font-data)', fontSize: '11px', color: '#5D6169', padding: '5px 0', borderBottom: '1px solid #F1EFEA' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            <span style={{ flexShrink: 0 }}>{r.views}</span>
            <span style={{ flexShrink: 0, color: '#1F9D6B', fontWeight: 700 }}>{r.er}</span>
          </div>
        ))}

        <div style={{ fontSize: '10px', color: '#8B8F98', marginTop: '9px' }}>Prepared by {AGENCY_NAME}</div>
      </div>
    </div>
  );
}
