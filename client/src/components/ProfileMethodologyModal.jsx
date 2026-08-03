import React from 'react';
import { Modal } from './Modal';
import { PROFILE_METHODOLOGY } from '../content/profileMethodology';

// Client-facing "how is this calculated" view. HARD BOUNDARY: this component
// must never receive or render a vendor/actor name, a cost figure, or an
// internal pipeline label -- formula and filtering rules only. `calcVariant`
// is the one exception: it's a calculation-only discriminator ('standard' |
// 'refined'), never a vendor/pipeline/cost name, carried on the report's OWN
// result data so this always describes how THAT report was actually
// calculated. See the separate admin/ProfileMethodology.jsx for the internal
// view (which additionally shows the vendor/cost context this one must not).
export function ProfileMethodologyModal({ isOpen, onClose, calcVariant }) {
  const variant = calcVariant === 'refined' ? 'refined' : 'standard';
  const sections = [
    PROFILE_METHODOLOGY.erFormula,
    PROFILE_METHODOLOGY.sortOrder[variant],
    PROFILE_METHODOLOGY.outlierRule[variant],
    PROFILE_METHODOLOGY.exclusions,
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="How is this calculated?" width="480px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
        {sections.map((s) => (
          <div key={s.heading}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', marginBottom: '4px' }}>{s.heading}</div>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', margin: 0 }}>{s.body}</p>
          </div>
        ))}
      </div>
    </Modal>
  );
}
