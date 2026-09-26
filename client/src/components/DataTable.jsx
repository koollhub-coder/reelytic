import React, { useMemo, useRef, useState } from 'react';
import { Popover } from './CreatorColumnFilters';
import { Pagination } from './Pagination';
import { Modal } from './Modal';
import { TableSkeleton } from './TableSkeleton';
import { ArrowUpIcon, ArrowDownIcon, FilterIcon, CheckIcon, XIcon } from './Icon';
import { PAGE_SIZE_OPTIONS, usePageSize } from '../utils/pagination';

/*
  The one table every screen uses.

  Excel-style column headings (click one for sort and filter), active filters
  shown as removable chips above the table, the same pagination choices
  everywhere (see utils/pagination.js), rows that turn into cards on a phone.
  The Creator database has the same heading behaviour; this is that pattern for
  data that is already in the browser, so History, the dashboard and any future
  table look and act identically instead of each hand-rolling its own.

  COLUMN
    key         unique id
    label       heading text
    accessor    row => the plain value used for sorting and filtering
    render      row => the cell contents (defaults to the accessor value)
    type        'text' | 'select' | 'number' | 'date'      how it filters
    align       'left' (default) | 'right'
    sortable    default true
    filterable  default true
    width       optional CSS width
    optionLabel value => text shown for a 'select' value
    dateWindows for 'date': [{ id, label, days }] presets (default 7, 30, 90 days)
*/

const MIN_ROWS_TO_FILTER = 6;

// A column pinned to the right edge (row actions on a wide table), so it is never scrolled out of reach.
const STICKY_TH = { position: 'sticky', right: 0, zIndex: 2, background: 'var(--surface-2)' };
const STICKY_TD = { position: 'sticky', right: 0, zIndex: 1, background: 'var(--surface)', boxShadow: '-10px 0 10px -10px rgba(0,0,0,0.3)' };

const DEFAULT_WINDOWS = [
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
];

const toNumber = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};

function isActive(col, v) {
  if (v == null) return false;
  if (col.type === 'select') return Array.isArray(v) && v.length > 0;
  if (col.type === 'number') return toNumber(v.min) != null || toNumber(v.max) != null;
  if (col.type === 'date') return !!v.window;
  return String(v).trim() !== '';
}

function describe(col, v) {
  if (col.type === 'select') {
    const names = v.map((x) => (col.optionLabel ? col.optionLabel(x) : x));
    return names.length <= 2 ? names.join(', ') : `${names.length} selected`;
  }
  if (col.type === 'number') {
    const lo = toNumber(v.min);
    const hi = toNumber(v.max);
    if (lo != null && hi != null) return `${lo.toLocaleString()} to ${hi.toLocaleString()}`;
    return lo != null ? `${lo.toLocaleString()} or more` : `up to ${hi.toLocaleString()}`;
  }
  if (col.type === 'date') {
    const w = (col.dateWindows || DEFAULT_WINDOWS).find((x) => x.id === v.window);
    return w ? w.label : '';
  }
  return `contains "${String(v).trim()}"`;
}

function matches(col, v, row) {
  const raw = col.accessor(row);
  if (col.type === 'select') return v.includes(String(raw));
  if (col.type === 'number') {
    const n = toNumber(raw);
    if (n == null) return false;
    const lo = toNumber(v.min);
    const hi = toNumber(v.max);
    return (lo == null || n >= lo) && (hi == null || n <= hi);
  }
  if (col.type === 'date') {
    const t = raw ? new Date(raw).getTime() : NaN;
    const w = (col.dateWindows || DEFAULT_WINDOWS).find((x) => x.id === v.window);
    if (!w || !Number.isFinite(t)) return false;
    return t >= Date.now() - w.days * 24 * 60 * 60 * 1000;
  }
  return String(raw == null ? '' : raw).toLowerCase().includes(String(v).trim().toLowerCase());
}

