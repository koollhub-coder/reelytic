import React, { useState } from 'react';
import { CopyIcon, CheckIcon } from './Icon';

export function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button onClick={handleCopy} aria-label="Copy to clipboard" style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? 'var(--ok)' : 'var(--text-3)', padding: '2px 4px' }}>
      {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
    </button>
  );
}
