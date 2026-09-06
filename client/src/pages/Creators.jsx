import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { CampaignAvatar } from '../components/CampaignAvatar';
import { EmptyState } from '../components/EmptyState';
import { TableSkeleton } from '../components/TableSkeleton';
import { Pagination } from '../components/Pagination';
import { UpgradeDialog, PREMIUM_FEATURES } from '../components/Premium';
import { Select } from '../components/Select';
import { Modal } from '../components/Modal';
import { useToast } from '../context/ToastContext';
import { SearchIcon, UsersIcon, DownloadIcon, PlusIcon, XIcon } from '../components/Icon';

/*
  Every creator this account has ever run a reel or profile report on, in
  one searchable place -- built automatically from those reports rather
  than something anyone has to maintain by hand. See creatorDb.service.js
  on the server for how this stays fast at up to a million rows: a
  maintained collection updated incrementally as reports run, not a live
  aggregation over report history on every page load.

  Loading strategy (the reason this isn't just "fetch everything then
  paginate client-side" like History gets away with): this collection can
  be far larger than anything a client should hold in memory. So:

    1. The first PAGE_SIZE rows come back and render immediately -- that's
       the only fetch the user actually waits on.
    2. In the background, with no loading UI, more pages keep streaming in
       behind the scenes up to WARM_CAP rows. Paging within that warmed
       window is then instant (a plain array slice, no request).
    3. Paging past the warmed window is rare (most searches/browsing never
       go there) and DOES cost a real request, fetched on demand via the
       server's opaque keyset cursor -- the same reason offset/page-number
       pagination was rejected server-side at this scale still applies
       past 500 rows, so this only ever asks the server to go one page
       forward from where it left off, never to jump to an arbitrary page.
    4. Search is never answered from the warmed window -- it always goes
       to the server fresh (same warm-then-stream loop, just keyed off the
       search term instead of the unfiltered list), because the thing
       being searched for might be the 900th row and nowhere in whatever
       happens to be cached locally. This is the same "search hits the
       real dataset, browsing hits a fast local cache" split every large
       product (Gmail, Linear, Amazon order history) makes for exactly
       this reason.
*/

const PAGE_SIZE = 50;
const WARM_CAP = 500;

// Follower tiers are the actual vocabulary influencer marketing uses to
// segment creators (nano/micro/mid/macro), not an arbitrary number range
// slider -- an agency scanning this table for "who's worth a micro-budget
// vs a macro one" thinks in these buckets already, so the filter should
// speak them back rather than making someone guess a follower count.
const FOLLOWER_TIERS = [
  { value: 'all', label: 'All sizes', min: null, max: null },
  { value: 'nano', label: 'Nano · <10K', min: null, max: 9999 },
  { value: 'micro', label: 'Micro · 10K-100K', min: 10000, max: 99999 },
  { value: 'mid', label: 'Mid · 100K-500K', min: 100000, max: 499999 },
  { value: 'macro', label: 'Macro · 500K+', min: 500000, max: null },
];

// Whichever of a creator's reel/profile average ER is higher (bestAvgEr,
// computed server-side -- see creatorDb.service.js) is what these filter
// against, so a creator who's only ever had profile reports run still
// shows up under a reel-shaped ER threshold and vice versa.
const ER_THRESHOLDS = [
  { value: 0, label: 'Any engagement' },
  { value: 2, label: '2%+ ER' },
  { value: 5, label: '5%+ ER' },
  { value: 10, label: '10%+ ER' },
];

const SORT_OPTIONS = [
  { value: 'recent', label: 'Most recently analyzed' },
  { value: 'followers', label: 'Most followers' },
  { value: 'engagement', label: 'Highest engagement' },
  { value: 'timesAnalyzed', label: 'Most times analyzed' },
];

function formatCompactNumber(n) {
  if (n == null) return '-';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' });
}

