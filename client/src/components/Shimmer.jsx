import React from 'react';

export function Shimmer({ width = '100%', height = '20px', borderRadius = '6px', style = {} }) {
  return (
    <div
      className="shimmer"
      style={{
        width,
        height,
        borderRadius,
        ...style
      }}
    />
  );
}
