import React, { useState } from 'react';
import { EyeIcon, EyeOffIcon } from './Icon';

export function PasswordInput({ value, onChange, placeholder = 'Password', autoComplete = 'current-password', showStrength = false, name, id }) {
  const [show, setShow] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  const handleKeyDown = (e) => {
    if (e.getModifierState && e.getModifierState('CapsLock')) {
      setCapsLockOn(true);
    } else {
      setCapsLockOn(false);
    }
  };

  const handleKeyUp = (e) => {
    if (e.getModifierState) {
      setCapsLockOn(e.getModifierState('CapsLock'));
    }
  };

  // Strength calculation
  let strength = 0; // 0: weak, 1: okay, 2: strong
  if (showStrength && value) {
    if (value.length >= 12 && /[A-Z]/.test(value) && /[0-9]/.test(value)) strength = 2;
    else if (value.length >= 8) strength = 1;
    else strength = 0;
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        placeholder={placeholder}
        autoComplete={autoComplete}
        name={name}
        id={id}
        className="input-field"
        style={{ width: '100%', paddingRight: '44px' }}
      />
      <button
        type="button"
        onClick={() => setShow(prev => !prev)}
        aria-label={show ? 'Hide password' : 'Show password'}
        style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '14px' }}
      >
        {show ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
      </button>

      {capsLockOn && (
        <div style={{ fontSize: '11px', color: 'var(--warn)', marginTop: '2px' }}>
          Caps Lock is on
        </div>
      )}

      {showStrength && value && (
        <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
          <div style={{ flex: 1, height: '4px', borderRadius: '2px', backgroundColor: strength >= 0 ? (strength === 0 ? 'var(--err)' : strength === 1 ? 'var(--warn)' : 'var(--ok)') : 'var(--border)' }} />
          <div style={{ flex: 1, height: '4px', borderRadius: '2px', backgroundColor: strength >= 1 ? (strength === 1 ? 'var(--warn)' : 'var(--ok)') : 'var(--border)' }} />
          <div style={{ flex: 1, height: '4px', borderRadius: '2px', backgroundColor: strength >= 2 ? 'var(--ok)' : 'var(--border)' }} />
        </div>
      )}
    </div>
  );
}