function CreatorRow({ creator }) {
  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0 }}>
          <CampaignAvatar name={creator.name || creator.username} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {creator.name || creator.username}
            </div>
            {creator.profileLink ? (
              <a
                href={creator.profileLink}
                target="_blank"
                rel="noreferrer"
                className="mono"
                style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}
              >
                @{creator.username}
              </a>
            ) : (
              <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>@{creator.username}</span>
            )}
          </div>
        </div>
      </td>
      <td className="numeric mono">{formatCompactNumber(creator.followers)}</td>
      <td className="numeric mono">{creator.timesAnalyzed}</td>
      <td className="numeric mono">
        {creator.reel.count ? `${formatCompactNumber(creator.reel.avgViews)} views · ${creator.reel.avgEr}% ER` : '-'}
      </td>
      <td className="numeric mono">
        {creator.profile.count ? `${formatCompactNumber(creator.profile.avgViews)} views · ${creator.profile.avgEr}% ER` : '-'}
      </td>
      <td>
        {creator.campaigns.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '220px' }}>
            {creator.campaigns.map((c) => (
              <span key={c.id} className="chip" style={{ fontSize: '10px' }}>{c.name}</span>
            ))}
          </div>
        ) : (
          <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>-</span>
        )}
      </td>
      <td className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
        {formatDate(creator.lastAnalyzedAt)}
      </td>
    </tr>
  );
}

// Mobile: one card per creator instead of the same 7-column table squeezed
// into a horizontal scroll -- same reasoning, and same composition
// (identity block, a small stat row, secondary details below) as History's
// ReportCardMobile/CampaignCard mobile cards.
function CreatorCardMobile({ creator }) {
  return (
    <div className="card" style={{ padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0 }}>
        <CampaignAvatar name={creator.name || creator.username} size={36} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {creator.name || creator.username}
          </div>
          {creator.profileLink ? (
            <a href={creator.profileLink} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
              @{creator.username}
            </a>
          ) : (
            <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>@{creator.username}</span>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="mono" style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{formatCompactNumber(creator.followers)}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Followers</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--s4)', marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: '1px solid var(--border)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: '2px' }}>Reel avg</div>
          <div className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
            {creator.reel.count ? `${formatCompactNumber(creator.reel.avgViews)} views · ${creator.reel.avgEr}% ER` : '-'}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: '2px' }}>Profile avg</div>
          <div className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
            {creator.profile.count ? `${formatCompactNumber(creator.profile.avgViews)} views · ${creator.profile.avgEr}% ER` : '-'}
          </div>
        </div>
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
          {creator.timesAnalyzed}x · {formatDate(creator.lastAnalyzedAt)}
        </span>
      </div>
    </div>
  );
}

const HEADERS = ['Creator', 'Followers', 'Times analyzed', 'Reel avg', 'Profile avg', 'Campaigns', 'Last analyzed'];

