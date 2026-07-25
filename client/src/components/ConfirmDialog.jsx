import React, { useState } from 'react';
import { Modal } from './Modal';

export function ConfirmDialog({ isOpen, title, message, confirmText = 'Confirm', isDestructive = false, requiredTextMatch, onConfirm, onClose }) {
  const [typed, setTyped] = useState('');

  const canConfirm = !requiredTextMatch || typed === requiredTextMatch;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <p style={{ color: 'var(--text-2)', marginBottom: '16px', fontSize: 'var(--fs-base)' }}>{message}</p>
      
      {requiredTextMatch && (
        <div className="input-group">
          <label className="input-label">Type <strong>{requiredTextMatch}</strong> to confirm:</label>
          <input
            type="text"
            className="input-field"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder={requiredTextMatch}
            autoFocus
          />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button
          className={`btn ${isDestructive ? 'btn-destructive' : 'btn-primary'}`}
          disabled={!canConfirm}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
