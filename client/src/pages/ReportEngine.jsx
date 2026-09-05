import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { FileDrop } from '../components/FileDrop';
import { BrandLoader } from '../components/BrandLoader';
import { StatCard } from '../components/StatCard';
import { ProgressBar } from '../components/ProgressBar';
import { TableSkeleton } from '../components/TableSkeleton';
import { CopyButton } from '../components/CopyButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { Tooltip } from '../components/Tooltip';
import { CampaignCombobox } from '../components/CampaignCombobox';
import { Select } from '../components/Select';
import {
  ReelIcon, ProfileIcon, PlayIcon, SettingsIcon, FileIcon, LayersIcon, GripIcon,
  PlusIcon, InfoIcon, SuccessIcon, WarningIcon, PencilIcon, XIcon,
  ClockIcon, TrendingUpIcon, TrendingDownIcon, EyeIcon, ExternalLinkIcon,
  ShieldIcon, CloudUploadIcon, ChartIcon, DownloadIcon,
} from '../components/Icon';
import { ProfileMethodologyModal } from '../components/ProfileMethodologyModal';
import { ReelMethodologyModal } from '../components/ReelMethodologyModal';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { formatDate, formatDateTime, formatDayKey } from '../utils/date';

const ER_FORMULA = {
  reel: 'ER = (Likes + Comments) / Views × 100',
  profile: 'Average ER = (Avg Likes + Avg Comments) / Followers × 100',
};

const LOCKED_COLUMNS = {
  reel: ['Username', 'Followers', 'Views', 'Likes', 'Comments', 'Shares', 'Reposts', 'Saves', 'ER %'],
  profile: ['Username', 'Followers', 'Avg Views', 'Avg ER %', 'Reels Analyzed'],
};

function formatDurationWords(ms) {
  if (ms == null || ms < 0) return '0s';
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatCompactNumber(n) {
  if (n == null) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

// Pure client-side summary of a finished report -- no extra API calls, no
// extra cost, just math over data the report already fetched. Needs at
// least 2 successful rows for "top vs bottom" to mean anything; a report
// with 0 or 1 successful items just gets no highlights section at all.
//
// Ranked by engagement rate, not views -- ER is the quality signal agencies
// actually care about, and ranking by views instead made the "top performer"
// card show a low-ER row while higher-ER rows sat further down the table,
// which read as broken. Rows with 0 views are excluded from the top/bottom
// picks entirely (though still counted in the report-wide averages): a
// resolved username with 0 views/0 ER is almost always a data gap, not a
// genuine "worst performer," and showing it as one looked like a bug.
/*
  Same plausibility ceiling and median as ReportSheet.jsx uses, because this
  screen and the branded report are the same numbers shown twice. Diverging
  here would mean the live results say one thing and the client's copy of the
  report says another. If you change it in one file, change it in the other.
*/
const MAX_PLAUSIBLE_ER = 100;

// Page numbers for the preview table's pagination footer: always the first
// and last page, the current page and its immediate neighbors, and a single
// '...' marker for whatever's skipped in between -- rather than every page
// number from 1 to N, which for a 2,000-link report is a genuinely
// unusable wall of buttons.
function paginationRange(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('...');
    out.push(sorted[i]);
  }
  return out;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function computeReportInsights(rows, type) {
  const successful = rows.filter((r) => r.state === 'done' && r.result);
  if (successful.length < 2) return null;

  const viewsKey = type === 'reel' ? 'views' : 'avgViews';
  const erKey = type === 'reel' ? 'er' : 'avgEr';

  const pick = (row) => ({
    name: row.result.username,
    link: row.input.url,
    views: Number(row.result[viewsKey]) || 0,
    er: Number(row.result[erKey]) || 0,
  });

  const viewsList = successful.map((r) => Number(r.result[viewsKey]) || 0);
  const erList = successful.map((r) => Number(r.result[erKey]) || 0);
  const avgViews = viewsList.reduce((a, b) => a + b, 0) / viewsList.length;
  const avgEr = erList.reduce((a, b) => a + b, 0) / erList.length;
  const medianEr = median(erList.filter((v) => v > 0 && v <= MAX_PLAUSIBLE_ER));

  // A creator can only be ranked on a rate we believe. Rows above the ceiling
  // stay in the table and the totals; they just cannot be named best or worst.
  const eligible = successful.filter((r) => {
    const er = Number(r.result[erKey]) || 0;
    return (Number(r.result[viewsKey]) || 0) > 0 && er > 0 && er <= MAX_PLAUSIBLE_ER;
  });

  let top = null;
  let bottom = null;
  let hasSpread = false;
  if (eligible.length >= 2) {
    const topRow = eligible.reduce((best, r) => ((Number(r.result[erKey]) || 0) > (Number(best.result[erKey]) || 0) ? r : best));
    const bottomRow = eligible.reduce((worst, r) => ((Number(r.result[erKey]) || 0) < (Number(worst.result[erKey]) || 0) ? r : worst));
    if (topRow !== bottomRow) {
      top = pick(topRow);
      bottom = pick(bottomRow);
      hasSpread = true;
    }
  }

  // viewsList/erList already existed above for the average/median math --
  // exposed here too so the "Average views"/"Avg engagement rate" Highlights
  // cards can draw a real per-row sparkline instead of a decorative chart
  // with no data behind it. Top/lowest performer are single data points, not
  // a series, so they don't get a chart of their own.
  return { count: successful.length, avgViews, avgEr, medianEr, top, bottom, hasSpread, viewsList, erList };
}

// Stat-tile trend sparkline (dataviz skill's "figures" contract): a single
// hue, bars grow from one baseline, 4px-equivalent rounded data-ends, square
// at the baseline, a slim surface-color gap between bars. Every bar is one
// successful row's real value -- not a trend over time (this batch has no
// time axis), but the same real per-row spread the average/typical number
// above it was computed from. A native <title> per bar is the hover layer;
// a decorative stat-tile sparkline doesn't need a full crosshair+tooltip.
function BarSparkline({ values, color, formatValue, height = 32 }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1);
  const gap = 1.2; // in the same 0-100 viewBox units as the bars
  const slot = 100 / values.length;
  const barW = Math.max(1, slot - gap);
  const rMax = Math.min(3, barW / 2);
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', marginTop: '8px' }} role="img" aria-label="Per-item distribution">
      {values.map((v, i) => {
        const barH = Math.max(3, (v / max) * 100);
        // rx/ry rounds all four corners in SVG, so the bottom is pulled back
        // flush with an inset rect the same color underneath -- keeps the
        // baseline square as the spec wants without a second shape per bar.
        const r = Math.min(rMax, barH / 2);
        return (
          <g key={i}>
            <rect x={i * slot + gap / 2} y={100 - barH} width={barW} height={barH} rx={r} fill={color} />
            {r > 0 && <rect x={i * slot + gap / 2} y={100 - barH + r} width={barW} height={Math.max(0, barH - r)} fill={color} />}
            <title>{formatValue ? formatValue(v) : v}</title>
          </g>
        );
      })}
    </svg>
  );
}

// Plain text, not markdown -- meant to be pasted straight into an email or
// Slack message an agency sends to their own client, so it needs to read
// cleanly with zero formatting applied.
function buildSummaryText(insights, type) {
  const lines = [
    type === 'reel'
      ? `${insights.count} Reels analyzed. Average ${formatCompactNumber(insights.avgViews)} views, ${insights.medianEr.toFixed(1)}% typical engagement rate.`
      : `${insights.count} profiles analyzed. Average ${formatCompactNumber(insights.avgViews)} views per Reel, ${insights.medianEr.toFixed(1)}% typical engagement rate.`,
  ];
  if (insights.hasSpread) {
    lines.push(`Top performer: @${insights.top.name} (${formatCompactNumber(insights.top.views)} views, ${insights.top.er.toFixed(1)}% ER)`);
    lines.push(`Lowest performer: @${insights.bottom.name} (${formatCompactNumber(insights.bottom.views)} views, ${insights.bottom.er.toFixed(1)}% ER)`);
  }
  return lines.join('\n');
}

// Anything that isn't a straightforward success/pending/duplicate is just
// "Invalid link" to the user -- no technical reasoning, no distinction
// between "we rejected this before trying" and "Instagram gave us nothing."
// The specific reason is still kept in row.error for the hover tooltip only.
function statusChip(row) {
  switch (row.state) {
    case 'done': return <span className="chip ok">Success</span>;
    case 'failed': return <Tooltip content={row.error}><span className="chip err">Invalid link</span></Tooltip>;
    case 'invalid': return <Tooltip content={row.error}><span className="chip err">Invalid link</span></Tooltip>;
    case 'duplicate': return <Tooltip content="Duplicate link — won't be processed"><span className="chip warn">Duplicate</span></Tooltip>;
    case 'processing': return <span className="chip accent">Processing...</span>;
    case 'skipped': return <span className="chip">Skipped</span>;
    default: return <span className="chip">Pending</span>;
  }
}

// URL cell: the raw submitted link, always shown, with a copy icon -- this is
// the traceable record of exactly what was submitted.
function UrlCell({ row }) {
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '240px' }}>
      <Tooltip content={row.input.url}>
        <a
          href={row.input.url}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '190px', verticalAlign: 'bottom' }}
        >
          {row.input.url}
        </a>
      </Tooltip>
      {/* Same destination the text itself already links to -- an explicit
          icon next to a mono URL string reads as clickable more reliably
          than styled link-color text alone does. */}
      <Tooltip content="Open link">
        <a href={row.input.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-3)', display: 'flex', flexShrink: 0 }}>
          <ExternalLinkIcon size={13} />
        </a>
      </Tooltip>
      <CopyButton text={row.input.url} />
    </span>
  );
}

// Username cell: blank until a row resolves successfully -- never a
// fabricated or guessed name.
function UsernameCell({ row, type }) {
  const res = row.state === 'done' ? row.result : null;
  if (!res || !res.username) return <span style={{ color: 'var(--text-3)' }}>-</span>;
  const href = type === 'reel' ? (res.profileLink || `https://www.instagram.com/${res.username}`) : (res.profileLink || row.input.url);
  return (
    <a href={href} target="_blank" rel="noreferrer" className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
      @{res.username}
    </a>
  );
}

const CANDIDATE_REASON_LABELS = {
  included: 'Included',
  outlier_high: 'Outlier, too high',
  outlier_low: 'Outlier, too low',
  pinned: 'Pinned',
  not_a_reel: 'Not a Reel',
  not_own: "Not this creator's post",
  sponsored: 'Sponsored / paid partnership',
  collab: 'Collab post',
  missing_views: 'Missing view data',
  beyond_top_6: 'Beyond top 6',
};

