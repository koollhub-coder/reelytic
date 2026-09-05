import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { CampaignAvatar } from '../components/CampaignAvatar';
import { EmptyState } from '../components/EmptyState';
import { TableSkeleton } from '../components/TableSkeleton';
import { Pagination } from '../components/Pagination';
import { UpgradeDialog, PREMIUM_FEATURES } from '../components/Premium';
import { SearchIcon, UsersIcon } from '../components/Icon';

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

const HEADERS = ['Creator', 'Followers', 'Times analyzed', 'Reel avg', 'Profile avg', 'Campaigns', 'Last analyzed'];

export function Creators() {
  const { user } = useAuth();
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

  const runId = useRef(0);

  const fetchPage = useCallback((term, adminScope, afterCursor) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (term) params.set('search', term);
    if (adminScope) params.set('scope', adminScope);
    if (afterCursor) params.set('cursor', afterCursor);
    return apiFetch(`/creators?${params.toString()}`);
  }, []);

  // Fresh query: fires on mount, on scope change, and on debounced search.
  // Renders the first page the moment it lands, then keeps quietly pulling
  // more pages behind it up to WARM_CAP so the pages that follow are
  // instant. Guarded by runId throughout -- a query that's since gone stale
  // (user kept typing, or flipped scope mid-fetch) stops touching state.
  const runQuery = useCallback((term, adminScope) => {
    const id = ++runId.current;
    setLoading(true);
    setError('');
    setPage(1);
    fetchPage(term, adminScope, null)
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
          const chunk = await fetchPage(term, adminScope, nextCursor).catch(() => null);
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

  // One effect drives every (re)query: initial mount, the admin scope
  // toggle, and debounced search typing all land here instead of three
  // separate effects each trying to fire on every change EXCEPT their own
  // first render. That "skip only the first run" idea sounds simple but
  // isn't: every effect runs once on mount no matter what its dependency
  // array says, so a version of this split into three effects either fired
  // a redundant duplicate query on mount (three "first runs" competing) or,
  // fixed the naive way with a ref, went the other direction and silently
  // stopped firing on real changes -- React re-runs an effect's cleanup
  // before every subsequent invocation, not just on unmount, so a cleanup
  // that resets a "first run" flag resets it before every keystroke too,
  // permanently stuck skipping. One effect sidesteps the whole class of
  // bug: firing on mount is exactly what should happen here, so there is
  // no "first run" to skip in the first place.
  useEffect(() => {
    if (locked) { setLoading(false); return undefined; }
    const handle = setTimeout(() => runQuery(search.trim(), scope), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, search, scope]);

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
    fetchPage(search.trim(), scope, cursor)
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

  if (locked) {
    return (
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
          Creator database
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s6)' }}>
          Every creator you have analyzed, in one searchable place.
        </p>
        <EmptyState
          title="Available on Starter, Pro and Agency"
          description="Every reel and profile report you run automatically builds this out -- followers, average views and engagement per creator, tagged with which campaigns they showed up in."
          action={
            <button type="button" className="btn btn-primary" onClick={() => setUpgradeOpen(true)}>
              See plans
            </button>
          }
        />
        <UpgradeDialog isOpen={upgradeOpen} onClose={() => setUpgradeOpen(false)} feature={PREMIUM_FEATURES.creatorDatabase} />
      </div>
    );
  }

  const visibleRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s1)' }}>
            Creator database
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>
            {user?.role === 'admin' ? 'Every creator analyzed on the platform, built from every account’s reports.' : 'Every creator you have analyzed, built automatically from your reports.'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--s4)' }}>
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
      </div>

      {error && <div style={{ color: 'var(--err)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s3)' }}>{error}</div>}

      {loading ? (
        <div className="data-table-container">
          <table className="data-table">
            <thead><tr>{HEADERS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <TableSkeleton rows={8} columns={HEADERS.length} rowHeight={56} label="Loading creators" />
          </table>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UsersIcon size={32} />}
          title={search.trim() ? 'No creators match that search' : 'No creators analyzed yet'}
          description={
            search.trim()
              ? `Nothing found for "${search.trim()}". Check the spelling or try a shorter search.`
              : 'Run a reel or profile report and the creators in it will show up here automatically.'
          }
        />
      ) : (
        <div className="data-table-container">
          <table className="data-table">
            <thead><tr>{HEADERS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {visibleRows.map((c) => <CreatorRow key={c.id} creator={c} />)}
            </tbody>
          </table>
          <div style={{ borderTop: '1px solid var(--border)' }}>
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
