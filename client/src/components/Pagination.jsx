import React from 'react';
import { Select } from './Select';

/*
  Shared numbered-pagination control. Originally lived only in History.jsx;
  pulled out here so History and the Creator database render the exact same
  control rather than two hand-styled lookalikes drifting apart over time.

  Purely presentational -- it slices/pages whatever `totalItems` the caller
  says it has. History uses it over an already-fully-loaded in-memory list;
  Creators uses it over a window that grows as more data streams in behind
  the scenes (see that page for why). This component doesn't know or care
  which.
*/

// Page numbers with a single "..." for gaps -- always shows first, last, and
// current +/-1, so a long list doesn't render dozens of page buttons in a row.
export function paginationRange(current, total) {
  const range = [];
  const add = (n) => { if (!range.includes(n)) range.push(n); };
  add(1);
  for (let n = current - 1; n <= current + 1; n++) { if (n > 1 && n < total) add(n); }
  add(total);
  const out = [];
  let prev = 0;
  for (const n of range.sort((a, b) => a - b)) {
    if (n - prev > 1) out.push('...');
    out.push(n);
    prev = n;
  }
  return out;
}

// pageSizeOptions is optional -- omit it (as Creators does, since its page
// size is fixed at 50) and the per-page selector simply doesn't render.
export function Pagination({ page, totalPages, pageSize, totalItems, onPageChange, onPageSizeChange, pageSizeOptions, nextDisabled, nextLoading, trailing }) {
  if (totalItems === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  return (
    <div className="rl-pagination" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)' }}>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
        Showing {start}-{end} of {totalItems}
        {trailing}
      </span>
      <div className="rl-pagination-controls" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
        {pageSizeOptions && (
          <Select
            value={String(pageSize)}
            onChange={(v) => onPageSizeChange(Number(v))}
            options={pageSizeOptions.map((n) => ({ value: String(n), label: `${n} per page` }))}
            style={{ minWidth: '110px' }}
          />
        )}
        {(totalPages > 1 || nextLoading || nextDisabled === false) && (
          <div className="rl-pagination-pages" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)} style={{ height: '28px', width: '28px', padding: 0, fontSize: 'var(--fs-sm)' }}>‹</button>
            {paginationRange(page, totalPages).map((p, i) => (
              p === '...'
                ? <span key={`gap-${i}`} style={{ padding: '0 4px', color: 'var(--text-3)' }}>...</span>
                : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onPageChange(p)}
                    className={p === page ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ height: '28px', minWidth: '28px', padding: '0 8px', fontSize: 'var(--fs-sm)' }}
                  >
                    {p}
                  </button>
                )
            ))}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={(page >= totalPages && nextDisabled !== false && !nextLoading) || nextLoading}
              onClick={() => onPageChange(page + 1)}
              style={{ height: '28px', width: '28px', padding: 0, fontSize: 'var(--fs-sm)' }}
            >
              {nextLoading ? '…' : '›'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