// The "Reels Analyzed" count for a profile result is clickable -- opens a
// modal (via onViewReels) listing EVERY fetched candidate (not just the 6
// that made it in), tagged with why each was or wasn't included. Falls back
// to the older perReel-only view for results computed before this field
// existed. Nothing new to fetch -- it's already sitting on the row.
function ReelsAnalyzedCell({ res, onViewReels }) {
  const hasData = (res.candidates && res.candidates.length) || (res.perReel && res.perReel.length);
  if (!hasData) return <>{res.reelsAnalyzed ?? '-'}</>;
  return (
    <Tooltip content="See which posts were considered and why">
      <button
        type="button"
        onClick={() => onViewReels({ username: res.username, candidates: res.candidates, perReel: res.perReel })}
        className="rl-text-link"
        style={{ fontFamily: 'var(--font-data)', fontWeight: 700 }}
      >
        {res.reelsAnalyzed}
      </button>
    </Tooltip>
  );
}

/*
  The true count of everything that did NOT make it into the average --
  collab, sponsored, pinned and missing-view exclusions included, not just
  the outlier trim.

  Before this, the column read reelsSkippedAsOutliers directly, which only
  ever counted the outlier step. An account whose 8 fetched posts were all
  collabs showed "0 skipped" next to a 0% engagement rate that was actually
  a fabricated average of nothing -- the column's own name promised more
  than it measured. Falls back to the outlier-only figure for reports
  stored before the candidates array existed (task #37).
*/
function totalSkipped(res) {
  if (res.candidates && res.candidates.length) {
    return Math.max(0, res.candidates.length - (res.reelsAnalyzed ?? 0));
  }
  return res.reelsSkippedAsOutliers ?? 0;
}

function skippedBreakdownTitle(res) {
  if (!res.candidates || !res.candidates.length) return 'See which posts were considered and why';
  const counts = {};
  for (const c of res.candidates) {
    if (c.reason === 'included') continue;
    counts[c.reason] = (counts[c.reason] || 0) + 1;
  }
  const parts = Object.entries(counts).map(([reason, n]) => `${n} ${CANDIDATE_REASON_LABELS[reason] || reason}`);
  return parts.length ? parts.join(', ') : 'Nothing was excluded';
}

// Skipped is exactly as informative as Reels Analyzed now, not a plain
// number next to a clickable one -- same modal, same "why" behind it.
function ReelsSkippedCell({ res, onViewReels }) {
  const n = totalSkipped(res);
  const hasData = (res.candidates && res.candidates.length) || (res.perReel && res.perReel.length);
  if (!hasData) return <>{n}</>;
  return (
    <Tooltip content={skippedBreakdownTitle(res)}>
      <button
        type="button"
        onClick={() => onViewReels({ username: res.username, candidates: res.candidates, perReel: res.perReel })}
        className="rl-text-link"
        style={{ fontFamily: 'var(--font-data)', fontWeight: 700 }}
      >
        {n}
      </button>
    </Tooltip>
  );
}

/*
  Flags a profile average computed from too few organic posts to trust the
  same way as a full sample. Two different things can land here, and the
  tooltip says which one actually happened rather than always claiming the
  same story (an earlier version of this text unconditionally said "even
  after trying a wider fetch," which was false whenever the retry never ran
  -- exactly the kind of overclaim worth catching):
    - res.widenedFetch true: the server DID try fetching wider, and it still
      wasn't enough. The creator's recent content is genuinely limited.
    - res.widenedFetch falsy: no wider attempt was made, because the first
      fetch already came back with fewer reels than were even asked for --
      Instagram had nothing more to give for this account, so asking again
      could not have found more.
*/
function LowSampleBadge({ res }) {
  const n = res.reelsAnalyzed;
  const post = n === 1 ? 'post' : 'posts';
  const title = res.widenedFetch
    ? `Only ${n} eligible ${post} for this creator, even after trying a wider fetch. Treat this average as directional, not precise.`
    : `Only ${n} eligible ${post} for this creator. This account has ${res.candidatesFetched ?? 'very few'} reel${res.candidatesFetched === 1 ? '' : 's'} in total -- Instagram had nothing more to fetch, so a wider search would not have found more.`;
  return (
    <Tooltip content={title}>
      <span className="chip warn" style={{ fontSize: 'var(--fs-xs)' }}>
        Low sample
      </span>
    </Tooltip>
  );
}

function metricCells(row, type, onViewReels) {
  const isOk = row.state === 'done' && row.result;
  const res = row.result || {};
  if (type === 'reel') {
    return (
      <>
        <td className="numeric mono">{isOk ? (res.followers ?? 0).toLocaleString() : '-'}</td>
        <td className="numeric mono">{isOk ? (res.views ?? 0).toLocaleString() : '-'}</td>
        <td className="numeric mono">{isOk ? (res.likes ?? 0).toLocaleString() : '-'}</td>
        <td className="numeric mono">{isOk ? (res.comments ?? 0).toLocaleString() : '-'}</td>
        <td className="numeric mono">{isOk ? (res.shares ?? 0).toLocaleString() : '-'}</td>
        <td className="numeric mono">{isOk ? (res.reposts ?? 0).toLocaleString() : '-'}</td>
        <td className="numeric mono">{isOk ? (res.saves ?? 0).toLocaleString() : '-'}</td>
        <td className="numeric mono" style={isOk ? { color: 'var(--ok)', fontWeight: 600 } : undefined}>{isOk ? `${res.er ?? 0}%` : '-'}</td>
      </>
    );
  }
  return (
    <>
      <td className="numeric mono">{isOk ? (res.followers ?? 0).toLocaleString() : '-'}</td>
      <td className="numeric mono">{isOk ? (res.avgViews ?? 0).toLocaleString() : '-'}</td>
      <td className="numeric mono">
        {isOk ? (
          res.lowSample ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
              <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{res.avgEr ?? 0}%</span>
              <LowSampleBadge res={res} />
            </div>
          ) : (
            <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{res.avgEr ?? 0}%</span>
          )
        ) : '-'}
      </td>
      <td className="numeric mono">{isOk ? <ReelsAnalyzedCell res={res} onViewReels={onViewReels} /> : '-'}</td>
      <td className="numeric mono">{isOk ? <ReelsSkippedCell res={res} onViewReels={onViewReels} /> : '-'}</td>
    </>
  );
}

const FLAG_STYLE = {
  approved: { label: '✓ Approved', color: 'var(--ok)' },
  flagged: { label: 'Flagged', color: 'var(--err)' },
};

// Triage note/flag button -- only meaningful once a row has actually
// resolved, so it's a no-op placeholder for anything still pending.
function NoteCell({ row, onEditNote }) {
  if (row.state !== 'done' || !row.result) return <span style={{ color: 'var(--text-3)' }}>-</span>;
  const flagInfo = row.flag && FLAG_STYLE[row.flag];
  return (
    <Tooltip content={row.note || 'Add a note'}>
      <button
        type="button"
        onClick={() => onEditNote(row)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          fontSize: 'var(--fs-xs)', fontWeight: 600, textDecoration: flagInfo ? 'none' : 'underline',
          color: flagInfo ? flagInfo.color : 'var(--accent)', whiteSpace: 'nowrap',
        }}
      >
        {flagInfo ? flagInfo.label : '+ Note'}
      </button>
    </Tooltip>
  );
}