function compare(col, a, b, dir) {
  const va = col.sortValue ? col.sortValue(a) : col.accessor(a);
  const vb = col.sortValue ? col.sortValue(b) : col.accessor(b);
  const na = va == null || va === '';
  const nb = vb == null || vb === '';
  if (na || nb) return na === nb ? 0 : (na ? 1 : -1);      // blanks always last
  let out;
  if (col.type === 'number') out = Number(va) - Number(vb);
  else if (col.type === 'date') out = new Date(va).getTime() - new Date(vb).getTime();
  else out = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base', numeric: true });
  return dir === 'desc' ? -out : out;
}

function Check({ checked, onChange, children }) {
  return (
    <label className="rl-filter-check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

// The controls for one column. Shared by the heading popover and the phone sheet.
function FilterBody({ col, value, setValue, rows, autoFocus, onEnter }) {
  const options = useMemo(() => {
    if (col.type !== 'select') return [];
    const counts = new Map();
    for (const r of rows) {
      const k = String(col.accessor(r));
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
  }, [col, rows]);

  const enter = (e) => { if (e.key === 'Enter' && onEnter) onEnter(); };

  if (col.type === 'select') {
    const chosen = Array.isArray(value) ? value : [];
    const toggle = (k) => setValue(chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k]);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
        {options.map(([k, n]) => (
          <Check key={k} checked={chosen.includes(k)} onChange={() => toggle(k)}>
            {col.optionLabel ? col.optionLabel(k) : k}
            <span style={{ color: 'var(--text-3)', marginLeft: 6 }}>{n}</span>
          </Check>
        ))}
        {options.length === 0 && <div className="rl-filter-note">Nothing to choose from yet.</div>}
      </div>
    );
  }

  if (col.type === 'number') {
    const v = value || { min: '', max: '' };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="text" inputMode="decimal" className="input-field" style={{ width: '100%', minWidth: 0 }} placeholder="Min" value={v.min} onChange={(e) => setValue({ ...v, min: e.target.value })} onKeyDown={enter} autoFocus={autoFocus} />
        <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>to</span>
        <input type="text" inputMode="decimal" className="input-field" style={{ width: '100%', minWidth: 0 }} placeholder="Max" value={v.max} onChange={(e) => setValue({ ...v, max: e.target.value })} onKeyDown={enter} />
      </div>
    );
  }

  if (col.type === 'date') {
    const windows = col.dateWindows || DEFAULT_WINDOWS;
    const v = value || {};
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {windows.map((w) => (
          <button key={w.id} type="button" className={`chip ${v.window === w.id ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '5px 10px' }} onClick={() => setValue(v.window === w.id ? null : { window: w.id })}>
            {w.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <input type="text" className="input-field" style={{ width: '100%' }} placeholder="Contains, e.g. nike" value={value || ''} onChange={(e) => setValue(e.target.value)} onKeyDown={enter} autoFocus={autoFocus} />
  );
}

function Heading({ col, sort, setSort, value, setFilter, rows, canFilter }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);

  const sorted = sort && sort.key === col.key ? sort.dir : null;
  const active = isActive(col, value);
  const sortable = col.sortable !== false;
  const filterable = canFilter;
  const right = col.align === 'right';

  const openPanel = () => { setDraft(value == null ? (col.type === 'select' ? [] : col.type === 'number' ? { min: '', max: '' } : '') : value); setOpen((o) => !o); };
  const apply = () => { setFilter(col.key, draft); setOpen(false); };
  const clear = () => { setFilter(col.key, null); setOpen(false); };
  const sortTo = (dir) => { setSort({ key: col.key, dir }); setOpen(false); };
  const labels = col.type === 'text' || col.type === 'select' || !col.type ? ['Sort A to Z', 'Sort Z to A'] : col.type === 'date' ? ['Oldest first', 'Newest first'] : ['Sort low to high', 'Sort high to low'];

  const stick = col.sticky === 'right' ? STICKY_TH : null;
  if (!sortable && !filterable) return <th style={{ width: col.width, textAlign: right ? 'right' : 'left', ...stick }}>{col.label}</th>;

  return (
    <th aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : 'none'} style={{ width: col.width, textAlign: right ? 'right' : 'left', ...stick }}>
      <button ref={btnRef} type="button" className={`rl-colhead${active || sorted ? ' rl-colhead-on' : ''}`} onClick={openPanel} aria-haspopup="dialog" aria-expanded={open} style={right ? { marginLeft: 'auto' } : undefined}>
        <span>{col.label}</span>
        {sorted === 'asc' && <ArrowUpIcon size={12} />}
        {sorted === 'desc' && <ArrowDownIcon size={12} />}
        {filterable && <FilterIcon size={12} style={{ opacity: active ? 1 : 0.8 }} fill={active ? 'currentColor' : 'none'} />}
      </button>
      <Popover anchorRef={btnRef} open={open} onClose={() => setOpen(false)} align={right ? 'right' : 'left'}>
        {sortable && (
          <div className="rl-filter-section">
            {['asc', 'desc'].map((d, i) => {
              const on = sorted === d;
              return (
                <button key={d} type="button" className={`rl-filter-item${on ? ' rl-filter-item-on' : ''}`} onClick={() => sortTo(d)}>
                  {d === 'asc' ? <ArrowUpIcon size={13} /> : <ArrowDownIcon size={13} />}
                  <span>{labels[i]}</span>
                  {on && <CheckIcon size={13} style={{ marginLeft: 'auto' }} />}
                </button>
              );
            })}
          </div>
        )}
        {filterable && (
          <div className="rl-filter-section" style={sortable ? { borderTop: '1px solid var(--border)' } : undefined}>
            <FilterBody col={col} value={draft} setValue={setDraft} rows={rows} autoFocus onEnter={apply} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 'var(--s3)' }}>
              <button type="button" className="btn btn-ghost" style={{ height: 30, padding: '0 10px' }} onClick={clear}>Clear</button>
              <button type="button" className="btn btn-primary" style={{ height: 30, padding: '0 14px' }} onClick={apply}>Apply</button>
            </div>
          </div>
        )}
      </Popover>
    </th>
  );
}

export function DataTable({
  id,
  columns,
  rows,
  getRowId,
  search = '',
  searchText,
  selection,
  defaultSort,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  loading = false,
  renderMobile,
  emptyTitle = 'Nothing here yet',
  emptyBody,
  summary,
  rowKeyPrefix = '',
  tourId,
  toolbar,
  onRowClick,
  rowTitle,
  bare = false,
}) {
  const [sort, setSort] = useState(defaultSort || null);
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(id);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDraft, setSheetDraft] = useState({});

  const colByKey = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c])), [columns]);

  // A filter is only offered where it can actually narrow something:
  //  - not on a tiny table (nothing to narrow),
  //  - not where every row has the same value,
  //  - not on a text column when the screen already has a search box for it.
  const filterOk = useMemo(() => {
    const ok = {};
    for (const c of columns) {
      if (c.filterable === false || c.type === 'none') { ok[c.key] = false; continue; }
      if (rows.length < MIN_ROWS_TO_FILTER) { ok[c.key] = false; continue; }
      if (!c.type || c.type === 'text') { ok[c.key] = !searchText; continue; }
      const seen = new Set();
      for (const r of rows) {
        const v = c.accessor(r);
        if (v != null && v !== '') seen.add(String(v));
        if (seen.size > 1) break;
      }
      ok[c.key] = seen.size > 1;
    }
    return ok;
  }, [columns, rows, searchText]);

  const setFilter = (key, value) => {
    setFilters((f) => {
      const next = { ...f };
      if (!isActive(colByKey[key], value)) delete next[key]; else next[key] = value;
      return next;
    });
    setPage(1);
  };

  const needle = search.trim().toLowerCase();
  const processed = useMemo(() => {
    let out = rows;
    if (needle && searchText) out = out.filter((r) => searchText(r).toLowerCase().includes(needle));
    for (const [key, v] of Object.entries(filters)) {
      const col = colByKey[key];
      if (col) out = out.filter((r) => matches(col, v, r));
    }
    if (sort && colByKey[sort.key]) {
      const col = colByKey[sort.key];
      out = [...out].sort((a, b) => compare(col, a, b, sort.dir));
    }
    return out;
  }, [rows, needle, searchText, filters, sort, colByKey]);

  const totalPages = Math.max(1, Math.ceil(processed.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = processed.slice((safePage - 1) * pageSize, safePage * pageSize);

  const activeCols = columns.filter((c) => isActive(c, filters[c.key]));
  const clearAll = () => { setFilters({}); setPage(1); };

  const allSelected = !!selection && pageRows.length > 0 && pageRows.every((r) => selection.ids.has(getRowId(r)));
  const filterable = columns.filter((c) => filterOk[c.key]);

  const openSheet = () => {
    setSheetDraft(Object.fromEntries(filterable.map((c) => [c.key, filters[c.key] == null ? (c.type === 'select' ? [] : c.type === 'number' ? { min: '', max: '' } : '') : filters[c.key]])));
    setSheetOpen(true);
  };
  const applySheet = () => {
    const next = {};
    for (const c of filterable) if (isActive(c, sheetDraft[c.key])) next[c.key] = sheetDraft[c.key];
    setFilters(next);
    setPage(1);
    setSheetOpen(false);
  };

  const colSpan = columns.length + (selection ? 1 : 0);

  return (
    <div className="rl-dt" data-tour={tourId}>
      {toolbar && <div className="rl-dt-toolbar" style={{ marginBottom: 'var(--s3)' }}>{toolbar}</div>}
      {(activeCols.length > 0 || summary) && (
        <div className="rl-filter-chips" style={{ justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {activeCols.map((c) => (
              <button key={c.key} type="button" className="rl-filter-chip" onClick={() => setFilter(c.key, null)} aria-label={`Remove ${c.label} filter`}>
                <span><strong>{c.label}</strong> {describe(c, filters[c.key])}</span>
                <XIcon size={12} />
              </button>
            ))}
            {activeCols.length > 1 && <button type="button" className="rl-text-link" style={{ fontSize: 'var(--fs-xs)' }} onClick={clearAll}>Clear all</button>}
          </div>
          {summary && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>{summary(processed.length, rows.length)}</span>}
        </div>
      )}

      <div className="rl-mobile-only rl-dt-mobilebar" style={filterable.length === 0 ? { display: 'none' } : undefined}>
        {filterable.length > 0 && (
          <button type="button" className="btn btn-secondary" style={{ height: 36, gap: 6 }} onClick={openSheet}>
            <FilterIcon size={14} />Filter and sort{activeCols.length ? ` (${activeCols.length})` : ''}
          </button>
        )}
      </div>

      <div className={`data-table-container${renderMobile ? ' rl-hide-mobile' : ''}`} style={bare ? { border: 0, borderRadius: 0, background: 'transparent' } : undefined}>
        <table className="data-table rl-dt-table">
          <thead>
            <tr>
              {selection && (
                <th style={{ width: 40 }}>
                  <input type="checkbox" checked={allSelected} onChange={() => selection.onToggleAll(pageRows)} aria-label="Select all on this page" />
                </th>
              )}
              {columns.map((c) => (
                <Heading key={c.key} col={c} canFilter={!!filterOk[c.key]} sort={sort} setSort={(s) => { setSort(s); setPage(1); }} value={filters[c.key]} setFilter={setFilter} rows={rows} />
              ))}
            </tr>
          </thead>
          {loading ? (
            <TableSkeleton rows={6} columns={colSpan} rowHeight={57} label="Loading" />
          ) : (
            <tbody>
              {pageRows.map((r) => {
                const rid = getRowId(r);
                return (
                  <tr key={`${rowKeyPrefix}${rid}`} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined} title={rowTitle}>
                    {selection && (
                      <td style={{ width: 40 }}>
                        <input type="checkbox" checked={selection.ids.has(rid)} onChange={() => selection.onToggle(rid)} aria-label="Select row" />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={c.mono ? 'mono' : undefined} style={{ textAlign: c.align === 'right' ? 'right' : 'left', whiteSpace: c.nowrap === false ? 'normal' : undefined, ...(c.sticky === 'right' ? STICKY_TD : null) }}>
                        {c.render ? c.render(r) : String(c.accessor(r) ?? '')}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} style={{ textAlign: 'center', padding: 'var(--s6)', color: 'var(--text-3)' }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-2)' }}>{activeCols.length || needle ? 'Nothing matches' : emptyTitle}</div>
                    <div style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>{activeCols.length || needle ? 'Try removing a filter or changing your search.' : emptyBody}</div>
                    {activeCols.length > 0 && <button type="button" className="btn btn-secondary" style={{ marginTop: 'var(--s3)' }} onClick={clearAll}>Clear filters</button>}
                  </td>
                </tr>
              )}
            </tbody>
          )}
        </table>
      </div>

      {renderMobile && (
        <div className="rl-mobile-only" style={{ flexDirection: 'column', gap: 'var(--s3)' }}>
          {selection && pageRows.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
              <input type="checkbox" checked={allSelected} onChange={() => selection.onToggleAll(pageRows)} />Select all on this page
            </label>
          )}
          {loading ? <div style={{ padding: 'var(--s4)', textAlign: 'center', color: 'var(--text-3)' }}>Loading...</div> : pageRows.map((r) => (
            <React.Fragment key={`m-${rowKeyPrefix}${getRowId(r)}`}>{renderMobile(r, { selected: !!selection && selection.ids.has(getRowId(r)), onToggle: selection ? () => selection.onToggle(getRowId(r)) : null })}</React.Fragment>
          ))}
          {!loading && pageRows.length === 0 && <div style={{ padding: 'var(--s5)', textAlign: 'center', color: 'var(--text-3)' }}>{activeCols.length || needle ? 'Nothing matches.' : emptyTitle}</div>}
        </div>
      )}

      {(processed.length > pageSizeOptions[0] || safePage > 1) && <Pagination
        page={safePage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={processed.length}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        pageSizeOptions={processed.length > pageSizeOptions[0] ? pageSizeOptions : undefined}
      />}

      <Modal isOpen={sheetOpen} onClose={() => setSheetOpen(false)} title="Filter and sort" width="440px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          {columns.filter((c) => c.sortable !== false).length > 0 && (
            <div>
              <div className="rl-filter-title">Sort by</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {columns.filter((c) => c.sortable !== false).flatMap((c) => ['asc', 'desc'].map((d) => {
                  const on = sort && sort.key === c.key && sort.dir === d;
                  return (
                    <button key={`${c.key}-${d}`} type="button" className={`chip ${on ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 10px' }} onClick={() => setSort(on ? null : { key: c.key, dir: d })}>
                      {c.label} {d === 'asc' ? '↑' : '↓'}
                    </button>
                  );
                }))}
              </div>
            </div>
          )}
          {filterable.map((c) => (
            <div key={c.key}>
              <div className="rl-filter-title">{c.label}</div>
              <FilterBody col={c} value={sheetDraft[c.key]} setValue={(v) => setSheetDraft((d) => ({ ...d, [c.key]: v }))} rows={rows} />
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={() => { clearAll(); setSheetOpen(false); }}>Clear all</button>
            <button type="button" className="btn btn-primary" onClick={applySheet}>Apply</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
