import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { CampaignAvatar } from '../components/CampaignAvatar';
import { EmptyState } from '../components/EmptyState';
import { TableSkeleton } from '../components/TableSkeleton';
import { ProBadge, UpgradeDialog, PREMIUM_FEATURES } from '../components/Premium';
import { SearchIcon, UsersIcon } from '../components/Icon';

/*
  Every creator this account has ever run a reel or profile report on, in
  one searchable place -- built automatically from those reports rather
  than something anyone has to maintain by hand. See creatorDb.service.js
  on the server for how this stays fast at up to a million rows: a
  maintained collection updated incrementally as reports run, not a live
  aggregation over report history on every page load.

  Search hits the server (it has to: this can be far more data than a
  client can hold in memory, unlike History's file-name filter which is a
  plain in-memory field on an already-small, already-loaded list). Debounced
  the same amount jobs.routes.js's old creator search used.

  Pagination is "load more", not numbered pages -- the server returns an
  opaque cursor, not a page count, which is the deliberate trade a million-
  row keyset-paginated collection makes (see that service for why offset
  pagination doesn't work at this scale). Each page appends to what's
  already on screen rather than replacing it, so loading more never resets
  scroll position the way a full reload would.
*/

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
  const [creators, setCreators] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [scope, setScope] = useState('all'); // admin only: 'all' | 'mine'

  const runId = useRef(0);

  const load = useCallback((term, adminScope) => {
    const id = ++runId.current;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: '30' });
    if (term) params.set('search', term);
    if (adminScope) params.set('scope', adminScope);
    apiFetch(`/creators?${params.toString()}`)
      .then((res) => {
        if (id !== runId.current) return;
        setCreators(res.creators || []);
        setNextCursor(res.nextCursor || null);
      })
      .catch((err) => {
        if (id !== runId.current) return;
        setError(err.message || "Couldn't load the creator database, try again.");
      })
      .finally(() => { if (id === runId.current) setLoading(false); });
  }, []);

  useEffect(() => {
    if (locked) { setLoading(false); return; }
    load('', scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  // Debounced server search -- this collection can be far larger than
  // anything a client should filter in memory (see the module note), so
  // unlike History's file-name search this one has to be a real request.
  const searchMounted = useRef(false);
  useEffect(() => {
    if (locked) return undefined;
    if (!searchMounted.current) { searchMounted.current = true; return undefined; }
    const handle = setTimeout(() => load(search.trim(), scope), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (locked || !searchMounted.current) return;
    load(search.trim(), scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const params = new URLSearchParams({ limit: '30', cursor: nextCursor });
    if (search.trim()) params.set('search', search.trim());
    if (scope) params.set('scope', scope);
    apiFetch(`/creators?${params.toString()}`)
      .then((res) => {
        setCreators((prev) => [...prev, ...(res.creators || [])]);
        setNextCursor(res.nextCursor || null);
      })
      .catch((err) => setError(err.message || "Couldn't load more, try again."))
      .finally(() => setLoadingMore(false));
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
            <button type="button" className="btn btn-primary" onClick={() => setUpgradeOpen(true)} style={{ gap: 'var(--s2)' }}>
              See plans<ProBadge />
            </button>
          }
        />
        <UpgradeDialog isOpen={upgradeOpen} onClose={() => setUpgradeOpen(false)} feature={PREMIUM_FEATURES.creatorDatabase} />
      </div>
    );
  }

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
      ) : creators.length === 0 ? (
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
        <>
          <div className="data-table-container">
            <table className="data-table">
              <thead><tr>{HEADERS.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {creators.map((c) => <CreatorRow key={c.id} creator={c} />)}
              </tbody>
            </table>
          </div>
          {nextCursor && (
            <div style={{ textAlign: 'center', marginTop: 'var(--s4)' }}>
              <button type="button" className="btn btn-secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
