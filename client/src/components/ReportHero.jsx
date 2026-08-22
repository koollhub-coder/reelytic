import React from 'react';
import { ExcelIcon, LoaderIcon, LinkIcon, CheckIcon, ArrowUpRightIcon } from './Icon';

/*
  The demo report is branded generically ("Your Agency"), not as Reelytic's
  own -- Reelytic isn't its own client, and labelling the mock report with
  the product's own name implied a client relationship that doesn't exist.
  "Your Agency" is the honest placeholder: whoever's looking at this sees
  exactly what THEIR logo/name will look like there once they upload one,
  same idea the report-branding feature actually delivers. The logo slot
  itself is a plain "YOUR LOGO" placeholder circle for the same reason --
  rendering Reelytic's own mark there next to a label that says "Your
  Agency" contradicted itself.

  The four "top performer" rows use colored-initial avatars, not photos.
  A reference mockup can get away with stock headshots; a real product
  cannot without implying four specific people exist and endorsed this,
  which they don't. Initials are the same honest-placeholder logic as the
  agency name above.

  All figures below are illustrative sample data, the same as any product
  screenshot -- a plausible campaign, not a customer's real numbers.
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
  return (
    <div className="report-hero" aria-hidden="true">
      {/* Left: the input -> processing flow, stacked. Hidden on mobile (see
          mobile.css) -- narrow screens show only the finished report on the
          right, which is the part of this graphic that actually matters. */}
      <div className="report-hero-flow">
        <div className="report-hero-card">
          <div className="report-hero-card-label">Your campaign sheet</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ExcelIcon size={30} style={{ borderRadius: 'var(--r-sm)' }} />
            <div style={{ minWidth: 0 }}>
              <div className="report-hero-filename" style={{ marginBottom: '2px' }}>campaign-links.xlsx</div>
              <div className="report-hero-more" style={{ paddingTop: 0 }}>2,000 links</div>
            </div>
          </div>
        </div>

        <div className="report-hero-down-arrow" aria-hidden="true">↓</div>

        <div className="report-hero-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="report-hero-spinner"><LoaderIcon size={16} /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>Reelytic is pulling data</div>
              <div style={{ fontSize: '10px', color: 'var(--text-3)' }}>This usually takes a few minutes</div>
            </div>
          </div>
        </div>
      </div>

      <div className="report-hero-arrow" aria-hidden="true">→</div>

      {/* Right: the finished report, plus the floating share-link badge. */}
      <div className="report-hero-sheet-wrap">
        <div className="report-hero-sheet">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', borderBottom: '3px solid #E23E57', paddingBottom: '9px', marginBottom: '11px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <div style={{
                width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                backgroundColor: '#F7F6F3', border: '1px solid #E4E1DA', color: '#8B8F98',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '6px', fontWeight: 700, letterSpacing: '0.02em', textAlign: 'center', lineHeight: 1.1,
              }}>
                YOUR<br />LOGO
              </div>
              <div style={{ fontWeight: 700, fontSize: '13px', color: '#E23E57', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Your Agency
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '11px', color: '#1A1C20' }}>Campaign Report</div>
              <div style={{ fontSize: '9px', color: '#8B8F98' }}>Generated on 10 Aug</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1px', backgroundColor: '#E4E1DA', border: '1px solid #E4E1DA', marginBottom: '10px' }}>
            <Tile value="1.2M" label="Views" />
            <Tile value="48.9K" label="Engagement" />
            <Tile value="3.4%" label="Eng. Rate" />
          </div>

          <div style={{ fontSize: '10px', color: '#8B8F98', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>Top Performers</div>

          {ROWS.map((r) => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontFamily: 'var(--font-data)', fontSize: '11px', color: '#5D6169', padding: '5px 0', borderBottom: '1px solid #F1EFEA' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', minWidth: 0 }}>
                <span aria-hidden="true" style={{
                  width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0,
                  background: '#E23E57', color: '#fff', fontSize: '8px', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)',
                }}>
                  {r.name.replace('@', '').charAt(0).toUpperCase()}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              </span>
              <span style={{ flexShrink: 0 }}>{r.views}</span>
              <span style={{ flexShrink: 0, color: '#1F9D6B', fontWeight: 700 }}>{r.er}</span>
            </div>
          ))}

          <div style={{ fontSize: '10px', color: '#E23E57', fontWeight: 600, marginTop: '9px' }}>Prepared by Reelytic</div>

          {/* Decorative only, like every other element in this graphic
              (aria-hidden on the root already covers it) -- a "view full
              report" affordance that doesn't actually navigate anywhere
              would be a broken-looking control on a real page, so this is a
              plain div, never a button or link. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', marginTop: '11px', paddingTop: '10px',
            borderTop: '1px solid #F1EFEA', fontSize: '11px', fontWeight: 600, color: '#E23E57',
          }}>
            <LinkIcon size={12} />
            View full report
            <ArrowUpRightIcon size={12} />
          </div>
        </div>

        <div className="report-hero-badge">
          <span className="report-hero-badge-icon"><LinkIcon size={13} /></span>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 700 }}>Branded report</div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)' }}>Shareable link</div>
          </div>
          <span className="report-hero-badge-check"><CheckIcon size={11} /></span>
        </div>
      </div>
    </div>
  );
}