// Desktop: a real fixed-column table, values aligned directly under headers.
// Mobile: stacked label:value cards -- reused everywhere via the same rows/type.
function ResultsTable({ rows, type, scrollRef, onViewReels, onEditNote }) {
  const reelHeaders = ['#', 'URL', 'Username', 'Status', 'Followers', 'Views', 'Likes', 'Comments', 'Shares', 'Reposts', 'Saves', 'ER (%)', 'Notes'];
  // No longer "(outliers)" -- the column counts every exclusion (collab,
  // sponsored, pinned, missing views, outlier trim), not only the trim step.
  const profileHeaders = ['#', 'URL', 'Username', 'Status', 'Followers', 'Avg Views', 'Avg ER (%)', 'Reels Analyzed', 'Reels Skipped', 'Notes'];
  const headers = type === 'reel' ? reelHeaders : profileHeaders;

  return (
    <>
      <div className="rl-hide-mobile rl-live-table-container" ref={scrollRef}>
        <table className="data-table">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={h} className={i >= 4 ? 'numeric' : undefined} style={i === 0 ? { width: '56px' } : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i}>
                <td className="mono" style={{ color: 'var(--text-3)' }}>{r.i}</td>
                <td><UrlCell row={r} /></td>
                <td><UsernameCell row={r} type={type} /></td>
                <td>{statusChip(r)}</td>
                {metricCells(r, type, onViewReels)}
                <td><NoteCell row={r} onEditNote={onEditNote} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rl-mobile-only" style={{ flexDirection: 'column', gap: 'var(--s3)', padding: 'var(--s3)' }}>
        {rows.map((r) => {
          const isOk = r.state === 'done' && r.result;
          const res = r.result || {};
          return (
            <div key={r.i} className="card" style={{ padding: 'var(--s3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s2)' }}>
                <span className="mono" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>#{r.i}</span>
                {statusChip(r)}
              </div>
              <div style={{ marginBottom: '4px' }}><UrlCell row={r} /></div>
              <div style={{ marginBottom: 'var(--s2)' }}><UsernameCell row={r} type={type} /></div>
              {type === 'reel' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 'var(--fs-sm)' }}>
                  <span style={{ color: 'var(--text-3)' }}>Followers</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? (res.followers ?? 0).toLocaleString() : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Views</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? (res.views ?? 0).toLocaleString() : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Likes</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? (res.likes ?? 0).toLocaleString() : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Comments</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? (res.comments ?? 0).toLocaleString() : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Shares</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? (res.shares ?? 0).toLocaleString() : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Reposts</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? (res.reposts ?? 0).toLocaleString() : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Saves</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? (res.saves ?? 0).toLocaleString() : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>ER</span><span className="mono" style={{ textAlign: 'right', color: isOk ? 'var(--ok)' : undefined, fontWeight: 600 }}>{isOk ? `${res.er ?? 0}%` : '-'}</span>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 'var(--fs-sm)' }}>
                  <span style={{ color: 'var(--text-3)' }}>Followers</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? (res.followers ?? 0).toLocaleString() : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Avg Views</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? (res.avgViews ?? 0).toLocaleString() : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Avg ER</span>
                  <span className="mono" style={{ textAlign: 'right' }}>
                    {isOk ? (
                      res.lowSample ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                          <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{res.avgEr ?? 0}%</span>
                          <LowSampleBadge res={res} />
                        </div>
                      ) : (
                        <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{res.avgEr ?? 0}%</span>
                      )
                    ) : '-'}
                  </span>
                  <span style={{ color: 'var(--text-3)' }}>Reels Analyzed</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? <ReelsAnalyzedCell res={res} onViewReels={onViewReels} /> : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Reels Skipped</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? <ReelsSkippedCell res={res} onViewReels={onViewReels} /> : '-'}</span>
                </div>
              )}
              {isOk && (
                <div style={{ marginTop: 'var(--s2)', paddingTop: 'var(--s2)', borderTop: '1px solid var(--border)' }}>
                  <NoteCell row={r} onEditNote={onEditNote} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// One of the four link-count segments in the status row at the top of the
// preview screen. Still doubles as a filter toggle exactly like the chips
// it replaced -- same onClick, same active-state idea -- just sized as a
// quick-scan status readout instead of a dashboard KPI tile: this is a
// data-review screen, not an analytics page, and the table below is the
// actual point. `emphasize` is only ever true for the one number that
// answers "how many will actually run" -- everything else, including
// duplicates, stays visually quiet on purpose so it can't outweigh that.
function StatFilterCard({ icon, tone, value, label, sublabel, active, emphasize, onClick }) {
  const toneColor = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'err' ? 'var(--err)' : tone === 'info' ? 'var(--info)' : tone === 'accent' ? 'var(--accent)' : 'var(--text-2)';
  const toneSoft = tone === 'ok' ? 'var(--ok-soft)' : tone === 'warn' ? 'var(--warn-soft)' : tone === 'err' ? 'var(--err-soft)' : tone === 'info' ? 'var(--info-soft)' : tone === 'accent' ? 'var(--accent-soft)' : 'var(--surface-2)';
  // Read-only when there's nothing to click (the completion-summary
  // stat blocks reuse this same tile without turning into fake buttons).
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className="card"
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 12px',
        textAlign: 'left', cursor: onClick ? 'pointer' : 'default', font: 'inherit', flex: '1 1 140px',
        border: active ? `1px solid ${toneColor}` : '1px solid var(--border)',
        boxShadow: active ? `0 0 0 1px ${toneColor}` : 'none',
        transition: 'border-color var(--t-fast), box-shadow var(--t-fast)',
      }}
    >
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: toneSoft, color: toneColor,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${toneColor} 25%, transparent)`,
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '6px' }}>
        <span style={{
          fontFamily: 'var(--font-data)', fontWeight: 700, lineHeight: 1,
          fontSize: emphasize ? 'var(--fs-lg)' : 'var(--fs-md)',
          color: emphasize ? toneColor : 'var(--text)',
        }}>
          {value}
        </span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{label}</span>
        {sublabel && (
          <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-xs)', color: toneColor, whiteSpace: 'nowrap' }}>{sublabel}</span>
        )}
      </div>
    </Tag>
  );
}

// One row per original spreadsheet column: rename, reorder (up/down --
// buttons, not drag, since this is the accessible/mobile-friendly path
// alongside the table header's own drag handles), or remove. Everything
// here calls the exact same handlers the inline table-header controls do,
// this is just a second way to reach them for anyone who'd rather not
// drag-and-drop a table header.
function ColumnsModal({ isOpen, onClose, columns, onRename, onDelete, onReorder }) {
  const [editingName, setEditingName] = useState(null);
  const [draft, setDraft] = useState('');

  const move = (name, dir) => {
    const names = columns.map((c) => c.name);
    const i = names.indexOf(name);
    const j = i + dir;
    if (j < 0 || j >= names.length) return;
    const next = [...names];
    [next[i], next[j]] = [next[j], next[i]];
    onReorder(next);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Customize columns" width="440px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
        {columns.map((c, i) => {
          const displayName = c.renamedTo || c.name;
          const isEditing = editingName === c.name;
          return (
            <div
              key={c.name}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--s2)',
                padding: 'var(--s2) var(--s3)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 }}>
                <Tooltip content="Move up">
                  <button type="button" onClick={() => move(c.name, -1)} disabled={i === 0}
                    style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? 'var(--text-3)' : 'var(--text-2)', padding: 0, lineHeight: 0.7, fontSize: '10px' }}>▲</button>
                </Tooltip>
                <Tooltip content="Move down">
                  <button type="button" onClick={() => move(c.name, 1)} disabled={i === columns.length - 1}
                    style={{ background: 'none', border: 'none', cursor: i === columns.length - 1 ? 'default' : 'pointer', color: i === columns.length - 1 ? 'var(--text-3)' : 'var(--text-2)', padding: 0, lineHeight: 0.7, fontSize: '10px' }}>▼</button>
                </Tooltip>
              </div>
              {isEditing ? (
                <input
                  type="text"
                  className="input-field"
                  style={{ flex: 1, height: '32px', fontSize: 'var(--fs-sm)' }}
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => { onRename(c.name, draft); setEditingName(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
              ) : (
                <span style={{ flex: 1, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
              )}
              <Tooltip content="Rename">
                <button type="button" onClick={() => { setEditingName(c.name); setDraft(displayName); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', flexShrink: 0 }}>
                  <PencilIcon size={14} />
                </button>
              </Tooltip>
              <Tooltip content="Remove this column">
                <button type="button" onClick={() => onDelete(c.name)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', display: 'flex', flexShrink: 0 }}>
                  <XIcon size={14} />
                </button>
              </Tooltip>
            </div>
          );
        })}
        {columns.length === 0 && (
          <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-sm)', textAlign: 'center', padding: 'var(--s4) 0' }}>
            Every column has been removed.
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--s4)' }}>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

export function ReportEngine({ type = 'reel' }) {
  const { addToast } = useToast();
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewJobId = searchParams.get('job'); // set when opened from History -- view a specific past report
  const [isHistoryView, setIsHistoryView] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobState, setJobState] = useState('loading'); // loading, upload, preview, running, paused, done
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Whether this account has ever finished a report before -- gates the
  // welcome screen's subtitle (see the upload-state render below). Defaults
  // to false (the generic copy) rather than true, so a returning user on a
  // slow connection never gets a flash of "your first report" before this
  // resolves -- a wrong generic message for a few hundred ms is harmless,
  // a wrong "first report" message for a longtime user is the thing that
  // was reported as a bug.
  const [isFirstReport, setIsFirstReport] = useState(false);
  useEffect(() => {
    apiFetch('/jobs?limit=1')
      .then((res) => setIsFirstReport((res.total || 0) === 0))
      .catch(() => {});
  }, []);

  // Preview state
  const [previewData, setPreviewData] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all'); // all, valid, invalid, duplicates

  // Optional campaign tag, offered at the preview step so grouping happens
  // at the natural moment (before you've committed to anything) rather than
  // as a separate chore in History afterward. Entirely optional -- Start
  // works exactly as before if none of this is touched.
  const [campaigns, setCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const [columnsModalOpen, setColumnsModalOpen] = useState(false);
  // Client-side only: the done/running results table already holds every
  // row in memory (see the "done" transition below), so filtering by search
  // term is just a local array filter, no server round-trip needed.
  const [resultsSearch, setResultsSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [rows, setRows] = useState([]);
  /*
    True while a page of rows is in flight. Without this the preview table
    rendered its header the instant jobState flipped to 'preview' and then
    grew when the rows arrived, which is the glitch clients reported after
    navigating away and back.
  */
  const [rowsLoading, setRowsLoading] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [overLimitModal, setOverLimitModal] = useState(false);
  const [overLimitCount, setOverLimitCount] = useState(0);
  const [editingColName, setEditingColName] = useState(null);
  const [tempColName, setTempColName] = useState('');
  const [draggedColName, setDraggedColName] = useState(null);
  const [dragOverColName, setDragOverColName] = useState(null);

  // Running state
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [counts, setCounts] = useState({ total: 0, processed: 0, failed: 0, success: 0, skipped: 0 });
  const [etaMs, setEtaMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  // null = "no estimate yet" (the moment a run starts, before the first poll
  // response arrives), which used to be indistinguishable from 0 and showed
  // "finishing up" for the first couple seconds of even a 200-link run.
  const [displayEtaMs, setDisplayEtaMs] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [startedAt, setStartedAt] = useState(null);
  const [finishedAt, setFinishedAt] = useState(null);
  const liveTableRef = useRef(null);
  const [notifyOnDone, setNotifyOnDone] = useState(() => localStorage.getItem('rl-notify-on-done') === '1');
  // The polling effect below only re-subscribes when jobState/jobId/autoScroll
  // change, not when this toggle changes mid-run -- a ref keeps it reading
  // the latest value without needing to restart the poll loop for it.
  const notifyOnDoneRef = useRef(notifyOnDone);
  notifyOnDoneRef.current = notifyOnDone;

  // Confirm dialogs
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [viewedReels, setViewedReels] = useState(null); // { username, perReel } | null
  // { loading, history: [{at,avgViews,avgEr}], otherCampaigns: [name] } | null.
  // Fetched lazily per creator, only while their modal is open -- pure
  // rollups of the agency's own past reports, no Apify call involved.
  const [creatorInsights, setCreatorInsights] = useState(null);
  const [showMethodology, setShowMethodology] = useState(false);
  const [noteEditRow, setNoteEditRow] = useState(null); // row being edited | null
  const [noteFlagInput, setNoteFlagInput] = useState(null);
  const [noteTextInput, setNoteTextInput] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const resetLocalState = () => {
    setJobId(null);
    setJobState('upload');
    setPreviewData(null);
    setRows([]);
    setTotalRows(0);
    setCounts({ total: 0, processed: 0, failed: 0, success: 0, skipped: 0 });
    setElapsedMs(0);
    setDisplayEtaMs(0);
    setStartedAt(null);
    setFinishedAt(null);
    // A campaign picked for the report just discarded must not silently
    // carry over and get applied to whatever gets uploaded next.
    setSelectedCampaignId('');
  };

  // Fetched once, independent of upload/preview state, so the picker has
  // something to show the moment a preview appears rather than a spinner.
  useEffect(() => {
    apiFetch('/campaigns')
      .then((res) => setCampaigns(res.campaigns || []))
      .catch(() => {});
  }, []);

  const handleCreateCampaign = async (name) => {
    try {
      const res = await apiFetch('/campaigns', { method: 'POST', body: JSON.stringify({ name }) });
      setCampaigns((prev) => [res.campaign, ...prev]);
      return res.campaign;
    } catch (err) {
      addToast(err.message || "Couldn't create that campaign, try again", 'err');
      return null;
    }
  };

  const rehydrateFromJob = (job) => {
    setJobId(job._id);
    setCounts(job.counts);
    // Set regardless of status -- a rehydrated running/paused/done job can
    // still be Reset back to preview later, and that render needs
    // previewData to already be populated or it renders blank (this was a
    // real bug: Reset after a page refresh showed an empty page because
    // previewData was only ever set for status === 'preview').
    setPreviewData({ fileName: job.fileName, columns: job.originalColumns || [], creditsPerItem: job.creditsPerItem });
    const startedTs = job.startedAt ? new Date(job.startedAt).getTime() : null;
    const finishedTs = job.finishedAt ? new Date(job.finishedAt).getTime() : null;
    setStartedAt(job.startedAt || null);
    setFinishedAt(job.finishedAt || null);
    if (startedTs) setElapsedMs((finishedTs || Date.now()) - startedTs);

    if (job.status === 'preview') {
      setJobState('preview');
      setCurrentPage(1);
      // Set before the fetch, not inside it: the table renders on this same
      // tick, and it must render as skeleton rather than as an empty shell.
      setRowsLoading(true);
      fetchRowsPage(1, 'all', job._id);
    } else if (job.status === 'running' || job.status === 'paused') {
      setJobState(job.status);
      setRows(job.rows || []);
      setTotalRows((job.rows || []).length);
    } else if (job.status === 'done') {
      setJobState('done');
      setRows(job.rows || []);
      setTotalRows((job.rows || []).length);
    } else {
      setJobState('upload');
    }
  };

  // Rehydration: the job itself lives server-side (jobEngine keeps running
  // regardless of the client), so on mount we ask "do I have an existing
  // report of this type?" instead of always dropping back to the upload
  // screen. This is what makes a run survive tab-switch, refresh, and
  // logout/login -- only an explicit Discard clears it (see handleDiscard).
  //
  // If opened from History with ?job=ID, that specific report is shown
  // instead (read-only browsing of a past run) -- it does NOT change which
  // job is "active" for this type, so leaving this view goes back to
  // whatever was actually in progress, not the history item just looked at.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (viewJobId) {
          const data = await apiFetch(`/jobs/${viewJobId}`);
          if (cancelled) return;
          if (data.job) {
            setIsHistoryView(true);
            rehydrateFromJob(data.job);
            return;
          }
        }
        const data = await apiFetch(`/jobs/active?type=${type}`);
        if (cancelled) return;
        setIsHistoryView(false);
        if (data.job) rehydrateFromJob(data.job);
        else setJobState('upload');
      } catch (err) {
        if (!cancelled) setJobState('upload');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, viewJobId]);

  // Deliberately does NOT flip isHistoryView here -- that used to happen
  // immediately on click, which dropped the "viewing history" banner while
  // the still-loaded past report's data stayed on screen for a moment
  // (looked like it had jumped to a random unrelated report). Showing the
  // loading state instead and letting the mount effect below flip
  // isHistoryView only once the real current report has actually loaded
  // means nothing stale is ever shown in between.
  const exitHistoryView = () => {
    setJobState('loading');
    searchParams.delete('job');
    setSearchParams(searchParams);
  };

  const handleFileSelected = async (fileOrText) => {
    setLoading(true);
    setLoadingMessage('Reading your sheet...');

    const formData = new FormData();
    if (typeof fileOrText === 'string') {
      formData.append('links', fileOrText);
    } else {
      formData.append('file', fileOrText);
    }

    try {
      const data = await apiFetch(`/upload/${type}`, {
        method: 'POST',
        body: formData
      });

      setJobId(data.jobId);
      setPreviewData(data);
      setTotalRows(data.totalRows);
      setCounts(data.counts);
      setJobState('preview');
      setCurrentPage(1);
      fetchRowsPage(1, 'all', data.jobId);
    } catch (err) {
      addToast(err.message || "We couldn't read that file. Check the format and try again.", 'err');
    } finally {
      setLoading(false);
    }
  };

  const fetchRowsPage = async (page = 1, filter = activeFilter, targetJobId = jobId, limit = pageSize) => {
    if (!targetJobId) return;
    setRowsLoading(true);
    try {
      const data = await apiFetch(`/jobs/${targetJobId}/rows?page=${page}&state=${filter}&limit=${limit}`);
      setRows(data.rows || []);
      setTotalRows(data.total || 0);
      setCurrentPage(data.page || page);
    } catch (err) {
      console.error(err);
    } finally {
      setRowsLoading(false);
    }
  };

  const handlePageSizeChange = (size) => {
    const next = Number(size);
    setPageSize(next);
    setCurrentPage(1);
    fetchRowsPage(1, activeFilter, jobId, next);
  };

  const handleFilterChange = (filter) => {
    setActiveFilter(filter);
    setCurrentPage(1);
    fetchRowsPage(1, filter);
  };

  const handleRenameColumn = async (oldName, newName) => {
    if (!newName.trim()) {
      setEditingColName(null);
      return;
    }
    try {
      const renames = { [oldName]: newName.trim() };
      const res = await apiFetch(`/jobs/${jobId}/columns`, {
        method: 'PATCH',
        body: JSON.stringify({ renames })
      });
      setPreviewData(prev => ({
        ...prev,
        columns: res.columns
      }));
      setEditingColName(null);
      addToast('Column renamed', 'ok');
    } catch (err) {
      addToast("Couldn't rename that column, try again", 'err');
    }
  };

  const handleDeleteColumn = async (name) => {
    try {
      const res = await apiFetch(`/jobs/${jobId}/columns`, {
        method: 'PATCH',
        body: JSON.stringify({ removed: [name] })
      });
      setPreviewData(prev => ({ ...prev, columns: res.columns }));
      addToast('Column removed', 'ok');
    } catch (err) {
      addToast("Couldn't remove that column, try again", 'err');
    }
  };

  const handleReorderColumns = async (order) => {
    // Optimistic: reflect the new order immediately, the request below just
    // persists it -- if it fails the columns are still usable, just not
    // saved in the new order, so a toast is enough without reverting.
    setPreviewData(prev => {
      const byName = new Map(prev.columns.map(c => [c.name, c]));
      return { ...prev, columns: order.map(n => byName.get(n)).filter(Boolean) };
    });
    try {
      await apiFetch(`/jobs/${jobId}/columns`, {
        method: 'PATCH',
        body: JSON.stringify({ order })
      });
    } catch (err) {
      addToast("Couldn't save the new column order, try again", 'err');
    }
  };

  const handleColumnDrop = (targetName) => {
    if (!draggedColName || draggedColName === targetName) {
      setDraggedColName(null);
      setDragOverColName(null);
      return;
    }
    const names = previewData.columns.map(c => c.name);
    const from = names.indexOf(draggedColName);
    const to = names.indexOf(targetName);
    if (from === -1 || to === -1) return;
    const next = [...names];
    next.splice(from, 1);
    next.splice(to, 0, draggedColName);
    setDraggedColName(null);
    setDragOverColName(null);
    handleReorderColumns(next);
  };

  const handleStartJob = async (confirmLimit = false) => {
    try {
      await apiFetch(`/jobs/${jobId}/start`, {
        method: 'POST',
        body: JSON.stringify({ limitTo2000Confirmed: confirmLimit })
      });
      // Not awaited on purpose: tagging a campaign is a convenience, not
      // part of what makes a report run. If this fails, the report is still
      // running correctly and can be tagged from History afterward -- it
      // must never be the reason a report fails to start.
      if (selectedCampaignId) {
        apiFetch(`/jobs/${jobId}/campaign`, { method: 'PATCH', body: JSON.stringify({ campaignId: selectedCampaignId }) })
          .catch(() => addToast("Report started, but couldn't tag it to that campaign -- you can still do that from History.", 'accent'));
      }
      // `rows` up to this point only holds whatever page of the preview was
      // last loaded (100 at a time) -- the live-progress polling below only
      // ever UPDATES existing rows by index, it never appends new ones. Without
      // this, anything past row 100 would silently never appear on screen even
      // though it's really being processed. Fetching the full job here seeds
      // every row up front so every index the poll reports back has somewhere
      // to land.
      const full = await apiFetch(`/jobs/${jobId}`);
      if (full.job) {
        setRows(full.job.rows || []);
        setTotalRows((full.job.rows || []).length);
      }
      setJobState('running');
      setStartedAt(new Date().toISOString());
      setOverLimitModal(false);
      addToast('Your report is running', 'ok');
    } catch (err) {
      if (err.code === 'OVER_LIMIT') {
        setOverLimitCount(err.validRowsCount);
        setOverLimitModal(true);
      } else {
        addToast(err.message || "Couldn't start the report, try again", 'err');
      }
    }
  };

  const handlePause = async () => {
    try {
      await apiFetch(`/jobs/${jobId}/pause`, { method: 'POST' });
      setJobState('paused');
    } catch (err) {
      addToast("Couldn't pause, try again", 'err');
    }
  };

  const handleResume = async () => {
    try {
      await apiFetch(`/jobs/${jobId}/resume`, { method: 'POST' });
      setJobState('running');
    } catch (err) {
      addToast("Couldn't resume, try again", 'err');
    }
  };

  const handleToggleNotify = async (checked) => {
    if (checked && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        addToast("Notifications are blocked in your browser. Allow them in your browser settings to use this.", 'err');
        return;
      }
    }
    setNotifyOnDone(checked);
    localStorage.setItem('rl-notify-on-done', checked ? '1' : '0');
  };

  const handleReset = async () => {
    try {
      await apiFetch(`/jobs/${jobId}/reset`, { method: 'POST' });
      setJobState('preview');
      setStartedAt(null);
      setFinishedAt(null);
      fetchRowsPage(1, activeFilter);
      addToast("Back to preview, nothing's been charged", 'accent');
    } catch (err) {
      addToast("Couldn't reset, try again", 'err');
    }
  };

  const handleRetryFailed = async () => {
    try {
      await apiFetch(`/jobs/${jobId}/retry-failed`, { method: 'POST' });
      setJobState('running');
      addToast("Retrying the links that didn't go through...", 'accent');
    } catch (err) {
      addToast("Couldn't retry, try again", 'err');
    }
  };

  // The only thing that stops a job from being auto-restored on next visit.
  // When browsing a past report from History, this shouldn't touch that old
  // job at all -- it just leaves the history view and returns to whatever's
  // actually current.
  const handleDiscard = async () => {
    if (isHistoryView) {
      exitHistoryView();
      setConfirmDiscard(false);
      return;
    }
    const idToDiscard = jobId;
    resetLocalState();
    setConfirmDiscard(false);
    if (idToDiscard) {
      try { await apiFetch(`/jobs/${idToDiscard}/discard`, { method: 'POST' }); } catch (err) { /* local state already reset */ }
    }
  };

  const openNoteEditor = (row) => {
    setNoteEditRow(row);
    setNoteFlagInput(row.flag || null);
    setNoteTextInput(row.note || '');
  };

  const handleSaveNote = async () => {
    if (!noteEditRow || !jobId) return;
    setSavingNote(true);
    try {
      await apiFetch(`/jobs/${jobId}/rows/${noteEditRow.i}`, {
        method: 'PATCH',
        body: JSON.stringify({ flag: noteFlagInput, note: noteTextInput.trim() }),
      });
      setRows((prev) => prev.map((r) => (r.i === noteEditRow.i ? { ...r, flag: noteFlagInput, note: noteTextInput.trim() } : r)));
      setNoteEditRow(null);
    } catch (err) {
      addToast(err.message || "Couldn't save that note, try again", 'err');
    } finally {
      setSavingNote(false);
    }
  };

  useEffect(() => {
    if (jobState !== 'running' || !jobId) return;

    let maxSeenIndex = 0;
    let lastSeenSuccess = 0;
    const interval = setInterval(async () => {
      try {
        const data = await apiFetch(`/jobs/${jobId}/progress?after=${maxSeenIndex}`);
        setCounts(data.counts);
        setEtaMs(data.etaMs);
        // Credits are spent server-side as each item succeeds, but the
        // sidebar balance comes from AuthContext, which only refetches on
        // page load -- without this it silently drifts stale until a manual
        // refresh, even though the real balance already moved.
        if (data.counts.success > lastSeenSuccess) {
          lastSeenSuccess = data.counts.success;
          refreshUser();
        }
        if (data.startedAt) setStartedAt(data.startedAt);
        // Smooth the countdown. The local 1s ticker owns the displayed value;
        // we only re-sync to the server estimate when it has drifted a lot
        // (>5s), otherwise the 2s poll would keep snapping the number back up
        // and it visibly jitters (4 -> 3 -> 2 -> 4 ...). Never let it increase
        // on small changes, so it always counts down monotonically.
        setDisplayEtaMs(prev => {
          const next = data.etaMs;
          if (next == null) return prev;
          if (!prev) return next;
          if (Math.abs(next - prev) > 5000) return next;
          return Math.min(prev, next);
        });

        if (data.status === 'done') {
          setJobState('done');
          if (data.finishedAt) setFinishedAt(data.finishedAt);
          // Not the paginated /rows endpoint -- that caps at 100 regardless of
          // query params, which used to cut the finished results table off at
          // row 100 with no way to see the rest. GET /jobs/:id returns the
          // whole job, rows included.
          const fullRes = await apiFetch(`/jobs/${jobId}`);
          setRows((fullRes.job && fullRes.job.rows) || []);
          addToast(`Report finished: ${data.counts.success} of ${data.counts.total} succeeded.`, 'ok');
          document.title = `✓ Report ready · Reelytic`;
          if (notifyOnDoneRef.current && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('Your report is ready', {
              body: `${data.counts.success} of ${data.counts.total} links succeeded.`,
            });
          }
        } else {
          const pct = data.counts.total > 0 ? Math.round((data.counts.processed / data.counts.total) * 100) : 0;
          document.title = `▶ ${pct}% · Reelytic`;
        }

        if (data.updates && data.updates.length > 0) {
          const updateMap = new Map(data.updates.map(u => [u.i, u]));
          setRows(prev => prev.map(r => updateMap.has(r.i) ? { ...r, ...updateMap.get(r.i) } : r));
          const maxUpdateI = Math.max(...data.updates.map(u => u.i));
          if (maxUpdateI > maxSeenIndex) maxSeenIndex = maxUpdateI;

          if (autoScroll && liveTableRef.current) {
            liveTableRef.current.scrollTop = liveTableRef.current.scrollHeight;
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      document.title = 'Reelytic: Campaign Reports in Minutes';
    };
  }, [jobState, jobId, autoScroll]);

  useEffect(() => {
    if (jobState !== 'running') return;
    const ticker = setInterval(() => {
      setElapsedMs(prev => prev + 1000);
      setDisplayEtaMs(prev => (prev == null ? null : Math.max(0, prev - 1000)));
    }, 1000);
    return () => clearInterval(ticker);
  }, [jobState]);

  // Fires once per creator, only while their "posts considered" modal is
  // open. Both halves of this are rollups of reports this account has
  // already run and paid for -- no Apify call involved.
  useEffect(() => {
    if (!viewedReels || !viewedReels.username || !jobId) { setCreatorInsights(null); return; }
    let cancelled = false;
    setCreatorInsights({ loading: true, history: [], otherCampaigns: [] });
    apiFetch(`/jobs/${jobId}/creator-insights?username=${encodeURIComponent(viewedReels.username)}`)
      .then((data) => { if (!cancelled) setCreatorInsights({ loading: false, ...data }); })
      .catch(() => { if (!cancelled) setCreatorInsights({ loading: false, history: [], otherCampaigns: [] }); });
    return () => { cancelled = true; };
  }, [viewedReels, jobId]);

  const formatDuration = (ms) => {
    if (ms == null || ms < 0) return '0:00';
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatEta = (ms) => {
    if (ms == null) return 'Calculating...';
    if (ms <= 0) return 'finishing up...';
    return `${formatDuration(ms)} left`;
  };

  const processingTimeLabel = () => {
    if (!startedAt) return null;
    const start = new Date(startedAt).getTime();
    const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
    return formatDurationWords(end - start);
  };

  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  const insights = useMemo(() => computeReportInsights(rows, type), [rows, type]);

  const searchedRows = useMemo(() => {
    const term = resultsSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => {
      const username = (r.result && r.result.username || '').toLowerCase();
      const url = (r.input && r.input.url || '').toLowerCase();
      return username.includes(term) || url.includes(term);
    });
  }, [rows, resultsSearch]);

  if (jobState === 'loading') {
    return (
      <BrandLoader message="Checking for an existing report..." />
    );
  }

  return (
    <div>
      {/*
        Full width, matching the stat cards/campaign bar/table below (all of
        which run the page's full 1600px content column, set in Shell.jsx) --
        capping just this row to a reading width left "Start new report"
        stopping short of where every other row on the page ends, which reads
        as broken alignment rather than intentional restraint.
      */}
      {/* This header is deliberately absent during the upload state -- a
          welcoming "Welcome, {name}" screen replaces it below instead of a
          plain "Reel Report" page title, which is what a returning user
          starting another run sees just as much as a true first-timer. */}
      {jobState !== 'upload' && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s4)', marginBottom: 'var(--s4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: 'var(--r-md)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'color-mix(in srgb, var(--accent) 16%, transparent)',
              color: 'var(--accent)',
            }}>
              {type === 'reel' ? <ReelIcon size={17} /> : <ProfileIcon size={17} />}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, textTransform: 'capitalize' }}>
                  {type} Report
                </h1>
                {jobState === 'done' && (
                  <span className={`chip ${counts.success === 0 ? 'err' : 'ok'}`} style={{ fontSize: 'var(--fs-xs)' }}>
                    {counts.success === 0 ? 'Failed' : 'Completed'}
                  </span>
                )}
              </div>
              <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>
                {jobState === 'preview' && previewData && `${counts.total} links imported from ${previewData.fileName}`}
                {jobState === 'running' && 'Fetching live metrics from Instagram with audited ledger rules.'}
                {jobState === 'paused' && 'This report is paused. Resume anytime.'}
                {jobState === 'done' && (counts.success === 0
                  ? 'Report finished, but none of these links could be read.'
                  : 'Report complete. Inspect results below or download your report.')}
              </p>
            </div>
          </div>

          {/* "Run another report" in the completion summary below already
              covers the done-state's "start over" action -- a second one up
              here would be the same escape hatch twice on one screen. */}
          {isHistoryView ? (
            <button className="btn btn-secondary" onClick={exitHistoryView}>
              ← Back to current report
            </button>
          ) : jobState !== 'done' && (
            <button className="btn btn-secondary" onClick={() => setConfirmDiscard(true)} style={{ gap: 'var(--s2)' }}>
              <PlusIcon size={16} />Start new report
            </button>
          )}
        </div>
      )}

      {isHistoryView && (
        <div className="chip accent" style={{ display: 'inline-flex', padding: '6px 12px', marginBottom: 'var(--s5)' }}>
          Viewing a past report from your history. This isn't your current run.
        </div>
      )}

      {/* State A: Upload -- a welcome screen, not a page titled "Reel Report",
          since this is the first thing between a user and their first (or
          next) report rather than a data view that needs a heading. */}
      {jobState === 'upload' && (
        loading ? (
          <BrandLoader message={loadingMessage || 'Parsing sheet structure and validating links...'} />
        ) : (
          <div className="rl-onboarding">
            <div className="rl-onboarding-icon">
              {type === 'reel' ? <ReelIcon size={26} /> : <ProfileIcon size={26} />}
            </div>
            <h1 className="rl-onboarding-title">
              Welcome, <span className="rl-onboarding-name">{user?.username}</span>
            </h1>
            <p className="rl-onboarding-sub">
              {isFirstReport
                ? 'Your first client-ready report is just a few links away.'
                : 'Upload a campaign sheet or paste links to get started.'}
            </p>

            <FileDrop onFileSelected={handleFileSelected} type={type} />

            <p className="rl-onboarding-privacy">
              <ShieldIcon size={14} />Your data is secure and never shared with anyone.
            </p>

            <div className="rl-howitworks">
              <h2 className="rl-howitworks-title">How it works</h2>
              <div className="rl-howitworks-steps">
                <div className="rl-howitworks-step">
                  <div className="rl-howitworks-icon-wrap">
                    <CloudUploadIcon size={22} />
                    <span className="rl-howitworks-num">01</span>
                  </div>
                  <div className="rl-howitworks-step-title">Upload</div>
                  <div className="rl-howitworks-step-desc">Upload your Excel, CSV or TXT file with links.</div>
                </div>
                <div className="rl-howitworks-connector" />
                <div className="rl-howitworks-step">
                  <div className="rl-howitworks-icon-wrap">
                    <ChartIcon size={22} />
                    <span className="rl-howitworks-num">02</span>
                  </div>
                  <div className="rl-howitworks-step-title">Process</div>
                  <div className="rl-howitworks-step-desc">We extract views, likes, comments, shares and engagement metrics.</div>
                </div>
                <div className="rl-howitworks-connector" />
                <div className="rl-howitworks-step">
                  <div className="rl-howitworks-icon-wrap">
                    <DownloadIcon size={22} />
                    <span className="rl-howitworks-num">03</span>
                  </div>
                  <div className="rl-howitworks-step-title">Download</div>
                  <div className="rl-howitworks-step-desc">Get your enriched report ready to share with your clients.</div>
                </div>
              </div>
            </div>
          </div>
        )
      )}

      {/* State B: Preview */}
      {jobState === 'preview' && previewData && (
        <div>
          {/*
            Sticky, not just top-of-page: a real campaign sheet can run to
            hundreds of rows (mostly duplicates flagged for the agency to
            see, not to scroll past), and neither the campaign field nor the
            Start button did anyone any good sitting above a table long
            enough to scroll them out of view. This is the same shape every
            data-heavy SaaS table uses -- filters and the primary action
            pinned in the control area above the rows, not floating over
            them -- rather than a second, easy-to-miss copy of the same
            controls at the bottom.
          */}
          {/*
            A compact status row, not four dashboard KPI cards. This is a
            data-review screen -- the table is the point, these four numbers
            exist to be scanned in half a second on the way to it, and still
            work exactly as before as filter toggles. "Ready to process"
            gets the strongest visual weight (green, the number a size up)
            since it answers the one question that actually matters here;
            duplicates stays neutral on purpose so 132 excluded links don't
            visually outweigh the 1 that's actually going to run.
          */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
            <StatFilterCard icon={<FileIcon size={14} />} tone="neutral" value={counts.total} label="Total" active={activeFilter === 'all'} onClick={() => handleFilterChange('all')} />
            <StatFilterCard icon={<SuccessIcon size={14} />} tone="ok" value={counts.valid} label="Ready" emphasize active={activeFilter === 'valid'} onClick={() => handleFilterChange('valid')} />
            <StatFilterCard icon={<WarningIcon size={14} />} tone="warn" value={counts.invalid} label="Invalid" active={activeFilter === 'invalid'} onClick={() => handleFilterChange('invalid')} />
            <StatFilterCard icon={<LayersIcon size={14} />} tone="info" value={counts.duplicates} label="Duplicates" active={activeFilter === 'duplicates'} onClick={() => handleFilterChange('duplicates')} />
          </div>

          {/* One control bar, one row: label, campaign field, cost, run --
              not a tall card with its own internal heading and stacked rows. */}
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap', padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s3)' }}>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, flexShrink: 0 }}>
              Campaign <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span>
            </span>
            <CampaignCombobox
              campaigns={campaigns}
              value={selectedCampaignId}
              onSelect={setSelectedCampaignId}
              onCreate={handleCreateCampaign}
              placeholder="Optional campaign name"
              style={{ flex: '1 1 220px', minWidth: 0 }}
            />
            {previewData.creditsPerItem != null && (
              <Tooltip content={`${previewData.creditsPerItem} credit${previewData.creditsPerItem === 1 ? '' : 's'} per link, charged only for links that actually succeed`}>
              <span
                className="chip"
                style={{ padding: '5px 10px', gap: '6px', flexShrink: 0 }}
              >
                Uses {counts.valid * previewData.creditsPerItem} credit{counts.valid * previewData.creditsPerItem === 1 ? '' : 's'}
                <InfoIcon size={12} style={{ color: 'var(--text-3)' }} />
              </span>
              </Tooltip>
            )}
            <Tooltip content={counts.valid === 0 ? 'There are no valid links in this sheet to run' : undefined}>
            <button
              className="btn btn-primary"
              onClick={() => handleStartJob(false)}
              disabled={counts.valid === 0}
              style={{ gap: 'var(--s2)', flexShrink: 0 }}
            >
              <PlayIcon size={14} />
              {counts.valid === 0 ? 'No valid links to run' : 'Run report'}
            </button>
            </Tooltip>
          </div>

          {/* Says what to do about it, rather than leaving a dead button with
              no explanation. Shown once, above the table, because at this
              point the table is entirely red rows and needs a headline. */}
          {counts.valid === 0 && counts.total > 0 ? (
            <div style={{
              marginBottom: 'var(--s3)', padding: 'var(--s3)',
              background: 'var(--err-soft)', border: '1px solid var(--err)',
              borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', lineHeight: 1.6,
            }}>
              <strong style={{ color: 'var(--err)' }}>
                None of these {counts.total} links can be used.
              </strong>
              <span style={{ color: 'var(--text-2)' }}>
                {' '}Nothing will be charged and there is nothing to run. This usually means the column
                picked up isn't the one holding the links, or the links are {type === 'reel'
                  ? 'profile or story URLs rather than reel links'
                  : 'reel or post URLs rather than profile links'}.
                {' '}Discard this and upload again with the correct column.
              </span>
            </div>
          ) : null}

          {/* "Preview" already needs a ready-count subtitle, so the
              duplicates/invalid breakdown lives there too instead of
              repeating "N ready" on its own line right above it -- that
              was the same fact stated twice in two consecutive lines. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: '4px' }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 'var(--fs-sm)' }}>Preview</span>
              <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>
                {' · '}<strong style={{ color: counts.valid > 0 ? 'var(--ok)' : 'var(--text-3)' }}>{counts.valid} link{counts.valid === 1 ? '' : 's'} ready</strong>
                {counts.valid > 0 && counts.duplicates > 0 && <> · {counts.duplicates} duplicate{counts.duplicates === 1 ? '' : 's'} excluded</>}
                {counts.valid > 0 && counts.invalid > 0 && <> · {counts.invalid} invalid excluded</>}
              </span>
            </div>
            <button className="btn btn-secondary" onClick={() => setColumnsModalOpen(true)} style={{ gap: 'var(--s2)', height: '28px', fontSize: 'var(--fs-xs)', padding: '0 10px' }}>
              <SettingsIcon size={13} />Customize columns
            </button>
          </div>

          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s2)' }}>
            Click a column header to rename it · Drag to reorder
          </div>

          <div className="data-table-container" style={{ marginBottom: 'var(--s4)' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>SR</th>
                  <th title="The cleaned-up version of your link that we'll actually use to fetch data, tracking parameters and redirects removed. Your original column stays untouched further right.">Link we'll use</th>
                  <th>Status</th>
                  {previewData.columns.map(c => {
                    const colName = c.renamedTo || c.name;
                    return (
                      <th
                        key={c.name}
                        className="rl-editable-col"
                        draggable
                        onDragStart={() => setDraggedColName(c.name)}
                        onDragOver={(e) => { e.preventDefault(); if (dragOverColName !== c.name) setDragOverColName(c.name); }}
                        onDragLeave={() => setDragOverColName(prev => (prev === c.name ? null : prev))}
                        onDrop={(e) => { e.preventDefault(); handleColumnDrop(c.name); }}
                        onDragEnd={() => { setDraggedColName(null); setDragOverColName(null); }}
                        style={{
                          cursor: 'grab',
                          backgroundColor: dragOverColName === c.name ? 'var(--accent-soft)' : undefined,
                          opacity: draggedColName === c.name ? 0.4 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Tooltip content="Drag to reorder"><span style={{ color: 'var(--text-3)', cursor: 'grab', display: 'flex' }}><GripIcon size={13} /></span></Tooltip>
                          {editingColName === c.name ? (
                            <input
                              type="text"
                              value={tempColName}
                              onChange={e => setTempColName(e.target.value)}
                              onBlur={() => handleRenameColumn(c.name, tempColName)}
                              onKeyDown={e => e.key === 'Enter' && handleRenameColumn(c.name, tempColName)}
                              autoFocus
                              style={{ background: 'var(--surface)', border: '1px solid var(--accent)', padding: '2px 4px', width: '100px', fontSize: 'var(--fs-xs)' }}
                            />
                          ) : (
                            <Tooltip content="Click to rename">
                            <span
                              onClick={() => { setEditingColName(c.name); setTempColName(colName); }}
                              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                              {colName}
                              <PencilIcon size={11} style={{ color: 'var(--text-3)' }} />
                            </span>
                            </Tooltip>
                          )}
                          <Tooltip content={`Remove "${colName}" from this report`}>
                          <button
                            type="button"
                            className="rl-col-remove"
                            onClick={() => handleDeleteColumn(c.name)}
                            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', padding: '0 2px', lineHeight: 1 }}
                          >
                            <XIcon size={13} />
                          </button>
                          </Tooltip>
                        </div>
                      </th>
                    );
                  })}
                  {LOCKED_COLUMNS[type].map(name => (
                    <th key={name} className="numeric" style={{ backgroundColor: 'var(--locked)', color: 'var(--text-2)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                       {name}
                    </th>
                  ))}
                </tr>
              </thead>
              {rowsLoading ? (
                <TableSkeleton
                  rows={Math.min(rows.length || 10, 10)}
                  columns={3 + previewData.columns.length + LOCKED_COLUMNS[type].length}
                  label="Loading links"
                />
              ) : (
              <tbody>
                {rows.map(r => (
                  <tr key={r.i} style={{ backgroundColor: r.state === 'invalid' ? 'var(--err-soft)' : r.state === 'duplicate' ? 'var(--warn-soft)' : 'transparent' }}>
                    <td className="mono" style={{ color: 'var(--text-3)' }}>{r.i}</td>
                    <td className="mono">
                      {/* The URL gets its own truncation box so the copy
                          button sits outside it -- putting ellipsis on the
                          whole cell clipped the button off-screen behind a
                          long URL instead of just shortening the text. */}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', maxWidth: '280px' }}>
                        <Tooltip content={r.input.url}>
                        <a
                          href={r.input.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '230px', verticalAlign: 'bottom' }}
                        >
                          {r.input.url}
                        </a>
                        </Tooltip>
                        <CopyButton text={r.input.url} />
                      </span>
                    </td>
                    <td>
                      {r.state === 'invalid' && <Tooltip content={r.error}><span className="chip err">Invalid link</span></Tooltip>}
                      {r.state === 'duplicate' && <Tooltip content="Duplicate link — won't be processed"><span className="chip warn">Duplicate</span></Tooltip>}
                      {r.state === 'pending' && <span className="chip ok">Valid</span>}
                    </td>
                    {previewData.columns.map(c => (
                      <td key={c.name} style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {String(r.input.original[c.name] ?? '')}
                      </td>
                    ))}
                    {LOCKED_COLUMNS[type].map(name => (
                      <td key={name} className="numeric" style={{ backgroundColor: 'var(--locked)', color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>
                        Pending
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              )}
            </table>
          </div>

          {/* Pagination Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
              <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
                Showing {rows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}-{(currentPage - 1) * pageSize + rows.length} of {totalRows} links
              </span>
              <Select
                value={pageSize}
                onChange={handlePageSizeChange}
                options={[10, 25, 50, 100].map((n) => ({ value: n, label: `${n} per page` }))}
                style={{ width: '130px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <button
                className="btn btn-secondary"
                disabled={currentPage <= 1}
                onClick={() => { const p = currentPage - 1; setCurrentPage(p); fetchRowsPage(p, activeFilter); }}
                aria-label="Previous page"
                style={{ padding: '0 10px' }}
              >
                ‹
              </button>
              {paginationRange(currentPage, totalPages).map((p, i) => (
                p === '...' ? (
                  <span key={`ellipsis-${i}`} style={{ padding: '0 4px', color: 'var(--text-3)', fontSize: 'var(--fs-sm)' }}>...</span>
                ) : (
                  <button
                    key={p}
                    className="btn btn-secondary"
                    onClick={() => { setCurrentPage(p); fetchRowsPage(p, activeFilter); }}
                    style={{
                      width: '36px', padding: 0, fontFamily: 'var(--font-data)',
                      ...(p === currentPage ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}),
                    }}
                  >
                    {p}
                  </button>
                )
              ))}
              <button
                className="btn btn-secondary"
                disabled={currentPage >= totalPages}
                onClick={() => { const p = currentPage + 1; setCurrentPage(p); fetchRowsPage(p, activeFilter); }}
                aria-label="Next page"
                style={{ padding: '0 10px' }}
              >
                ›
              </button>
            </div>
          </div>

          <div className="card" style={{ backgroundColor: 'var(--surface)' }}>
            {/* The campaign field lives in the sticky bar above the table, not
                duplicated here -- one place to set it, always visible. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)' }}>
              <div>
                <span style={{ fontFamily: 'var(--font-data)', fontWeight: 600 }}>{counts.valid} valid links ready</span>
                <span style={{ color: 'var(--text-2)', marginLeft: '8px', fontSize: 'var(--fs-sm)' }}>
                  (Estimated duration: ~{Math.ceil(counts.valid / 3 * 4 / 60)} min{previewData.creditsPerItem != null ? `, uses ${counts.valid * previewData.creditsPerItem} credits` : ''})
                </span>
              </div>
              <div style={{ display: 'flex', gap: 'var(--s3)' }}>
                <button className="btn btn-secondary" onClick={() => setConfirmDiscard(true)}>Discard</button>
                <Tooltip content={counts.valid === 0 ? 'There are no valid links in this sheet to run' : undefined}>
                <button
                  className="btn btn-primary"
                  onClick={() => handleStartJob(false)}
                  disabled={counts.valid === 0}
                >
                  {counts.valid === 0 ? 'No valid links to run' : `Start report, ${counts.valid} links`}
                </button>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* State C: Running / Paused */}
      {(jobState === 'running' || jobState === 'paused') && (
        <div>
          <div className="rl-stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
            <StatCard label="Total Links" value={counts.total} />
            <StatCard label="Processed" value={counts.processed} />
            <StatCard label="Success" value={counts.success} accent={true} />
            <StatCard label="Failed" value={counts.failed} />
            <StatCard label="Elapsed" value={formatDuration(elapsedMs)} sub={jobState === 'paused' ? 'Paused' : 'Live'} />
            <StatCard label="Est. Remaining" value={jobState === 'paused' ? 'Paused' : formatEta(displayEtaMs)} sub={jobState === 'paused' ? 'Report paused' : 'Learns over time'} />
          </div>

          <div className="card" data-tour="results-table" style={{ marginBottom: 'var(--s5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--s2)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
              <span>{jobState === 'paused' ? 'Paused' : 'Fetching your metrics...'}</span>
              <span className="mono">{counts.total > 0 ? Math.round((counts.processed / counts.total) * 100) : 0}%</span>
            </div>
            <ProgressBar percent={counts.total > 0 ? (counts.processed / counts.total) * 100 : 0} />

            {/* Results land in groups, not one at a time -- without this note,
                the first group can take a couple of minutes to appear (longer
                on a cold start), and with the counters still sitting at zero
                that silence reads as broken rather than working. Only shown
                once it's actually been quiet a while, so a fast small report
                never sees it flash by. */}
            {jobState === 'running' && counts.processed === 0 && elapsedMs > 15000 && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', marginTop: 'var(--s3)', padding: 'var(--s3)', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>
                ⏳ Results come back in groups rather than one at a time, so the first group can take a couple of minutes to show up, longer for larger reports. Nothing's wrong, this is still running.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--s4)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
                 This report keeps going even if you close the tab. Come back anytime.
              </div>
              <div style={{ display: 'flex', gap: 'var(--s3)' }}>
                {jobState === 'running' ? (
                  <button className="btn btn-secondary" onClick={handlePause}>Pause</button>
                ) : (
                  <button className="btn btn-primary" onClick={handleResume}>Resume</button>
                )}
                <button className="btn btn-secondary" onClick={handleReset}>Reset</button>
                {counts.processed > 0 ? (
                  <a href={`/api/export/${jobId}.xlsx`} className="btn btn-secondary" download>
                    Download partial ↓
                  </a>
                ) : (
                  <Tooltip content="Available once at least one link has finished">
                    <button className="btn btn-secondary" disabled>
                      Download partial ↓
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: 'var(--s3) var(--s4)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--surface-2)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
              <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-2)' }}>Results, updating live</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
                <Tooltip content="Get a browser notification the moment this report finishes.">
                  <label style={{ fontSize: 'var(--fs-xs)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={notifyOnDone} onChange={e => handleToggleNotify(e.target.checked)} />
                    Notify me when done
                  </label>
                </Tooltip>
                <Tooltip content="Keep the newest result in view as the run streams.">
                  <label style={{ fontSize: 'var(--fs-xs)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
                    Auto-scroll to newest
                  </label>
                </Tooltip>
              </div>
            </div>

            <ResultsTable rows={rows} type={type} scrollRef={liveTableRef} onViewReels={setViewedReels} onEditNote={openNoteEditor} />
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 'var(--s2)' }}>
            {ER_FORMULA[type]}
            {' · '}
            <button type="button" onClick={() => setShowMethodology(true)} className="rl-text-link">
              How is this calculated?
            </button>
          </div>
        </div>
      )}

      {/* State D: Done (With In-App Results Preview Table) */}
      {jobState === 'done' && (
        <div>
          {/*
            One compact enterprise strip, not a centered hero card: icon +
            headline + one-line stats on top, the metric tiles and the
            actions that follow from them directly underneath. Everything
            here reads left-to-right instead of being centered on the page,
            which is what let it stay compact instead of needing a tall
            card to look intentional.
          */}
          <div className="card" style={{ marginBottom: 'var(--s5)', padding: 'var(--s4) var(--s5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', flexWrap: 'wrap', marginBottom: counts.success > 0 ? 'var(--s4)' : 0 }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: counts.success === 0 ? 'var(--err-soft)' : 'var(--ok-soft)',
                color: counts.success === 0 ? 'var(--err)' : 'var(--ok)',
              }}>
                {counts.success === 0 ? <XIcon size={20} /> : <SuccessIcon size={20} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                  {counts.success === 0 ? 'No results' : 'Report ready'}
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
                  {counts.success === 0 ? `0 of ${counts.total} links could be read` : `${counts.success} of ${counts.total} succeeded`}
                </div>
                {/* Only rendered for the failure case -- on success the stat
                    tiles right below already show processed/succeeded/failed/
                    time with icons, so repeating them here in prose was the
                    same four numbers said twice in a row. */}
                {counts.success === 0 && (
                  <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-xs)', marginTop: '2px' }}>
                    None of these links could be read, so there is nothing to export or send. Check the links and try again.
                  </div>
                )}
              </div>
            </div>

            {counts.success > 0 && (
              <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
                <StatFilterCard icon={<FileIcon size={14} />} tone="neutral" value={counts.total} label="Total processed" />
                <StatFilterCard icon={<SuccessIcon size={14} />} tone="ok" value={counts.success} label="Succeeded" sublabel={`${Math.round((counts.success / counts.total) * 100)}%`} emphasize />
                <StatFilterCard icon={<XIcon size={14} />} tone={counts.failed > 0 ? 'err' : 'neutral'} value={counts.failed} label="Failed" sublabel={counts.failed > 0 ? `${Math.round((counts.failed / counts.total) * 100)}%` : undefined} />
                {processingTimeLabel() && (
                  <StatFilterCard icon={<ClockIcon size={14} />} tone="neutral" value={processingTimeLabel()} label="Total time" />
                )}
              </div>
            )}

            {/*
              Every action that produces a document needs at least one row to
              put in it. With all links invalid these still rendered, so the
              obvious next click handed the user an empty spreadsheet or a
              branded report with no creators in it: a junk screen that looks
              like the product is broken rather than like the links were bad.
              Retry and "run another report" stay, because those are the two
              things that actually help from here.
            */}
            <div className="rl-summary-actions" style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              {counts.success > 0 && (
                <>
                  <a href={`/api/export/${jobId}.xlsx`} className="btn btn-primary" data-tour="download-excel" download>
                    Download Excel (.xlsx) ↓
                  </a>
                  <a href={`/api/export/${jobId}.csv`} className="btn btn-secondary" download>
                    Download CSV ↓
                  </a>
                  <button type="button" className="btn btn-secondary" data-tour="preview-branded" onClick={() => navigate(`/reports/${jobId}/branded`)}>
                    Preview branded report
                  </button>
                </>
              )}
              {counts.failed > 0 && (
                <button className={`btn ${counts.success === 0 ? 'btn-primary' : 'btn-secondary'}`} onClick={handleRetryFailed}>
                  Retry failed ({counts.failed})
                </button>
              )}
              <button className="btn btn-secondary" onClick={handleDiscard}>
                Run another report
              </button>
            </div>
          </div>

          {/* Highlights: four compact read-only tiles, same data the plain-English
              summary used to narrate in prose -- restating it as cards instead of
              cards-plus-sentence, since the numbers alone already answer "what
              stood out." Top/bottom only render when there's an actual spread
              to report; average views/ER need only two successful rows. */}
          {insights && (
            <div className="card" data-tour="highlights" style={{ marginBottom: 'var(--s5)', padding: 'var(--s4) var(--s5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s3)' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>
                  Highlights
                </h3>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ height: '28px', fontSize: 'var(--fs-xs)', padding: '0 10px' }}
                  onClick={() => {
                    navigator.clipboard.writeText(buildSummaryText(insights, type));
                    setSummaryCopied(true);
                    setTimeout(() => setSummaryCopied(false), 1500);
                  }}
                >
                  {summaryCopied ? 'Copied ✓' : 'Copy summary'}
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--s3)' }}>
                {insights.hasSpread && (
                  <a
                    href={insights.top.link}
                    target="_blank"
                    rel="noreferrer"
                    className="card"
                    style={{ display: 'block', padding: 'var(--s3) var(--s4)', textDecoration: 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '4px' }}>
                      <TrendingUpIcon size={12} style={{ color: 'var(--ok)' }} />Top performer
                    </div>
                    <div className="mono" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 'var(--fs-base)' }}>@{insights.top.name}</div>
                    <div style={{ color: 'var(--ok)', fontSize: 'var(--fs-sm)', marginTop: '2px' }}>
                      {formatCompactNumber(insights.top.views)} views · {insights.top.er.toFixed(1)}% ER
                    </div>
                  </a>
                )}
                {insights.hasSpread && (
                  <a
                    href={insights.bottom.link}
                    target="_blank"
                    rel="noreferrer"
                    className="card"
                    style={{ display: 'block', padding: 'var(--s3) var(--s4)', textDecoration: 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '4px' }}>
                      <TrendingDownIcon size={12} style={{ color: 'var(--err)' }} />Lowest performer
                    </div>
                    <div className="mono" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 'var(--fs-base)' }}>@{insights.bottom.name}</div>
                    <div style={{ color: 'var(--err)', fontSize: 'var(--fs-sm)', marginTop: '2px' }}>
                      {formatCompactNumber(insights.bottom.views)} views · {insights.bottom.er.toFixed(1)}% ER
                    </div>
                  </a>
                )}
                <div className="card" style={{ padding: 'var(--s3) var(--s4)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '4px' }}>
                    <EyeIcon size={12} style={{ color: 'var(--info)' }} />Average views
                  </div>
                  <div className="mono" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 'var(--fs-base)' }}>{formatCompactNumber(insights.avgViews)}</div>
                  <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: '2px' }}>Per {type === 'reel' ? 'reel' : 'profile'}</div>
                  <BarSparkline values={insights.viewsList} color="var(--info)" formatValue={(v) => `${formatCompactNumber(v)} views`} />
                </div>
                <div className="card" style={{ padding: 'var(--s3) var(--s4)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '4px' }}>
                    <TrendingUpIcon size={12} style={{ color: 'var(--warn)' }} />Avg engagement rate
                  </div>
                  <div className="mono" style={{ color: 'var(--warn)', fontWeight: 700, fontSize: 'var(--fs-base)' }}>{insights.medianEr.toFixed(1)}%</div>
                  <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: '2px' }}>Typical ER</div>
                  <BarSparkline values={insights.erList} color="var(--warn)" formatValue={(v) => `${v.toFixed(1)}% ER`} />
                </div>
              </div>
            </div>
          )}

          {/* In-App Results Preview Table */}
          <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: 'var(--s4)', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--s2)' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>Results</h3>
                <span className="chip ok" style={{ fontSize: 'var(--fs-xs)' }}>
                  {resultsSearch ? `${searchedRows.length} matching` : `${counts.success} succeeded`}
                </span>
              </div>
              <input
                type="text"
                className="input-field"
                placeholder="Search by username or link"
                value={resultsSearch}
                onChange={(e) => setResultsSearch(e.target.value)}
                style={{ height: '32px', fontSize: 'var(--fs-sm)', width: '220px' }}
              />
            </div>
            <ResultsTable rows={searchedRows} type={type} onViewReels={setViewedReels} onEditNote={openNoteEditor} />
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 'var(--s2)' }}>
            {ER_FORMULA[type]}
            {' · '}
            <button type="button" onClick={() => setShowMethodology(true)} className="rl-text-link">
              How is this calculated?
            </button>
          </div>
        </div>
      )}

      <Modal isOpen={overLimitModal} onClose={() => setOverLimitModal(false)} title="2,000-Link Report Limit">
        <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s4)' }}>
          This sheet has {overLimitCount} valid links. Reelytic runs up to 2,000 links per report for optimal performance and cost predictability.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={() => setOverLimitModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => handleStartJob(true)}>Run first 2,000 links</button>
        </div>
      </Modal>

      <Modal
        isOpen={!!noteEditRow}
        onClose={() => setNoteEditRow(null)}
        title={noteEditRow ? `Note for @${noteEditRow.result && noteEditRow.result.username}` : ''}
        width="420px"
      >
        <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s4)' }}>
          <button
            type="button"
            className={noteFlagInput === 'approved' ? 'chip ok' : 'chip'}
            style={{ cursor: 'pointer', padding: '6px 14px' }}
            onClick={() => setNoteFlagInput(noteFlagInput === 'approved' ? null : 'approved')}
          >
            ✓ Approved
          </button>
          <button
            type="button"
            className={noteFlagInput === 'flagged' ? 'chip err' : 'chip'}
            style={{ cursor: 'pointer', padding: '6px 14px' }}
            onClick={() => setNoteFlagInput(noteFlagInput === 'flagged' ? null : 'flagged')}
          >
             Flagged
          </button>
        </div>
        <div className="input-group">
          <label className="input-label" htmlFor="row-note">Note (optional)</label>
          <textarea
            id="row-note"
            className="input-field"
            style={{ width: '100%', minHeight: '80px', resize: 'vertical' }}
            value={noteTextInput}
            onChange={(e) => setNoteTextInput(e.target.value)}
            maxLength={280}
            placeholder="e.g. Confirmed for the campaign, engagement looks organic"
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: 'var(--s4)' }}>
          <button className="btn btn-secondary" onClick={() => setNoteEditRow(null)} disabled={savingNote}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSaveNote} disabled={savingNote}>
            {savingNote ? 'Saving...' : 'Save'}
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={!!viewedReels}
        onClose={() => setViewedReels(null)}
        title={viewedReels ? `Posts considered for @${viewedReels.username}` : ''}
        width="680px"
      >
        {viewedReels && viewedReels.candidates && viewedReels.candidates.length > 0 ? (
          (() => {
            const perReelByCode = new Map((viewedReels.perReel || []).map(r => [r.shortcode, r]));

            // Sponsored/collab share -- purely a rollup of the reasons
            // already sitting on these candidates, no new data needed.
            // Deliberately just a number: not "risky" or flagged, an
            // agency reads this in context far better than a verdict would.
            const paidCount = viewedReels.candidates.filter((c) => c.reason === 'collab' || c.reason === 'sponsored').length;
            const paidPct = Math.round((paidCount / viewedReels.candidates.length) * 100);

            return (
              <>
                {viewedReels.candidates.length > 0 && (
                  <div style={{ padding: 'var(--s3) var(--s4)', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s3)' }}>
                    <strong>{paidPct}%</strong> of the posts fetched here are collab or sponsored content ({paidCount} of {viewedReels.candidates.length}).
                  </div>
                )}

                {creatorInsights && creatorInsights.otherCampaigns && creatorInsights.otherCampaigns.length > 0 && (
                  <div style={{ padding: 'var(--s3) var(--s4)', background: 'color-mix(in srgb, var(--warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 25%, transparent)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s3)' }}>
                    Also used in {creatorInsights.otherCampaigns.length === 1 ? 'another campaign' : `${creatorInsights.otherCampaigns.length} other campaigns`}: {creatorInsights.otherCampaigns.join(', ')}.
                  </div>
                )}

                {creatorInsights && creatorInsights.history && creatorInsights.history.length > 0 && (
                  <div style={{ marginBottom: 'var(--s4)' }}>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s2)' }}>
                      From your past reports on this creator (most recent first):
                    </div>
                    <div className="data-table-container">
                      <table className="data-table">
                        <thead><tr><th>Report date</th><th className="numeric">Avg views</th><th className="numeric">ER %</th></tr></thead>
                        <tbody>
                          {creatorInsights.history.map((h, i) => (
                            <tr key={i}>
                              <td className="mono" style={{ color: 'var(--text-3)' }}>{formatDate(h.at)}</td>
                              <td className="numeric mono">{h.avgViews != null ? h.avgViews.toLocaleString() : '-'}</td>
                              <td className="numeric mono">{h.avgEr != null ? `${h.avgEr}%` : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <p style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s3)' }}>
                  Every one of this creator's recent posts we fetched, most recent first, not just the ones averaged in.
                </p>
                <div className="data-table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40px' }}>#</th>
                        <th>Post</th>
                        <th>Date</th>
                        <th className="numeric">Views</th>
                        <th className="numeric">Likes</th>
                        <th className="numeric">Comments</th>
                        <th className="numeric">ER (%)</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewedReels.candidates.map((c, idx) => {
                        const detail = perReelByCode.get(c.shortCode);
                        const dim = !c.included ? { opacity: 0.55 } : undefined;
                        return (
                          <tr key={c.shortCode || idx} style={dim}>
                            <td className="mono" style={{ color: 'var(--text-3)' }}>{idx + 1}</td>
                            <td className="mono">
                              {c.url ? (
                                <>
                                  <a href={c.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                                    {c.shortCode || 'View post'} ↗
                                  </a>{' '}
                                  <CopyButton text={c.url} />
                                </>
                              ) : (c.shortCode || '-')}
                            </td>
                            <td className="mono" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>
                              {formatDate(c.timestamp)}
                            </td>
                            <td className="numeric mono">{c.views != null ? c.views.toLocaleString() : '-'}</td>
                            <td className="numeric mono">{detail ? (detail.likes ?? 0).toLocaleString() : '-'}</td>
                            <td className="numeric mono">{detail ? (detail.comments ?? 0).toLocaleString() : '-'}</td>
                            <td className="numeric mono">{detail ? `${detail.er ?? 0}%` : '-'}</td>
                            <td>
                              <span className={`chip ${c.included ? 'ok' : 'warn'}`} style={{ fontSize: 'var(--fs-xs)' }}>
                                {CANDIDATE_REASON_LABELS[c.reason] || c.reason}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()
        ) : viewedReels && (
          <div className="data-table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>#</th>
                  <th>Reel</th>
                  <th className="numeric">Views</th>
                  <th className="numeric">Likes</th>
                  <th className="numeric">Comments</th>
                  <th className="numeric">ER (%)</th>
                </tr>
              </thead>
              <tbody>
                {(viewedReels.perReel || []).map((reel, idx) => (
                  <tr key={reel.shortcode || idx}>
                    <td className="mono" style={{ color: 'var(--text-3)' }}>{idx + 1}</td>
                    <td className="mono">
                      {reel.link ? (
                        <>
                          <a href={reel.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                            {reel.shortcode || 'View reel'} ↗
                          </a>{' '}
                          <CopyButton text={reel.link} />
                        </>
                      ) : (reel.shortcode || '-')}
                    </td>
                    <td className="numeric mono">{(reel.views ?? 0).toLocaleString()}</td>
                    <td className="numeric mono">{(reel.likes ?? 0).toLocaleString()}</td>
                    <td className="numeric mono">{(reel.comments ?? 0).toLocaleString()}</td>
                    <td className="numeric mono">{reel.er ?? 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmDiscard}
        title="Start a new report?"
        message="You'll move to a fresh upload screen and this one will stop being your active report. Nothing is deleted; it stays in your History if you want to come back to it or download results later."
        confirmText="Start new report"
        isDestructive={false}
        onConfirm={handleDiscard}
        onClose={() => setConfirmDiscard(false)}
      />

      {type === 'reel' ? (
        <ReelMethodologyModal isOpen={showMethodology} onClose={() => setShowMethodology(false)} />
      ) : (
        <ProfileMethodologyModal
          isOpen={showMethodology}
          onClose={() => setShowMethodology(false)}
          calcVariant={rows.find((r) => r.result && r.result.calcVariant)?.result?.calcVariant}
        />
      )}

      {previewData && (
        <ColumnsModal
          isOpen={columnsModalOpen}
          onClose={() => setColumnsModalOpen(false)}
          columns={previewData.columns}
          onRename={handleRenameColumn}
          onDelete={handleDeleteColumn}
          onReorder={handleReorderColumns}
        />
      )}
    </div>
  );
}
