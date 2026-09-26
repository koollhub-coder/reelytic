import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { CampaignAvatar } from '../components/CampaignAvatar';
import { EmptyState } from '../components/EmptyState';
import { TableSkeleton } from '../components/TableSkeleton';
import { Pagination } from '../components/Pagination';
import { usePageSize, PAGE_SIZE_OPTIONS } from '../utils/pagination';
import { UpgradeDialog, PREMIUM_FEATURES } from '../components/Premium';
import { Select } from '../components/Select';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Tooltip } from '../components/Tooltip';
import { useToast } from '../context/ToastContext';
import { SearchIcon, UsersIcon, DownloadIcon, PlusIcon, XIcon } from '../components/Icon';
import {
  COLUMNS, EMPTY_FILTERS, GOOD_ER, ColumnHead, FilterControls, Popover,
  anyFilterActive, clearPatch, describeFilters, filterNumber,
} from '../components/CreatorColumnFilters';

/*
  Every creator this account has ever run a reel or profile report on, in
  one searchable place -- built automatically from those reports rather than
  something anyone has to maintain by hand. See creatorDb.service.js on the
  server for how this stays fast at up to a million rows: a maintained
  collection updated incrementally as reports run, not a live aggregation
  over report history on every page load.

  WHAT THIS SCREEN IS FOR.
  It answers "should I use this creator again?". Each row leads with the one
  number that decides that (engagement, in green when it is above 2%), then
  who they are, how big they are, and how often they have been analyzed.
  Everything else (reel vs profile breakdown, which reports, first-seen date)
  is one click away in the expanded detail, not on every row.

  FILTERING AND SORTING.
  Click any column heading, Excel style: sort that column, or filter it, then
  press Apply. All of it runs on the server (creatorDb.service.js
  buildFilter), so it narrows the whole database and not just what happens to
  be loaded in the browser.

  Loading strategy (the reason this isn't just "fetch everything then
  paginate client-side"): this collection can be far larger than anything a
  client should hold in memory. So the first page of rows renders at once,
  more pages stream in behind them up to WARM_CAP (paging inside that window
  is a plain array slice), and paging past it costs one real request via the
  server's keyset cursor. Any change to a filter or sort starts that whole
  sequence again from the server.
*/

// How many rows one server request brings back. Not the page size shown; that
// is the shared, remembered choice from utils/pagination.
const FETCH_CHUNK = 50;
const WARM_CAP = 500;

// Old saved views stored a follower tier by name; column filters store a
// range. This maps the old names so a view saved last month still applies.
const LEGACY_TIERS = {
  nano: { maxFollowers: 9999 },
  micro: { minFollowers: 10000, maxFollowers: 99999 },
  mid: { minFollowers: 100000, maxFollowers: 499999 },
  macro: { minFollowers: 500000 },
};

const SHEET_SORTS = [
  { value: 'recent:', label: 'Most recently analyzed' },
  { value: 'engagement:desc', label: 'Highest engagement' },
  { value: 'followers:desc', label: 'Most followers' },
  { value: 'views:desc', label: 'Most average views' },
  { value: 'timesAnalyzed:desc', label: 'Most reports' },
  { value: 'name:asc', label: 'Name A to Z' },
];

const RANGE_KEYS = ['minFollowers', 'maxFollowers', 'minEr', 'maxEr', 'minViews', 'maxViews', 'minTimes', 'maxTimes'];

// The exact query string for a filter set. One builder, used by the list, the
// background paging and the CSV link, so none of them can drift apart.
function buildParams(f, scope) {
  const params = new URLSearchParams();
  if (f.search.trim()) params.set('search', f.search.trim());
  if (scope) params.set('scope', scope);
  if (f.sort && f.sort !== 'recent') params.set('sort', f.sort);
  if (f.dir) params.set('dir', f.dir);
  for (const k of RANGE_KEYS) {
    const n = filterNumber(k, f[k]);
    if (n !== '') params.set(k, String(n));
  }
  if (f.gender.length) params.set('gender', f.gender.join(','));
  if (f.campaignIds.length) params.set('campaignId', f.campaignIds.join(','));
  return params;
}

