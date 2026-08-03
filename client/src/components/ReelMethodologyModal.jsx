import React from 'react';
import { Modal } from './Modal';
import { REEL_METHODOLOGY } from '../content/reelMethodology';

// Client-facing "how is this calculated" view for Reel reports. Same hard
// boundary as ProfileMethodologyModal: no vendor/actor name, no cost figure,
// no internal pipeline label -- formula and field descriptions only.
export function ReelMethodologyModal({ isOpen, onClose }) {
  const sections = [
    REEL_METHODOLOGY.erFormula,
    REEL_METHODOLOGY.whatEachColumnMeans,
    REEL_METHODOLOGY.followers,
    REEL_METHODOLOGY.scope,
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
