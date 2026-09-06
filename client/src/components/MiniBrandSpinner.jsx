import React from 'react';

// Same ring-around-the-logo-mark treatment as BrandLoader, shrunk down for a
// spot next to a filter control (e.g. a range picker mid-refetch). Reuses
// BrandLoader's own .rl-loader-ring/.rl-loader-mark classes and keyframes --
// this app has exactly one loading indicator, not a plain generic spinner
// invented separately for every place something is loading.
export function MiniBrandSpinner({ size = 20 }) {
  return (
    <div
      className="rl-loader-mark"
      aria-label="Updating"
      style={{ position: 'relative', width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
    >
      <div className="rl-loader-ring" style={{ borderWidth: '2px' }} />
      <img
        src="/logo-mark-128.png"
        alt=""
        style={{ width: size * 0.58, height: size * 0.58, display: 'block', objectFit: 'contain' }}
      />
    </div>
  );
}
