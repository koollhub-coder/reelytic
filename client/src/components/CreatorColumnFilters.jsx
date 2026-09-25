import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FilterIcon, ArrowUpIcon, ArrowDownIcon, CheckIcon } from './Icon';

/*
  Excel-style column filters for the Creators table: click a column heading,
  get a small panel with sort options and a filter for that column, press
  Apply. The people using this work in spreadsheets all day, so this copies
  the thing they already know rather than inventing a new filter language.

  Everything filters on the server (see creatorDb.service.js buildFilter),
  because the creator list can be far bigger than what the browser holds.
  This file only builds the controls and describes the active filters.
*/

export const GOOD_ER = 2; // engagement above this gets the green badge

// Typing "10k" or "1.5m" is how people write follower counts. Returns '' for
// blank, NaN for something that is not a number.
export function parseCount(value) {
  const t = String(value == null ? '' : value).trim().toLowerCase().replace(/,/g, '');
  if (!t) return '';
  const m = t.match(/^(\d+(?:\.\d+)?)\s*([km])?$/);
  if (!m) return NaN;
  const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1;
  return Math.round(parseFloat(m[1]) * mult);
}

function parsePercent(value) {
  const t = String(value == null ? '' : value).trim().replace('%', '');
  if (!t) return '';
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export function compact(n) {
  if (n == null || n === '') return '';
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(n);
}

// What the server should receive for one numeric filter, whether the value was
// committed as a number (heading popover) or is still raw text (mobile sheet,
// where every keystroke applies). Anything unusable becomes '' and is dropped.
export function filterNumber(key, value) {
  const n = key === 'minEr' || key === 'maxEr' ? parsePercent(value) : parseCount(value);
  return Number.isNaN(n) ? '' : n;
}

export const EMPTY_FILTERS = {
  search: '',
  sort: 'recent',
  dir: '',
  minFollowers: '', maxFollowers: '',
  minEr: '', maxEr: '',
  minViews: '', maxViews: '',
  minTimes: '', maxTimes: '',
  gender: [],
  campaignIds: [],
};

const FOLLOWER_PRESETS = [
  { label: 'Nano (under 10K)', patch: { minFollowers: '', maxFollowers: 9999 } },
  { label: 'Micro (10K to 100K)', patch: { minFollowers: 10000, maxFollowers: 99999 } },
  { label: 'Mid (100K to 500K)', patch: { minFollowers: 100000, maxFollowers: 499999 } },
  { label: 'Macro (500K and up)', patch: { minFollowers: 500000, maxFollowers: '' } },
];
const ER_PRESETS = [
  { label: '2% and up', patch: { minEr: 2, maxEr: '' } },
  { label: '5% and up', patch: { minEr: 5, maxEr: '' } },
  { label: '10% and up', patch: { minEr: 10, maxEr: '' } },
];

// One entry per column. `keys` are the filter fields a column owns, which is
// what "Clear" resets and what decides whether its heading shows as filtered.
export const COLUMNS = {
  creator: { label: 'Creator', type: 'text', sortKey: 'name', sortLabels: ['Sort A to Z', 'Sort Z to A'], keys: ['search'] },
  engagement: { label: 'Engagement', type: 'range', kind: 'percent', minKey: 'minEr', maxKey: 'maxEr', sortKey: 'engagement', presets: ER_PRESETS, keys: ['minEr', 'maxEr'] },
  followers: { label: 'Followers', type: 'range', kind: 'count', minKey: 'minFollowers', maxKey: 'maxFollowers', sortKey: 'followers', presets: FOLLOWER_PRESETS, keys: ['minFollowers', 'maxFollowers'] },
  views: { label: 'Avg views', type: 'range', kind: 'count', minKey: 'minViews', maxKey: 'maxViews', sortKey: 'views', keys: ['minViews', 'maxViews'] },
  gender: { label: 'Gender', type: 'gender', keys: ['gender'] },
  times: { label: 'Reports', type: 'range', kind: 'count', minKey: 'minTimes', maxKey: 'maxTimes', sortKey: 'timesAnalyzed', keys: ['minTimes', 'maxTimes'] },
  campaigns: { label: 'Campaigns', type: 'campaigns', keys: ['campaignIds'] },
};

const isSet = (v) => (Array.isArray(v) ? v.length > 0 : v !== '' && v != null);
export const columnActive = (col, f) => COLUMNS[col].keys.some((k) => isSet(f[k]));
export const anyFilterActive = (f) => Object.keys(COLUMNS).some((c) => columnActive(c, f));
export const clearPatch = (col) => Object.fromEntries(COLUMNS[col].keys.map((k) => [k, EMPTY_FILTERS[k]]));

// The chips shown under the search bar, one per active column filter.
export function describeFilters(f, campaigns) {
  const out = [];
  const range = (col, fmt) => {
    const c = COLUMNS[col];
    const lo = f[c.minKey];
    const hi = f[c.maxKey];
    if (!isSet(lo) && !isSet(hi)) return;
    let text;
    if (isSet(lo) && isSet(hi)) text = `${fmt(lo)} to ${fmt(hi)}`;
    else if (isSet(lo)) text = `${fmt(lo)} and up`;
    else text = `up to ${fmt(hi)}`;
    out.push({ col, label: `${c.label}: ${text}` });
  };
  if (isSet(f.search)) out.push({ col: 'creator', label: `Creator starts with "${f.search}"` });
  range('engagement', (v) => `${v}%`);
  range('followers', compact);
  range('views', compact);
  range('times', String);
  if (f.gender.length) out.push({ col: 'gender', label: `Gender: ${f.gender.map((g) => g[0].toUpperCase() + g.slice(1)).join(', ')}` });
  if (f.campaignIds.length) {
    const names = f.campaignIds.map((id) => (campaigns.find((c) => c.id === id) || {}).name).filter(Boolean);
    out.push({ col: 'campaigns', label: `Campaign: ${names.join(', ') || f.campaignIds.length + ' selected'}` });
  }
  return out;
}

// A panel that floats under its heading. Portaled to <body> with fixed
// coordinates because the table container clips anything absolutely
// positioned inside it (same reason Tooltip.jsx is portaled).
export function Popover({ anchorRef, open, onClose, width = 264, align = 'left', children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const left = align === 'right' ? r.right - width : r.left;
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
    });
  }, [open, anchorRef, width, align]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onScroll = (e) => { if (!ref.current || !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;
  return createPortal(
    <div ref={ref} role="dialog" className="rl-filter-popover" style={{ top: pos.top, left: pos.left, width }}>
      {children}
    </div>,
    document.body,
  );
}

function Checkbox({ checked, onChange, children }) {
  return (
    <label className="rl-filter-check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

// The controls for one column, editing a draft object. Used inside the
// heading popover (draft committed by Apply) and inside the mobile filter
// sheet (draft IS the live filters, so every change applies at once).
export function FilterControls({ column, draft, setDraft, campaigns, onApply }) {
  const col = COLUMNS[column];
  const enter = (e) => { if (e.key === 'Enter' && onApply) onApply(); };

  if (col.type === 'text') {
    return (
      <input
        type="text"
        className="input-field"
        style={{ width: '100%' }}
        placeholder="Starts with, e.g. anu"
        value={draft.search}
        onChange={(e) => setDraft({ search: e.target.value })}
        onKeyDown={enter}
        autoFocus={!!onApply}
      />
    );
  }

  if (col.type === 'gender') {
    const toggle = (g) => setDraft({ gender: draft.gender.includes(g) ? draft.gender.filter((x) => x !== g) : [...draft.gender, g] });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <Checkbox checked={draft.gender.includes('female')} onChange={() => toggle('female')}>Female</Checkbox>
        <Checkbox checked={draft.gender.includes('male')} onChange={() => toggle('male')}>Male</Checkbox>
        <Checkbox checked={draft.gender.includes('unknown')} onChange={() => toggle('unknown')}>Not sure</Checkbox>
        <div className="rl-filter-note">Gender is estimated from the creator's name. You can correct any row by clicking its gender.</div>
      </div>
    );
  }

  if (col.type === 'campaigns') {
    if (!campaigns.length) return <div className="rl-filter-note">No campaigns yet. Create one from History and it will show up here.</div>;
    const toggle = (id) => setDraft({ campaignIds: draft.campaignIds.includes(id) ? draft.campaignIds.filter((x) => x !== id) : [...draft.campaignIds, id] });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '220px', overflowY: 'auto' }}>
        {campaigns.map((c) => (
          <Checkbox key={c.id} checked={draft.campaignIds.includes(c.id)} onChange={() => toggle(c.id)}>{c.name}</Checkbox>
        ))}
      </div>
    );
  }

  // range
  const suffix = col.kind === 'percent' ? '%' : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
      {col.presets && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {col.presets.map((p) => {
            const on = Object.entries(p.patch).every(([k, v]) => draft[k] === v);
            return (
              <button
                key={p.label}
                type="button"
                className={`chip ${on ? 'accent' : ''}`}
                style={{ cursor: 'pointer', padding: '5px 10px' }}
                onClick={() => setDraft(on ? clearPatch(column) : p.patch)}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="text"
          inputMode="decimal"
          className="input-field"
          style={{ width: '100%', minWidth: 0 }}
          placeholder={`Min${suffix ? ' %' : ''}`}
          value={draft[col.minKey]}
          onChange={(e) => setDraft({ [col.minKey]: e.target.value })}
          onKeyDown={enter}
        />
        <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>to</span>
        <input
          type="text"
          inputMode="decimal"
          className="input-field"
          style={{ width: '100%', minWidth: 0 }}
          placeholder={`Max${suffix ? ' %' : ''}`}
          value={draft[col.maxKey]}
          onChange={(e) => setDraft({ [col.maxKey]: e.target.value })}
          onKeyDown={enter}
        />
      </div>
      {col.kind === 'count' && <div className="rl-filter-note">You can type 10k or 1.5m.</div>}
    </div>
  );
}

// Turns whatever is typed in the boxes into real numbers before it reaches
// the filters. Invalid text is dropped rather than sent to the server.
function commitDraft(column, draft) {
  const col = COLUMNS[column];
  const out = {};
  for (const k of col.keys) {
    const v = draft[k];
    if (col.type === 'range') {
      const n = col.kind === 'percent' ? parsePercent(v) : parseCount(v);
      out[k] = Number.isNaN(n) ? '' : n;
    } else {
      out[k] = v;
    }
  }
  return out;
}

const dirOf = (f, sortKey) => f.dir || (sortKey === 'name' ? 'asc' : 'desc');

// One column heading: label, current sort arrow, and a funnel that fills in
// once that column is filtered. Opens the panel below it.
export function ColumnHead({ column, filters, setFilters, campaigns, align = 'left', numeric = false }) {
  const col = COLUMNS[column];
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraftState] = useState({});

  const active = columnActive(column, filters);
  const sorted = col.sortKey && filters.sort === col.sortKey ? dirOf(filters, col.sortKey) : null;

  const openPanel = () => {
    setDraftState(Object.fromEntries(col.keys.map((k) => [k, filters[k]])));
    setOpen((o) => !o);
  };
  const setDraft = (patch) => setDraftState((d) => ({ ...d, ...patch }));
  const apply = () => { setFilters(commitDraft(column, { ...filters, ...draft })); setOpen(false); };
  const clear = () => { setFilters(clearPatch(column)); setOpen(false); };
  const sortBy = (dir) => { setFilters({ sort: col.sortKey, dir }); setOpen(false); };
  const hasFilter = col.keys.length > 0;

  return (
    <th className={numeric ? 'numeric' : undefined} aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        ref={btnRef}
        type="button"
        className={`rl-colhead${active || sorted ? ' rl-colhead-on' : ''}`}
        onClick={openPanel}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={numeric ? { marginLeft: 'auto' } : undefined}
      >
        <span>{col.label}</span>
        {sorted === 'asc' && <ArrowUpIcon size={12} />}
        {sorted === 'desc' && <ArrowDownIcon size={12} />}
        <FilterIcon size={12} style={{ opacity: active ? 1 : 0.45 }} fill={active ? 'currentColor' : 'none'} />
      </button>
      <Popover anchorRef={btnRef} open={open} onClose={() => setOpen(false)} align={align}>
        {col.sortKey && (
          <div className="rl-filter-section">
            {['asc', 'desc'].map((d) => {
              const label = col.sortLabels ? col.sortLabels[d === 'asc' ? 0 : 1] : (d === 'asc' ? 'Sort low to high' : 'Sort high to low');
              const on = sorted === d;
              return (
                <button key={d} type="button" className={`rl-filter-item${on ? ' rl-filter-item-on' : ''}`} onClick={() => sortBy(d)}>
                  {d === 'asc' ? <ArrowUpIcon size={13} /> : <ArrowDownIcon size={13} />}
                  <span>{label}</span>
                  {on && <CheckIcon size={13} style={{ marginLeft: 'auto' }} />}
                </button>
              );
            })}
            {column === 'creator' && (
              <button
                type="button"
                className={`rl-filter-item${filters.sort === 'recent' ? ' rl-filter-item-on' : ''}`}
                onClick={() => { setFilters({ sort: 'recent', dir: '' }); setOpen(false); }}
              >
                <span>Most recently analyzed</span>
                {filters.sort === 'recent' && <CheckIcon size={13} style={{ marginLeft: 'auto' }} />}
              </button>
            )}
          </div>
        )}
        {hasFilter && (
          <div className="rl-filter-section" style={{ borderTop: col.sortKey ? '1px solid var(--border)' : 'none' }}>
            <div className="rl-filter-title">Filter</div>
            <FilterControls column={column} draft={draft} setDraft={setDraft} campaigns={campaigns} onApply={apply} />
            <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--s3)' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1, height: '32px' }} onClick={clear}>Clear</button>
              <button type="button" className="btn btn-primary" style={{ flex: 1, height: '32px' }} onClick={apply}>Apply</button>
            </div>
          </div>
        )}
      </Popover>
    </th>
  );
}