// What gets stored in a saved view. Kept in the server's own vocabulary
// (campaignId as a comma list, gender as a comma list) so the segments route
// stays a plain whitelist.
function toSegmentFilters(f) {
  const out = { search: f.search, sort: f.sort, dir: f.dir, gender: f.gender.join(','), campaignId: f.campaignIds.join(',') };
  for (const k of RANGE_KEYS) out[k] = filterNumber(k, f[k]);
  return out;
}

function fromSegmentFilters(seg) {
  const next = { ...EMPTY_FILTERS, gender: [], campaignIds: [] };
  next.search = seg.search || '';
  next.sort = seg.sort || 'recent';
  next.dir = seg.dir || '';
  if (seg.followerTier && LEGACY_TIERS[seg.followerTier]) Object.assign(next, LEGACY_TIERS[seg.followerTier]);
  if (Number(seg.minEr)) next.minEr = Number(seg.minEr);
  for (const k of RANGE_KEYS) if (seg[k] !== '' && seg[k] != null) next[k] = seg[k];
  next.gender = seg.gender ? String(seg.gender).split(',').filter(Boolean) : [];
  next.campaignIds = seg.campaignId ? String(seg.campaignId).split(',').filter(Boolean) : [];
  return next;
}

const segmentKey = (f) => JSON.stringify(toSegmentFilters(f));

function formatCompactNumber(n) {
  if (n == null) return '-';
  // +x drops a trailing ".0", so 27000 reads 27K rather than 27.0K.
  if (n >= 1000000) return `${+(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}K`;
  return String(n);
}

// Whichever of Reel/Profile average ER is higher is "this creator's best
// performance" -- same rule the server's bestAvgEr sort/filter already
// uses, just resolved here so the expanded detail can also say WHICH
// report type it came from (a number alone doesn't answer that).
function bestPerformance(creator) {
  const reelEr = creator.reel.count ? creator.reel.avgEr : null;
  const profileEr = creator.profile.count ? creator.profile.avgEr : null;
  if (reelEr == null && profileEr == null) return null;
  if (profileEr == null || (reelEr != null && reelEr >= profileEr)) {
    return { type: 'Reel', er: reelEr, views: creator.reel.avgViews };
  }
  return { type: 'Profile', er: profileEr, views: creator.profile.avgViews };
}

// The small "why does Profile ER look so different from Reel ER" clarifier
// -- see client/src/content/profileMethodology.js for the fuller version.
const PROFILE_ER_TOOLTIP = 'Engagement per FOLLOWER, not per view. That is a different measure than Reel ER, which is per view, so the two are not meant to be compared directly. See "How is this calculated?" for the full formula.';

// The creator's headline engagement, resolved once. Prefers the stored value
// the server sorts and filters on, falling back to the same rule client-side
// for a row the backfill has not reached yet.
function headlineEr(creator) {
  if (creator.bestAvgEr != null && creator.bestType) {
    return { er: creator.bestAvgEr, type: creator.bestType === 'profile' ? 'Profile' : 'Reel', views: creator.bestAvgViews };
  }
  const best = bestPerformance(creator);
  return best ? { er: best.er, type: best.type, views: best.views } : null;
}

// Green badge above 2%, quiet grey at or below. Always the first thing in a
// row. The tooltip says which report type the number came from, because a
// Reel rate (per view) and a Profile rate (per follower) are not the same
// measure.
function ErBadge({ creator }) {
  const h = headlineEr(creator);
  if (!h || h.er == null) return <span style={{ color: 'var(--text-3)' }}>-</span>;
  const good = h.er > GOOD_ER;
  const tip = h.type === 'Profile' ? PROFILE_ER_TOOLTIP : 'Reel engagement: likes and comments per view, averaged across their Reel reports.';
  return (
    <Tooltip content={good ? `Above ${GOOD_ER}%. ${tip}` : tip} maxWidth={260}>
      <span className={`rl-er-badge${good ? ' rl-er-badge-good' : ''}`}>{h.er}%</span>
    </Tooltip>
  );
}

