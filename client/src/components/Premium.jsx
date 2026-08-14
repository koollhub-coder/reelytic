import { LockIcon } from './Icon';
import React, { useState } from 'react';
import { Modal } from './Modal';

/*
  Plan-gated feature presentation.

  The rule this follows, which is what every mature SaaS does (Notion, Linear,
  Figma, Slack, Airtable, Miro, Canva, Vercel, Stripe...): a feature you
  haven't paid for is still SHOWN. The real control stays where it always is,
  visibly inert, wearing a small lock, and clicking it explains what it does
  and how to get it. What none of them do is delete the control and leave a
  sentence of explanatory text in its place -- that reads as a missing
  feature rather than an available one, and it teaches the user nothing about
  what they'd be buying.

  Warning/amber is also deliberately avoided throughout. Amber means "something
  is wrong"; a paid feature is not an error state, so these use the brand
  accent at low opacity instead.
*/


// Soft-tinted, not a saturated gradient pill. A monetisation badge should
// register as a quiet label, not compete with the primary action next to it.
export function ProBadge({ style, label = 'Pro' }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
        color: 'var(--accent)',
        fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em',
        padding: '2px 7px', borderRadius: 'var(--r-full)', textTransform: 'uppercase',
        lineHeight: 1.6, whiteSpace: 'nowrap',
        ...style,
      }}
    >
      <LockIcon size={11} strokeWidth={2.5} />
      {label}
    </span>
  );
}

export function UpgradeDialog({ isOpen, onClose, feature }) {
  if (!feature) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="" width="440px">
      <div style={{ marginTop: '-8px' }}>
        <div style={{
          width: '44px', height: '44px', borderRadius: 'var(--r-md)',
          backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
          color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 'var(--s4)',
        }}>
          <LockIcon size={20} />
        </div>

        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)', color: 'var(--text)' }}>
          {feature.title}
        </h3>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
          {feature.description}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
          {feature.points.map((point) => (
            <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s3)', fontSize: 'var(--fs-sm)' }}>
              <span style={{ color: 'var(--accent)', fontWeight: 700, lineHeight: 1.5, flexShrink: 0 }}>✓</span>
              <span style={{ color: 'var(--text)' }}>{point}</span>
            </div>
          ))}
        </div>

        <div style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-3)',
          paddingTop: 'var(--s4)', borderTop: '1px solid var(--border)', marginBottom: 'var(--s4)',
        }}>
          Included on <strong style={{ color: 'var(--text-2)' }}>Pro</strong> and <strong style={{ color: 'var(--text-2)' }}>Agency</strong>.
        </div>

        <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
          <a href="/pricing" className="btn btn-primary">See plans</a>
        </div>
      </div>
    </Modal>
  );
}

/*
  The locked control itself. Renders exactly where (and roughly as) the real
  button would, so the feature reads as present-but-unavailable rather than
  absent. Stays clickable on purpose -- the click is the upsell moment, and a
  dead control that swallows clicks is its own kind of cheap.
*/
export function LockedFeatureButton({ label, feature, className = 'btn btn-secondary', style, dataTour }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        // Locked buttons still need to be findable by the product tour. The
        // share step pointed at a selector that only existed on the unlocked
        // version, so on a free account the tour had nothing to point at and
        // stopped dead. Showing someone a feature they do not have yet is the
        // entire purpose of the tour.
        data-tour={dataTour}
        onClick={() => setOpen(true)}
        title={`${feature.title} is available on Pro and Agency`}
        style={{
          color: 'var(--text-3)',
          borderColor: 'var(--border)',
          backgroundColor: 'transparent',
          gap: 'var(--s2)',
          ...style,
        }}
      >
        <span style={{ color: 'var(--text-2)' }}>{label}</span>
        <ProBadge />
      </button>
      <UpgradeDialog isOpen={open} onClose={() => setOpen(false)} feature={feature} />
    </>
  );
}

// Feature copy lives in one place so the dialog says the same thing wherever
// a given feature happens to be locked.
export const PREMIUM_FEATURES = {
  shareableLinks: {
    title: 'Shareable report links',
    description: 'Send clients a link straight to their report instead of emailing files back and forth.',
    points: [
      'One link per report, viewable without a Reelytic login',
      'Always shows your latest branding and numbers',
      'Turn any link off the moment a campaign wraps',
    ],
  },
  reportBranding: {
    title: 'Custom report branding',
    description: 'Hand clients a report that looks like it came from your agency, not from a tool.',
    points: [
      'Your logo, accent color, and layout on every report',
      'Set it once, applied to everything you generate after',
      'Light and dark versions, both client-ready',
    ],
  },
};
