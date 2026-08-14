import React from 'react';

/*
  Placeholder rows for a table that is still loading.

  The problem this solves: several pages set their "ready" state before the
  rows themselves arrive, so the table painted its header against an empty
  body and the rows dropped in a moment later. That reads as a glitch even
  when it is fast, because the page visibly changes height twice.

  The rule that makes a skeleton work is that it has to occupy the SAME space
  the real content will. So this renders a real <tbody> with real <td>s and
  inherits the table's own padding and border rules, rather than drawing a
  separate grey box that happens to look table-ish. Row count comes from the
  caller's page size for the same reason: a hardcoded 10 rows is just a
  different layout shift.

  Bar widths are varied so it reads as text rather than a barcode, but the
  variation is derived from the cell position, not Math.random, so it stays
  put across re-renders instead of twitching.

  `rowHeight` exists because "same space" is not free. The default row here
  is a single line of text (~36px, matching .data-table td padding), which is
  right for most tables. History's rows carry a campaign dropdown and action
  buttons and run ~67px, so a default skeleton there under-reserves and
  reintroduces the very jump this component exists to remove. Measure the
  real row and pass it rather than assuming: this number was 130px until a
  date-wrapping fix halved the row height, and a stale constant here is a
  layout shift that hides in plain sight.
*/

const WIDTHS = [78, 54, 92, 63, 85, 47, 71, 58];

export function TableSkeleton({ rows = 8, columns = 5, label = 'Loading rows', rowHeight }) {
  const safeRows = Math.max(1, Math.min(rows, 25));
  const safeCols = Math.max(1, columns);

  return (
    <tbody aria-hidden="true" data-skeleton="true">
      {Array.from({ length: safeRows }).map((_, r) => (
        <tr key={r} className="rl-skel-row" style={rowHeight ? { height: rowHeight } : undefined}>
          {Array.from({ length: safeCols }).map((_, c) => (
            <td key={c}>
              <span
                className="rl-skel"
                style={{
                  width: `${WIDTHS[(r * safeCols + c) % WIDTHS.length]}%`,
                  // Stagger so the shimmer sweeps across the table instead of
                  // every bar pulsing in lockstep, which looks mechanical.
                  animationDelay: `${((r * safeCols + c) % 6) * 90}ms`,
                }}
              />
            </td>
          ))}
        </tr>
      ))}
      <tr className="rl-visually-hidden-row">
        <td colSpan={safeCols} aria-live="polite">{label}</td>
      </tr>
    </tbody>
  );
}