// Gender is an estimate from the name (gender.service.js), so this shows
// "est." beside it and lets anyone correct it. A corrected value sticks.
function GenderCell({ creator, onChange }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const label = creator.gender === 'female' ? 'Female' : creator.gender === 'male' ? 'Male' : 'Not sure';
  const pick = (g) => { setOpen(false); if (g !== creator.gender) onChange(creator, g); };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`rl-gender-pill${creator.gender ? '' : ' rl-gender-pill-empty'}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        aria-haspopup="dialog"
        aria-label={`Gender: ${label}. Click to change.`}
      >
        {label}
        {creator.gender && creator.genderSource === 'inferred' && <span style={{ color: 'var(--text-3)', fontSize: '10px' }}>est.</span>}
      </button>
      <Popover anchorRef={btnRef} open={open} onClose={() => setOpen(false)} width={190}>
        <div className="rl-filter-section" onClick={(e) => e.stopPropagation()}>
          <div className="rl-filter-title">Set gender</div>
          {[['female', 'Female'], ['male', 'Male'], [null, 'Not sure']].map(([value, text]) => (
            <button
              key={text}
              type="button"
              className={`rl-filter-item${(creator.gender || null) === value ? ' rl-filter-item-on' : ''}`}
              onClick={() => pick(value)}
            >
              {text}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

// Two campaign tags, then "+N". A creator in six campaigns used to stretch
// its row to fill the screen.
function CampaignTags({ campaigns }) {
  if (!campaigns.length) return <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>-</span>;
  const shown = campaigns.slice(0, 2);
  const extra = campaigns.length - shown.length;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'flex-start' }}>
      {shown.map((c) => <span key={c.id} className="chip" style={{ fontSize: '10px' }}>{c.name}</span>)}
      {extra > 0 && (
        <Tooltip content={campaigns.slice(2).map((c) => c.name).join(', ')}>
          <span className="chip" style={{ fontSize: '10px' }}>+{extra}</span>
        </Tooltip>
      )}
    </div>
  );
}

function CreatorIdentity({ creator, size = 32 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0 }}>
      <CampaignAvatar name={creator.name || creator.username} size={size} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '260px' }}>
          {creator.name || creator.username}
        </div>
        {creator.profileLink ? (
          <a
            href={creator.profileLink}
            target="_blank"
            rel="noreferrer"
            className="mono"
            onClick={(e) => e.stopPropagation()}
            style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}
          >
            @{creator.username}
          </a>
        ) : (
          <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>@{creator.username}</span>
        )}
      </div>
    </div>
  );
}

// One creator per row. Every column is left aligned, header and content, so
// the eye can run straight down any column.
function CreatorRow({ creator, onGenderChange }) {
  const h = headlineEr(creator);
  return (
    <>
      <tr>
        <td style={{ width: '1%', whiteSpace: 'nowrap' }}><ErBadge creator={creator} /></td>
        <td>
          <CreatorIdentity creator={creator} />
        </td>
        <td className="mono">{formatCompactNumber(creator.followers)}</td>
        <td className="mono">{h && h.views != null ? formatCompactNumber(h.views) : '-'}</td>
        <td><GenderCell creator={creator} onChange={onGenderChange} /></td>
        <td className="mono">{creator.timesAnalyzed}</td>
        <td><CampaignTags campaigns={creator.campaigns} /></td>
      </tr>
    </>
  );
}

// Mobile: one card per creator instead of the same columns squeezed into a
// horizontal scroll.
function CreatorCardMobile({ creator, onGenderChange }) {
  const h = headlineEr(creator);
  return (
    <div className="card" style={{ padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0 }}>
        <ErBadge creator={creator} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <CreatorIdentity creator={creator} size={30} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--s4)', marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{formatCompactNumber(creator.followers)}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Followers</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{h && h.views != null ? formatCompactNumber(h.views) : '-'}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Avg views</div>
        </div>
        <GenderCell creator={creator} onChange={onGenderChange} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s2)', marginTop: 'var(--s3)' }}>
        {creator.campaigns.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', minWidth: 0 }}>
            {creator.campaigns.map((c) => (
              <span key={c.id} className="chip" style={{ fontSize: '10px' }}>{c.name}</span>
            ))}
          </div>
        ) : <span />}
        <span className="mono" style={{ fontSize: '10px', color: 'var(--text-3)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {creator.timesAnalyzed}x analyzed
        </span>
      </div>
    </div>
  );
}

const COLUMN_ORDER = ['engagement', 'creator', 'followers', 'views', 'gender', 'times', 'campaigns'];

export function Creators() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const locked = !user?.features?.creatorDatabase;

  const [filters, setFiltersState] = useState(EMPTY_FILTERS);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(null); // how many creators match the current filters
  const [cursor, setCursor] = useState(null); // where the next server fetch (warm or on-demand) resumes from
  const [hasMore, setHasMore] = useState(false); // server has more beyond what's currently loaded
  const [warming, setWarming] = useState(false); // background fill-to-WARM_CAP in flight -- deliberately not shown as a blocking spinner
  const [loading, setLoading] = useState(true); // the one fetch the user actually waits on
  const [extending, setExtending] = useState(false); // on-demand fetch past the warmed window -- this one IS a real wait
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('creators');
  const [error, setError] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [scope, setScope] = useState('all'); // admin only: 'all' | 'mine'
  const [campaigns, setCampaigns] = useState([]);
  const [segments, setSegments] = useState([]);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [savingView, setSavingView] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false); // mobile only: opens the filter sheet Modal below
  const [summary, setSummary] = useState(null); // the "1,248 creators · ..." header line
  const [segmentToDelete, setSegmentToDelete] = useState(null);

  const runId = useRef(0);

  // Merge a change into the current filters. Sorting by a column while
  // filtering it is the normal case, so this is a merge, not a replace.
  const setFilters = useCallback((patch) => setFiltersState((prev) => ({ ...prev, ...patch })), []);
  const resetFilters = () => setFiltersState({ ...EMPTY_FILTERS, gender: [], campaignIds: [] });

  // Reference data for the page -- campaigns to filter by, saved segments to
  // reapply, and the header summary line. Independent of the row query below.
  useEffect(() => {
    if (locked) return;
    apiFetch('/campaigns').then((res) => setCampaigns(res.campaigns || [])).catch(() => {});
    apiFetch('/creators/segments').then((res) => setSegments(res.segments || [])).catch(() => {});
  }, [locked]);

  useEffect(() => {
    if (locked) return;
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    apiFetch(`/creators/summary?${params.toString()}`).then(setSummary).catch(() => {});
  }, [locked, scope]);

  const fetchPage = useCallback((afterCursor, f, sc) => {
    const params = buildParams(f, sc);
    params.set('limit', String(FETCH_CHUNK));
    if (afterCursor) params.set('cursor', afterCursor);
    return apiFetch(`/creators?${params.toString()}`);
  }, []);

  // Debounced 300ms after the last change, so typing in a box does not fire a
  // request per keystroke. This object (not the live filter state) is what
  // the first-page query is keyed and fetched by.
  const [debounced, setDebounced] = useState(null);
  useEffect(() => {
    if (locked) return undefined;
    const handle = setTimeout(() => setDebounced({ filters, scope }), 300);
    return () => clearTimeout(handle);
  }, [locked, filters, scope]);

  // Only the FIRST page is cached (App.jsx's staleTime makes "Creators ->
  // History -> Creators" with the same filters instant). Pages 2+ stream in
  // fresh via the warm-drain loop below.
  const firstPageQuery = useQuery({
    queryKey: ['creators', debounced],
    queryFn: () => fetchPage(null, debounced.filters, debounced.scope),
    enabled: !locked && !!debounced,
  });

  // Reseeds rows/cursor/hasMore from the first page the moment it's
  // available, then runs the background warm-drain up to WARM_CAP, guarded by
  // runId cancellation.
  useEffect(() => {
    if (locked) { setLoading(false); return undefined; }
    if (!debounced) return undefined;
    if (firstPageQuery.error) {
      setError(firstPageQuery.error.message || "Couldn't load the creator database, try again.");
      setLoading(false);
      return undefined;
    }
    if (!firstPageQuery.data) {
      setLoading(true);
      return undefined;
    }

    const id = ++runId.current;
    setError('');
    setPage(1);
    const res = firstPageQuery.data;
    const firstRows = res.creators || [];
    setRows(firstRows);
    setTotal(typeof res.total === 'number' ? res.total : null);
    setCursor(res.nextCursor || null);
    setHasMore(!!res.nextCursor);
    setLoading(false);

    if (!res.nextCursor) return undefined;
    setWarming(true);
    (async () => {
      let acc = firstRows;
      let nextCursor = res.nextCursor;
      while (nextCursor && acc.length < WARM_CAP) {
        if (id !== runId.current) return;
        // eslint-disable-next-line no-await-in-loop
        const chunk = await fetchPage(nextCursor, debounced.filters, debounced.scope).catch(() => null);
        if (!chunk || id !== runId.current) break;
        acc = acc.concat(chunk.creators || []);
        nextCursor = chunk.nextCursor || null;
        setRows(acc);
        setCursor(nextCursor);
        setHasMore(!!nextCursor);
      }
      if (id === runId.current) setWarming(false);
    })();
    return () => { runId.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, debounced, firstPageQuery.data, firstPageQuery.error]);

  const totalPages = Math.ceil(rows.length / pageSize);

  // Paging within what's already warmed is a plain slice -- no request.
  // Paging past it can only step one page forward from the server's cursor.
  const handlePageChange = (nextPage) => {
    if (nextPage < 1) return;
    if (nextPage <= totalPages) { setPage(nextPage); return; }
    if (!hasMore || !cursor || extending || !debounced) return;
    const id = runId.current;
    setExtending(true);
    fetchPage(cursor, debounced.filters, debounced.scope)
      .then((res) => {
        if (id !== runId.current) return;
        setRows((prev) => prev.concat(res.creators || []));
        setCursor(res.nextCursor || null);
        setHasMore(!!res.nextCursor);
        setPage(nextPage);
      })
      .catch((err) => setError(err.message || "Couldn't load more, try again."))
      .finally(() => { if (id === runId.current) setExtending(false); });
  };

  const filtersOn = anyFilterActive(filters);
  const isDefaultView = !filtersOn && filters.sort === 'recent';
  const chips = describeFilters(filters, campaigns);

  // A saved segment is the whole filter set bundled -- applying one sets all
  // of it at once. Deliberately excludes `scope`: which accounts to look
  // across isn't "what I'm looking for", it's a separate toggle.
  const applySegment = (segment) => setFiltersState(fromSegmentFilters(segment.filters || {}));
  const segmentIsActive = (segment) => segmentKey(fromSegmentFilters(segment.filters || {})) === segmentKey(filters);

  const handleSaveView = async () => {
    if (!saveViewName.trim()) return;
    setSavingView(true);
    try {
      const res = await apiFetch('/creators/segments', {
        method: 'POST',
        body: JSON.stringify({ name: saveViewName.trim(), filters: toSegmentFilters(filters) }),
      });
      setSegments((prev) => [res.segment, ...prev]);
      addToast('View saved', 'ok');
      setSaveViewOpen(false);
      setSaveViewName('');
    } catch (err) {
      addToast(err.message || "Couldn't save this view, try again.", 'error');
    } finally {
      setSavingView(false);
    }
  };

  const handleDeleteSegment = async (id) => {
    const prev = segments;
    setSegments((s) => s.filter((seg) => seg.id !== id));
    try {
      await apiFetch(`/creators/segments/${id}`, { method: 'DELETE' });
    } catch (err) {
      setSegments(prev);
      addToast(err.message || "Couldn't delete that view, try again.", 'error');
    }
  };

  // Correcting an estimated gender. Optimistic: the row changes at once, the
  // cached first page is patched so it does not flip back on the next
  // refetch, and a failure rolls the row back.
  const handleGenderChange = async (creator, gender) => {
    const patchRow = (g, source) => (c) => (c.id === creator.id ? { ...c, gender: g, genderSource: source } : c);
    const before = { gender: creator.gender, genderSource: creator.genderSource };
    setRows((prev) => prev.map(patchRow(gender, gender ? 'manual' : null)));
    try {
      const res = await apiFetch(`/creators/${encodeURIComponent(creator.id)}/gender`, { method: 'PATCH', body: JSON.stringify({ gender }) });
      queryClient.setQueriesData({ queryKey: ['creators'] }, (old) => (old && old.creators ? { ...old, creators: old.creators.map(patchRow(res.gender, res.genderSource)) } : old));
    } catch (err) {
      setRows((prev) => prev.map(patchRow(before.gender, before.genderSource)));
      addToast(err.message || "Couldn't update that, try again.", 'error');
    }
  };

  // The export mirrors whatever's currently filtered/searched/sorted -- a
  // plain same-origin link, not a fetch, so the browser's own session
  // cookie carries auth and the download just happens.
  const exportHref = () => `/api/creators/export.csv?${buildParams(filters, scope).toString()}`;

  if (locked) {
    return (
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
          Creator database
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s6)' }}>
          Every creator you have analyzed, in one searchable place.
        </p>
        {/* Same data-tour anchor as the unlocked page's heading below --
            the product tour (DemoGuide.jsx) visits this page for every new
            account regardless of plan, and a free/unlimited account only
            ever renders THIS branch. */}
        <div data-tour="creators-page">
          <EmptyState
            title="Available on Starter, Pro and Agency"
            description="Every reel and profile report you run automatically builds this out: followers, average views and engagement per creator, tagged with which campaigns they showed up in."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setUpgradeOpen(true)}>
                See plans
              </button>
            }
          />
        </div>
        <UpgradeDialog isOpen={upgradeOpen} onClose={() => setUpgradeOpen(false)} feature={PREMIUM_FEATURES.creatorDatabase} />
      </div>
    );
  }

  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const sheetSortValue = `${filters.sort}:${filters.sort === 'recent' ? '' : (filters.dir || (filters.sort === 'name' ? 'asc' : 'desc'))}`;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s3)' }} data-tour="creators-page">
        <div>
          <h1 className="rl-page-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s1)' }}>
            Creator database
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>
            {user?.role === 'admin' ? 'Every creator analyzed on the platform, built from every account’s reports.' : 'Every creator you have analyzed, built automatically from your reports.'}
          </p>
        </div>
      </div>

      {/* The database summary -- a stable orientation line, independent of
          whatever's currently searched/filtered below it. */}
      {summary && (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginBottom: 'var(--s4)', display: 'flex', flexWrap: 'wrap', columnGap: '8px', rowGap: '2px' }}>
          <span><strong style={{ color: 'var(--text)' }}>{summary.total.toLocaleString()}</strong> creators</span>
          <span style={{ color: 'var(--text-3)' }}>·</span>
          <span><strong style={{ color: 'var(--text)' }}>{summary.analyzedThisMonth.toLocaleString()}</strong> analyzed this month</span>
          {summary.engaged != null && (
            <>
              <span style={{ color: 'var(--text-3)' }}>·</span>
              <span><strong style={{ color: 'var(--ok)' }}>{summary.engaged.toLocaleString()}</strong> with engagement above {GOOD_ER}%</span>
            </>
          )}
        </div>
      )}

      {/* Saved views: bookmark "High performers", "Client A", "Re-engage" and
          reapply with one click. A horizontally scrollable strip so any
          number of them still fits on a phone. */}
      <div
        className="rl-segment-tabs"
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--s5)',
          overflowX: 'auto', whiteSpace: 'nowrap',
          borderBottom: '1px solid var(--border)', marginBottom: 'var(--s4)',
        }}
      >
        <button
          type="button"
          onClick={resetFilters}
          className="rl-segment-tab"
          style={{
            flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
            padding: '10px 2px', fontSize: 'var(--fs-sm)',
            fontWeight: isDefaultView ? 700 : 500,
            color: isDefaultView ? 'var(--text)' : 'var(--text-2)',
            borderBottom: isDefaultView ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >
          All creators
        </button>
        {segments.map((seg) => {
          const active = segmentIsActive(seg);
          return (
            <span key={seg.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => applySegment(seg)}
                className="rl-segment-tab"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  padding: '10px 2px', fontSize: 'var(--fs-sm)',
                  fontWeight: active ? 700 : 500,
                  color: active ? 'var(--text)' : 'var(--text-2)',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {seg.name}
              </button>
              <button
                type="button"
                onClick={() => setSegmentToDelete(seg)}
                aria-label={`Delete saved view "${seg.name}"`}
                style={{ display: 'inline-flex', background: 'none', border: 'none', padding: '4px', cursor: 'pointer', color: 'var(--text-3)' }}
              >
                <XIcon size={11} />
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setSaveViewOpen(true)}
          className="rl-segment-tab"
          style={{
            flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '4px',
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '10px 2px', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--accent)',
            borderBottom: '2px solid transparent', marginLeft: 'auto',
          }}
        >
          <PlusIcon size={13} />Save this view
        </button>
      </div>

      <div className="rl-searchbar" style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--s3)' }}>
        <span style={{ position: 'relative', flex: '1 1 260px', minWidth: 0, maxWidth: '360px' }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
          <input
            type="text"
            className="input-field"
            placeholder="Search by handle or name"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            style={{ height: '36px', fontSize: 'var(--fs-sm)', width: '100%', paddingLeft: '30px' }}
          />
        </span>
        {/* Phones get one Filters button that opens a sheet with every column's
            filter; desktop uses the column headings directly. */}
        <span className="rl-mobile-only">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen((v) => !v)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 var(--s3)',
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
              color: 'var(--text)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Filters
            {(filtersOn || filters.sort !== 'recent') && (
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} aria-hidden="true" />
            )}
          </button>
        </span>
        {user?.role === 'admin' && (
          <div style={{ display: 'inline-flex', padding: '3px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>
            {[['all', 'All accounts'], ['mine', 'Just mine']].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setScope(value)}
                className="btn"
                style={{
                  height: '30px', padding: '0 var(--s3)', fontSize: 'var(--fs-xs)', fontWeight: 600, border: 'none',
                  backgroundColor: scope === value ? 'var(--accent-soft)' : 'transparent',
                  color: scope === value ? 'var(--accent)' : 'var(--text-2)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <a
          href={exportHref()}
          className="btn btn-secondary"
          style={{ gap: 'var(--s2)', textDecoration: 'none', marginLeft: 'auto' }}
          title="Download the creators you are looking at as a CSV"
        >
          <DownloadIcon size={15} />Export CSV
        </a>
      </div>

      {/* What is currently filtered, one removable chip each, so nobody has
          to open every column to work out why a creator is missing. */}
      {chips.length > 0 && (
        <div className="rl-filter-chips">
          {total != null && (
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginRight: '4px' }}>
              <strong style={{ color: 'var(--text)' }}>{total.toLocaleString()}</strong> {total === 1 ? 'creator' : 'creators'}{chips.length ? ' match' : ''}
            </span>
          )}
          {chips.map((c) => (
            <button key={c.col} type="button" className="rl-filter-chip" onClick={() => setFilters(clearPatch(c.col))} aria-label={`Remove filter: ${c.label}`}>
              {c.label}
              <XIcon size={11} />
            </button>
          ))}
          {chips.length > 0 && (
            <button type="button" onClick={resetFilters} className="rl-text-link" style={{ fontSize: 'var(--fs-xs)' }}>Clear all</button>
          )}
        </div>
      )}

      {/* Phones: a bottom sheet, not a squeezed inline row. Every column's
          filter is a labeled section and changes apply as you go. */}
      <Modal isOpen={mobileFiltersOpen} onClose={() => setMobileFiltersOpen(false)} title="Filters" width="420px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }}>
          {['engagement', 'followers', 'views', 'gender', 'times', 'campaigns'].map((col) => (
            <div key={col}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--s2)' }}>
                {COLUMNS[col].label}
              </div>
              <FilterControls column={col} draft={filters} setDraft={setFilters} campaigns={campaigns} />
            </div>
          ))}
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--s2)' }}>Sort by</div>
            <Select
              value={sheetSortValue}
              onChange={(v) => { const [sort, dir] = v.split(':'); setFilters({ sort, dir: dir || '' }); }}
              options={SHEET_SORTS}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--s5)', paddingTop: 'var(--s4)', borderTop: '1px solid var(--border)' }}>
          {(filtersOn || filters.sort !== 'recent') && (
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={resetFilters}>Reset</button>
          )}
          <button type="button" className="btn btn-primary" style={{ flex: 2 }} onClick={() => setMobileFiltersOpen(false)}>Show results</button>
        </div>
      </Modal>

      <Modal isOpen={saveViewOpen} onClose={() => setSaveViewOpen(false)} title="Save this view" width="380px">
        <div className="input-group" style={{ marginBottom: 'var(--s4)' }}>
          <label className="input-label" htmlFor="segment-name">Name</label>
          <input
            id="segment-name"
            type="text"
            className="input-field"
            style={{ width: '100%' }}
            placeholder="e.g. High performers, or Client A"
            value={saveViewName}
            onChange={(e) => setSaveViewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveView()}
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={() => setSaveViewOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={savingView || !saveViewName.trim()} onClick={handleSaveView}>
            {savingView ? 'Saving...' : 'Save view'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!segmentToDelete}
        title="Delete this saved view?"
        message={segmentToDelete ? `"${segmentToDelete.name}" and its saved filters will be gone for good. This doesn't touch any creators or reports, just the bookmark.` : ''}
        confirmText="Delete view"
        isDestructive
        onConfirm={() => segmentToDelete && handleDeleteSegment(segmentToDelete.id)}
        onClose={() => setSegmentToDelete(null)}
      />

      {error && <div style={{ color: 'var(--err)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s3)' }}>{error}</div>}

      {loading ? (
        <>
          <div className="data-table-container rl-hide-mobile">
            <table className="data-table">
              <thead><tr>{COLUMN_ORDER.map((c) => <th key={c}>{COLUMNS[c].label}</th>)}</tr></thead>
              <TableSkeleton rows={8} columns={COLUMN_ORDER.length} rowHeight={56} label="Loading creators" />
            </table>
          </div>
          <div className="rl-mobile-only" style={{ padding: 'var(--s5)', justifyContent: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-sm)' }}>
            Loading creators...
          </div>
        </>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UsersIcon size={32} />}
          title={filtersOn ? 'No creators match these filters' : 'No creators analyzed yet'}
          description={
            filtersOn
              ? 'Nothing matches yet. Try widening a filter, or clear them all.'
              : 'Run a reel or profile report and the creators in it will show up here automatically.'
          }
          action={filtersOn ? <button type="button" className="btn btn-secondary" onClick={resetFilters}>Clear all filters</button> : undefined}
        />
      ) : (
        <div>
          {/* Desktop: the full table with clickable column headings. Mobile:
              one card per creator. Same rows, same expand behavior, same
              Pagination underneath either way. */}
          <div className="data-table-container rl-hide-mobile">
            <table className="data-table">
              <thead>
                <tr>
                  <ColumnHead column="engagement" filters={filters} setFilters={setFilters} campaigns={campaigns} />
                  <ColumnHead column="creator" filters={filters} setFilters={setFilters} campaigns={campaigns} />
                  <ColumnHead column="followers" filters={filters} setFilters={setFilters} campaigns={campaigns} />
                  <ColumnHead column="views" filters={filters} setFilters={setFilters} campaigns={campaigns} />
                  <ColumnHead column="gender" filters={filters} setFilters={setFilters} campaigns={campaigns} />
                  <ColumnHead column="times" filters={filters} setFilters={setFilters} campaigns={campaigns} />
                  <ColumnHead column="campaigns" filters={filters} setFilters={setFilters} campaigns={campaigns} />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((c) => (
                  <CreatorRow
                    key={c.id}
                    creator={c}
                    onGenderChange={handleGenderChange}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="rl-mobile-only" style={{ flexDirection: 'column' }}>
            {visibleRows.map((c) => (
              <CreatorCardMobile
                key={c.id}
                creator={c}
                onGenderChange={handleGenderChange}
              />
            ))}
          </div>
          <div className="card" style={{ padding: 0 }}>
            <Pagination
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={rows.length}
              onPageChange={handlePageChange}
              onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
              pageSizeOptions={rows.length > PAGE_SIZE_OPTIONS[0] ? PAGE_SIZE_OPTIONS : undefined}
              nextDisabled={page >= totalPages && hasMore ? false : undefined}
              nextLoading={extending}
              trailing={warming ? <span style={{ opacity: 0.7 }}> · loading more…</span> : null}
            />
          </div>
        </div>
      )}
    </div>
  );
}