export function Creators() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const locked = !user?.features?.creatorDatabase;

  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null); // where the next server fetch (warm or on-demand) resumes from
  const [hasMore, setHasMore] = useState(false); // server has more beyond what's currently loaded
  const [warming, setWarming] = useState(false); // background fill-to-WARM_CAP in flight -- deliberately not shown as a blocking spinner
  const [loading, setLoading] = useState(true); // the one fetch the user actually waits on
  const [extending, setExtending] = useState(false); // on-demand fetch past the warmed window -- this one IS a real wait
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [scope, setScope] = useState('all'); // admin only: 'all' | 'mine'
  const [followerTier, setFollowerTier] = useState('all');
  const [minEr, setMinEr] = useState(0);
  const [sortBy, setSortBy] = useState('recent');
  const [campaignId, setCampaignId] = useState('');
  const [campaigns, setCampaigns] = useState([]);
  const [segments, setSegments] = useState([]);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [savingView, setSavingView] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false); // mobile only: opens the filter sheet Modal below

  const runId = useRef(0);

  // Reference lists for the filter bar -- campaigns to filter by, saved
  // segments to reapply. Independent of the row query above: these don't
  // change as search/filters change, so they load once and are simply read
  // from while the query effect below re-fires on its own schedule.
  useEffect(() => {
    if (locked) return;
    apiFetch('/campaigns').then((res) => setCampaigns(res.campaigns || [])).catch(() => {});
    apiFetch('/creators/segments').then((res) => setSegments(res.segments || [])).catch(() => {});
  }, [locked]);

  // Every filter knob (search, scope, follower tier, ER threshold, sort)
  // funnels through here -- one place building the query string means one
  // place to keep it consistent between the initial/warm fetch and the
  // on-demand extend-past-window fetch below, instead of two copies that
  // could quietly drift.
  const fetchPage = useCallback((afterCursor) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    const term = search.trim();
    if (term) params.set('search', term);
    if (scope) params.set('scope', scope);
    if (afterCursor) params.set('cursor', afterCursor);
    if (sortBy !== 'recent') params.set('sort', sortBy);
    const tier = FOLLOWER_TIERS.find((t) => t.value === followerTier);
    if (tier?.min != null) params.set('minFollowers', String(tier.min));
    if (tier?.max != null) params.set('maxFollowers', String(tier.max));
    if (minEr) params.set('minEr', String(minEr));
    if (campaignId) params.set('campaignId', campaignId);
    return apiFetch(`/creators?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, scope, sortBy, followerTier, minEr, campaignId]);

  // Fresh query: fires on mount and on any filter change (search, scope,
  // follower tier, ER threshold, sort). Renders the first page the moment
  // it lands, then keeps quietly pulling more pages behind it up to
  // WARM_CAP so the pages that follow are instant. Guarded by runId
  // throughout -- a query that's since gone stale (user kept typing, or
  // changed a filter mid-fetch) stops touching state.
  const runQuery = useCallback(() => {
    const id = ++runId.current;
    setLoading(true);
    setError('');
    setPage(1);
    fetchPage(null)
      .then(async (res) => {
        if (id !== runId.current) return;
        const firstRows = res.creators || [];
        setRows(firstRows);
        setCursor(res.nextCursor || null);
        setHasMore(!!res.nextCursor);
        setLoading(false);

        if (!res.nextCursor) return;
        setWarming(true);
        let acc = firstRows;
        let nextCursor = res.nextCursor;
        while (nextCursor && acc.length < WARM_CAP) {
          if (id !== runId.current) return;
          // eslint-disable-next-line no-await-in-loop
          const chunk = await fetchPage(nextCursor).catch(() => null);
          if (!chunk || id !== runId.current) break;
          acc = acc.concat(chunk.creators || []);
          nextCursor = chunk.nextCursor || null;
          setRows(acc);
          setCursor(nextCursor);
          setHasMore(!!nextCursor);
        }
        if (id === runId.current) setWarming(false);
      })
      .catch((err) => {
        if (id !== runId.current) return;
        setError(err.message || "Couldn't load the creator database, try again.");
        setLoading(false);
      });
  }, [fetchPage]);

  // One effect drives every (re)query: initial mount and every filter
  // change land here instead of separate effects each trying to fire on
  // every change EXCEPT their own first render. That "skip only the first
  // run" idea sounds simple but isn't: every effect runs once on mount no
  // matter what its dependency array says, so a version of this split
  // across effects either fired a redundant duplicate query on mount
  // (competing "first runs") or, fixed the naive way with a ref, went the
  // other direction and silently stopped firing on real changes -- React
  // re-runs an effect's cleanup before every subsequent invocation, not
  // just on unmount, so a cleanup that resets a "first run" flag resets it
  // before every keystroke too, permanently stuck skipping. One effect
  // sidesteps the whole class of bug: firing on mount is exactly what
  // should happen here, so there is no "first run" to skip in the first
  // place.
  useEffect(() => {
    if (locked) { setLoading(false); return undefined; }
    const handle = setTimeout(() => runQuery(), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, search, scope, followerTier, minEr, sortBy, campaignId]);

  const totalPages = Math.ceil(rows.length / PAGE_SIZE);

  // Paging within what's already warmed is a plain slice -- no request.
  // Paging past it is the one case that still costs a real fetch, and it
  // can only ever step one page forward from the server's own cursor
  // (never jump), same constraint the server's keyset pagination has
  // everywhere else in this feature.
  const handlePageChange = (nextPage) => {
    if (nextPage < 1) return;
    if (nextPage <= totalPages) { setPage(nextPage); return; }
    if (!hasMore || !cursor || extending) return;
    const id = runId.current;
    setExtending(true);
    fetchPage(cursor)
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

  // Excludes sortBy on purpose for the "narrows the result set" meaning of
  // this flag (the empty-state message below) -- a sort order alone can
  // never be why zero rows matched. filtersActive (below) is the broader
  // "anything non-default worth a Reset link" meaning, which sort DOES
  // belong in.
  const rangeFiltersActive = followerTier !== 'all' || minEr !== 0 || !!campaignId;
  const filtersActive = rangeFiltersActive || sortBy !== 'recent';
  const resetFilters = () => { setFollowerTier('all'); setMinEr(0); setSortBy('recent'); setCampaignId(''); };

  // A saved segment is search + every filter chip, bundled -- applying one
  // sets all of it at once rather than making someone reconstruct a filter
  // combination chip by chip. Deliberately excludes `scope`: which accounts
  // to look across isn't "what I'm looking for," it's a separate toggle a
  // saved view shouldn't silently override.
  const applySegment = (segment) => {
    const f = segment.filters || {};
    setSearch(f.search || '');
    setFollowerTier(f.followerTier || 'all');
    setMinEr(Number(f.minEr) || 0);
    setSortBy(f.sort || 'recent');
    setCampaignId(f.campaignId || '');
  };

  const handleSaveView = async () => {
    if (!saveViewName.trim()) return;
    setSavingView(true);
    try {
      const res = await apiFetch('/creators/segments', {
        method: 'POST',
        body: JSON.stringify({
          name: saveViewName.trim(),
          filters: { search, followerTier, minEr, sort: sortBy, campaignId },
        }),
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

  // The export mirrors whatever's currently filtered/searched/sorted -- a
  // plain same-origin link, not a fetch, so the browser's own session
  // cookie carries auth and the download just happens, the same way
  // History's per-report .xlsx/.csv links already work.
  const exportHref = () => {
    const params = new URLSearchParams();
    const term = search.trim();
    if (term) params.set('search', term);
    if (scope) params.set('scope', scope);
    if (sortBy !== 'recent') params.set('sort', sortBy);
    const tier = FOLLOWER_TIERS.find((t) => t.value === followerTier);
    if (tier?.min != null) params.set('minFollowers', String(tier.min));
    if (tier?.max != null) params.set('maxFollowers', String(tier.max));
    if (minEr) params.set('minEr', String(minEr));
    if (campaignId) params.set('campaignId', campaignId);
    return `/api/creators/export.csv?${params.toString()}`;
  };

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
            ever renders THIS branch. Without an anchor here the tour would
            have nothing to point at for exactly the accounts most worth
            showing this feature to (see DemoGuide's own note on the
            locked share button, which hit the same gap). */}
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

  const visibleRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s4)' }} data-tour="creators-page">
        <div>
          <h1 className="rl-page-heading" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s1)' }}>
            Creator database
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>
            {user?.role === 'admin' ? 'Every creator analyzed on the platform, built from every account’s reports.' : 'Every creator you have analyzed, built automatically from your reports.'}
          </p>
        </div>
      </div>

      <div className="rl-searchbar" style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--s4)' }}>
        <span style={{ position: 'relative', flex: '1 1 260px', minWidth: 0, maxWidth: '360px' }}>
          <SearchIcon size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
          <input
            type="text"
            className="input-field"
            placeholder="Search by handle or name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ height: '36px', fontSize: 'var(--fs-sm)', width: '100%', paddingLeft: '30px' }}
          />
        </span>
        {/* Opens the mobile filter sheet below. Search stays reachable
            right here regardless of whether that sheet is open. */}
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
            {filtersActive && (
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} aria-hidden="true" />
            )}
          </button>
        </span>
        {user?.role === 'admin' && (
          <div style={{ display: 'inline-flex', padding: '3px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>
            <button
              type="button"
              onClick={() => setScope('all')}
              className="btn"
              style={{
                height: '30px', padding: '0 var(--s3)', fontSize: 'var(--fs-xs)', fontWeight: 600, border: 'none',
                backgroundColor: scope === 'all' ? 'var(--accent-soft)' : 'transparent',
                color: scope === 'all' ? 'var(--accent)' : 'var(--text-2)',
              }}
            >
              All accounts
            </button>
            <button
              type="button"
              onClick={() => setScope('mine')}
              className="btn"
              style={{
                height: '30px', padding: '0 var(--s3)', fontSize: 'var(--fs-xs)', fontWeight: 600, border: 'none',
                backgroundColor: scope === 'mine' ? 'var(--accent-soft)' : 'transparent',
                color: scope === 'mine' ? 'var(--accent)' : 'var(--text-2)',
              }}
            >
              Just mine
            </button>
          </div>
        )}
        <a
          href={exportHref()}
          className="btn btn-secondary"
          style={{ gap: 'var(--s2)', textDecoration: 'none' }}
          title="Export the currently filtered/searched list as CSV"
        >
          <DownloadIcon size={15} />Export CSV
        </a>
      </div>

      {/* Follower tier and engagement threshold are the two facets an
          agency actually screens creators by before reaching out -- "who's
          worth a micro-budget vs a macro one" and "who's actually engaged,
          not just big." Both are real server-side range queries (see
          creatorDb.service.js's bestAvgEr/followers indexes), not a filter
          over whatever's already loaded, so they narrow the FULL dataset
          the same way search does, not just the warmed first 500.

          Desktop only (rl-hide-mobile): this inline horizontal bar is what
          "every chip and dropdown visible at once" actually looks like, and
          that reads fine when there's a full-width row to lay them out in.
          On a phone the same row had five long follower-tier labels alone
          with nowhere to wrap to and ran off the edge of the screen -- the
          mobile equivalent is the sheet below, not a squeezed copy of this. */}
      <div className="card rl-hide-mobile" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s4)' }}>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {FOLLOWER_TIERS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setFollowerTier(t.value)}
              className={`chip ${followerTier === t.value ? 'accent' : ''}`}
              style={{ cursor: 'pointer', padding: '6px 12px', whiteSpace: 'nowrap' }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--border)' }} />
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {ER_THRESHOLDS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setMinEr(t.value)}
              className={`chip ${minEr === t.value ? 'accent' : ''}`}
              style={{ cursor: 'pointer', padding: '6px 12px', whiteSpace: 'nowrap' }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {campaigns.length > 0 && (
          <>
            <span style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--border)' }} />
            <Select
              value={campaignId}
              onChange={setCampaignId}
              options={[{ value: '', label: 'All campaigns' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]}
              style={{ minWidth: '170px' }}
            />
          </>
        )}
        <span style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--border)' }} />
        <Select value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} style={{ minWidth: '190px' }} />
        {filtersActive && (
          <button type="button" onClick={resetFilters} className="rl-text-link" style={{ fontSize: 'var(--fs-xs)' }}>
            Reset filters
          </button>
        )}

        {/* Saved segments: a personal bookmark for a filter combination
            (server/routes/creators.routes.js /segments), so coming back to
            "Micro creators, 5%+ ER, Puma campaign" is one click instead of
            resetting every chip by hand. Wraps onto its own line inside
            this same card rather than a whole separate bar -- it's a
            secondary action, not a fourth row of primary controls. */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', width: '100%', paddingTop: segments.length || (search.trim() || filtersActive) ? 'var(--s2)' : 0, marginTop: segments.length || (search.trim() || filtersActive) ? 'var(--s1)' : 0, borderTop: segments.length ? '1px solid var(--border)' : 'none' }}>
          {segments.map((seg) => (
            <span
              key={seg.id}
              className="chip"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', paddingRight: '6px', cursor: 'pointer' }}
            >
              <span onClick={() => applySegment(seg)}>{seg.name}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleDeleteSegment(seg.id); }}
                aria-label={`Delete saved view "${seg.name}"`}
                style={{ display: 'inline-flex', background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: 'var(--text-3)' }}
              >
                <XIcon size={11} />
              </button>
            </span>
          ))}
          {(search.trim() || filtersActive) && (
            <button
              type="button"
              onClick={() => setSaveViewOpen(true)}
              className="rl-text-link"
              style={{ fontSize: 'var(--fs-xs)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <PlusIcon size={12} />Save this view
            </button>
          )}
        </div>
      </div>

      {/* Mobile: a bottom sheet, not a squeezed inline row -- the same
          Modal component every other dialog in the app uses, which
          mobile.css already turns into a full-width slide-up sheet with
          rounded top corners (Stripe/Linear/Notion's own pattern for a
          phone-width dialog). Each filter gets its own labeled, stacked,
          full-width section instead of everything competing for one row
          that has nowhere to wrap to. */}
      <Modal isOpen={mobileFiltersOpen} onClose={() => setMobileFiltersOpen(false)} title="Filters" width="420px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s5)' }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--s2)' }}>Followers</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {FOLLOWER_TIERS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setFollowerTier(t.value)}
                  className={`chip ${followerTier === t.value ? 'accent' : ''}`}
                  style={{ cursor: 'pointer', padding: '8px 12px' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--s2)' }}>Engagement</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {ER_THRESHOLDS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setMinEr(t.value)}
                  className={`chip ${minEr === t.value ? 'accent' : ''}`}
                  style={{ cursor: 'pointer', padding: '8px 12px' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {campaigns.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--s2)' }}>Campaign</div>
              <Select
                value={campaignId}
                onChange={setCampaignId}
                options={[{ value: '', label: 'All campaigns' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]}
                style={{ width: '100%' }}
              />
            </div>
          )}
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--s2)' }}>Sort by</div>
            <Select value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} style={{ width: '100%' }} />
          </div>
          {(segments.length > 0 || search.trim() || filtersActive) && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--s2)' }}>Saved views</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: segments.length ? 'var(--s2)' : 0 }}>
                {segments.map((seg) => (
                  <span key={seg.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', paddingRight: '6px', cursor: 'pointer' }}>
                    <span onClick={() => applySegment(seg)}>{seg.name}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleDeleteSegment(seg.id); }}
                      aria-label={`Delete saved view "${seg.name}"`}
                      style={{ display: 'inline-flex', background: 'none', border: 'none', padding: '2px', cursor: 'pointer', color: 'var(--text-3)' }}
                    >
                      <XIcon size={11} />
                    </button>
                  </span>
                ))}
              </div>
              {(search.trim() || filtersActive) && (
                <button
                  type="button"
                  onClick={() => setSaveViewOpen(true)}
                  className="rl-text-link"
                  style={{ fontSize: 'var(--fs-xs)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  <PlusIcon size={12} />Save this view
                </button>
              )}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--s5)', paddingTop: 'var(--s4)', borderTop: '1px solid var(--border)' }}>
          {filtersActive && (
            <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={resetFilters}>
              Reset
            </button>
          )}
          <button type="button" className="btn btn-primary" style={{ flex: 2 }} onClick={() => setMobileFiltersOpen(false)}>
            Show results
          </button>
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
            placeholder="e.g. Micro creators, 5%+ ER"
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

      {error && <div style={{ color: 'var(--err)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s3)' }}>{error}</div>}

      {loading ? (
        <>
          <div className="data-table-container rl-hide-mobile">
            <table className="data-table">
              <thead><tr>{HEADERS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <TableSkeleton rows={8} columns={HEADERS.length} rowHeight={56} label="Loading creators" />
            </table>
          </div>
          <div className="rl-mobile-only" style={{ padding: 'var(--s5)', justifyContent: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-sm)' }}>
            Loading creators...
          </div>
        </>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UsersIcon size={32} />}
          title={search.trim() || rangeFiltersActive ? 'No creators match this search' : 'No creators analyzed yet'}
          description={
            search.trim()
              ? `Nothing found for "${search.trim()}". Check the spelling or try a shorter search.`
              : rangeFiltersActive
                ? 'Nothing matches these filters yet. Try widening them, or reset filters above.'
                : 'Run a reel or profile report and the creators in it will show up here automatically.'
          }
        />
      ) : (
        <div>
          {/* Desktop: the full table. Mobile: one card per creator instead
              of the same 7 columns squeezed into a horizontal scroll -- see
              CreatorCardMobile's own note. Same rows, same Pagination
              underneath either way. */}
          <div className="data-table-container rl-hide-mobile">
            <table className="data-table">
              <thead><tr>{HEADERS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {visibleRows.map((c) => <CreatorRow key={c.id} creator={c} />)}
              </tbody>
            </table>
          </div>
          <div className="rl-mobile-only" style={{ flexDirection: 'column' }}>
            {visibleRows.map((c) => <CreatorCardMobile key={c.id} creator={c} />)}
          </div>
          <div className="card" style={{ padding: 0 }}>
            <Pagination
              page={page}
              totalPages={totalPages}
              pageSize={PAGE_SIZE}
              totalItems={rows.length}
              onPageChange={handlePageChange}
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
