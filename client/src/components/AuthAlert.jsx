import React from 'react';
import { WarningIcon, SuccessIcon } from './Icon';

/*
  Replaces the old approach of stretching .chip (a small pill meant for a
  short status label like "Complete" or "REEL") into a full-width, full-
  sentence banner -- that's a component used outside what it was designed
  for, which is exactly why it read as a harsh, cramped block of solid
  color with no room for an action link. This is sized and paletted for a
  real sentence: an icon to soften the color-only signal, readable
  line-height, and (when there's a next step, like "log in instead") a
  clearly separated action on its own line rather than crammed inline at
  the end of the sentence.
*/
const TONE = {
  err: { Icon: WarningIcon, color: 'var(--err)', soft: 'var(--err-soft)' },
  ok: { Icon: SuccessIcon, color: 'var(--ok)', soft: 'var(--ok-soft)' },
};

export function AuthAlert({ tone = 'err', children, action }) {
  const { Icon, color, soft } = TONE[tone] || TONE.err;
  return (
    <div
      role={tone === 'err' ? 'alert' : 'status'}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--s3)',
        width: '100%', padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s4)',
        borderRadius: 'var(--r-md)', backgroundColor: soft,
        border: `1px solid color-mix(in srgb, ${color} 28%, transparent)`,
      }}
    >
      <Icon size={16} style={{ color, flexShrink: 0, marginTop: '1px' }} />
      <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.5 }}>
        {children}
        {action && (
          <div style={{ marginTop: '6px' }}>
            <button
              type="button"
              onClick={action.onClick}
              style={{
                background: 'none', border: 'none', padding: 0, margin: 0,
                color, fontWeight: 700, fontSize: 'var(--fs-sm)', cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              {action.label}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
