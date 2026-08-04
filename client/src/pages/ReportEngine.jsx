import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { FileDrop } from '../components/FileDrop';
import { Shimmer } from '../components/Shimmer';
import { StatCard } from '../components/StatCard';
import { ProgressBar } from '../components/ProgressBar';
import { CopyButton } from '../components/CopyButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { ProfileMethodologyModal } from '../components/ProfileMethodologyModal';
import { ReelMethodologyModal } from '../components/ReelMethodologyModal';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';

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
function computeReportInsights(rows, type) {
  const successful = rows.filter((r) => r.state === 'done' && r.result && r.result.username);
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

  const eligible = successful.filter((r) => (Number(r.result[viewsKey]) || 0) > 0);

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

  return { count: successful.length, avgViews, avgEr, top, bottom, hasSpread };
}

// Plain text, not markdown -- meant to be pasted straight into an email or
// Slack message an agency sends to their own client, so it needs to read
// cleanly with zero formatting applied.
function buildSummaryText(insights, type) {
  const lines = [
    type === 'reel'
      ? `${insights.count} Reels analyzed. Average ${formatCompactNumber(insights.avgViews)} views, ${insights.avgEr.toFixed(1)}% engagement rate.`
      : `${insights.count} profiles analyzed. Average ${formatCompactNumber(insights.avgViews)} views per Reel, ${insights.avgEr.toFixed(1)}% engagement rate.`,
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
    case 'failed': return <span className="chip err" title={row.error}>Invalid link</span>;
    case 'invalid': return <span className="chip err" title={row.error}>Invalid link</span>;
    case 'duplicate': return <span className="chip warn">Duplicate, won't be processed</span>;
    case 'processing': return <span className="chip accent">Processing...</span>;
    case 'skipped': return <span className="chip">Skipped</span>;
    default: return <span className="chip">Pending</span>;
  }
}

// URL cell: the raw submitted link, always shown, with a copy icon -- this is
// the traceable record of exactly what was submitted.
function UrlCell({ row }) {
  return (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', maxWidth: '240px' }}>
      <a
        href={row.input.url}
        target="_blank"
        rel="noreferrer"
        style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: '200px', verticalAlign: 'bottom' }}
        title={row.input.url}
      >
        {row.input.url}
      </a>
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
    <button
      type="button"
      onClick={() => onViewReels({ username: res.username, candidates: res.candidates, perReel: res.perReel })}
      className="mono"
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontWeight: 700, padding: 0, textDecoration: 'underline', font: 'inherit' }}
      title="See which posts were considered and why"
    >
      {res.reelsAnalyzed}
    </button>
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
      <td className="numeric mono" style={isOk ? { color: 'var(--ok)', fontWeight: 600 } : undefined}>{isOk ? `${res.avgEr ?? 0}%` : '-'}</td>
      <td className="numeric mono">{isOk ? <ReelsAnalyzedCell res={res} onViewReels={onViewReels} /> : '-'}</td>
      <td className="numeric mono">{isOk ? (res.reelsSkippedAsOutliers ?? 0) : '-'}</td>
    </>
  );
}

const FLAG_STYLE = {
  approved: { label: '✓ Approved', color: 'var(--ok)' },
  flagged: { label: '⚑ Flagged', color: 'var(--err)' },
};

// Triage note/flag button -- only meaningful once a row has actually
// resolved, so it's a no-op placeholder for anything still pending.
function NoteCell({ row, onEditNote }) {
  if (row.state !== 'done' || !row.result) return <span style={{ color: 'var(--text-3)' }}>-</span>;
  const flagInfo = row.flag && FLAG_STYLE[row.flag];
  return (
    <button
      type="button"
      onClick={() => onEditNote(row)}
      title={row.note || 'Add a note'}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        fontSize: 'var(--fs-xs)', fontWeight: 600, textDecoration: flagInfo ? 'none' : 'underline',
        color: flagInfo ? flagInfo.color : 'var(--accent)', whiteSpace: 'nowrap',
      }}
    >
      {flagInfo ? flagInfo.label : '+ Note'}
    </button>
  );
}

// Desktop: a real fixed-column table, values aligned directly under headers.
// Mobile: stacked label:value cards -- reused everywhere via the same rows/type.
function ResultsTable({ rows, type, scrollRef, onViewReels, onEditNote }) {
  const reelHeaders = ['#', 'URL', 'Username', 'Status', 'Followers', 'Views', 'Likes', 'Comments', 'Shares', 'Reposts', 'Saves', 'ER (%)', 'Notes'];
  const profileHeaders = ['#', 'URL', 'Username', 'Status', 'Followers', 'Avg Views', 'Avg ER (%)', 'Reels Analyzed', 'Reels Skipped (outliers)', 'Notes'];
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
                  <span style={{ color: 'var(--text-3)' }}>Avg ER</span><span className="mono" style={{ textAlign: 'right', color: isOk ? 'var(--ok)' : undefined, fontWeight: 600 }}>{isOk ? `${res.avgEr ?? 0}%` : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Reels Analyzed</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? <ReelsAnalyzedCell res={res} onViewReels={onViewReels} /> : '-'}</span>
                  <span style={{ color: 'var(--text-3)' }}>Reels Skipped (outliers)</span><span className="mono" style={{ textAlign: 'right' }}>{isOk ? (res.reelsSkippedAsOutliers ?? 0) : '-'}</span>
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

export function ReportEngine({ type = 'reel' }) {
  const { addToast } = useToast();
  const { refreshUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewJobId = searchParams.get('job'); // set when opened from History -- view a specific past report
  const [isHistoryView, setIsHistoryView] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [jobState, setJobState] = useState('loading'); // loading, upload, preview, running, paused, done
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Preview state
  const [previewData, setPreviewData] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all'); // all, valid, invalid, duplicates
  // Client-side only: the done/running results table already holds every
  // row in memory (see the "done" transition below), so filtering by search
  // term is just a local array filter, no server round-trip needed.
  const [resultsSearch, setResultsSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [rows, setRows] = useState([]);
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

  const fetchRowsPage = async (page = 1, filter = activeFilter, targetJobId = jobId) => {
    if (!targetJobId) return;
    try {
      const data = await apiFetch(`/jobs/${targetJobId}/rows?page=${page}&state=${filter}`);
      setRows(data.rows || []);
      setTotalRows(data.total || 0);
      setCurrentPage(data.page || page);
    } catch (err) {
      console.error(err);
    }
  };

  const handleFilterChange = (filter) => {
    setActiveFilter(filter);
    setCurrentPage(1);
    fetchRowsPage(1, filter);
  };

  const handleRenameColumn = async (oldName) => {
    if (!tempColName.trim()) {
      setEditingColName(null);
      return;
    }
    try {
      const renames = { [oldName]: tempColName.trim() };
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

  const totalPages = Math.ceil(totalRows / 50) || 1;

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
      <div className="card" style={{ textAlign: 'center', padding: 'var(--s8)' }}>
        <Shimmer width="60px" height="60px" borderRadius="50%" style={{ margin: '0 auto var(--s4) auto' }} />
        <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>Checking for an existing report...</div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s6)' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, textTransform: 'capitalize' }}>
            {type} Report
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)' }}>
            {jobState === 'upload' && 'Upload a spreadsheet or paste links to generate engagement metrics.'}
            {jobState === 'preview' && 'Review parsed links, rename columns, and start your run.'}
            {jobState === 'running' && 'Fetching live metrics from Instagram with audited ledger rules.'}
            {jobState === 'paused' && 'This report is paused. Resume anytime.'}
            {jobState === 'done' && 'Report complete. Inspect results below or download styled Excel/CSV.'}
          </p>
        </div>

        {isHistoryView ? (
          <button className="btn btn-secondary" onClick={exitHistoryView}>
            ← Back to current report
          </button>
        ) : jobState !== 'upload' && (
          <button className="btn btn-secondary" onClick={() => setConfirmDiscard(true)}>
            Start new report
          </button>
        )}
      </div>

      {isHistoryView && (
        <div className="chip accent" style={{ display: 'inline-flex', padding: '6px 12px', marginBottom: 'var(--s5)' }}>
          📜 Viewing a past report from your history. This isn't your current run.
        </div>
      )}

      {/* State A: Upload */}
      {jobState === 'upload' && (
        <div>
          {loading ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--s8)' }}>
              <div style={{ marginBottom: 'var(--s4)' }}><Shimmer width="60px" height="60px" borderRadius="50%" style={{ margin: '0 auto' }} /></div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 600, marginBottom: 'var(--s2)' }}>{loadingMessage}</div>
              <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>Parsing sheet structure and validating links...</div>
            </div>
          ) : (
            <FileDrop onFileSelected={handleFileSelected} type={type} />
          )}
        </div>
      )}

      {/* State B: Preview */}
      {jobState === 'preview' && previewData && (
        <div>
          <div style={{ display: 'flex', gap: 'var(--s3)', marginBottom: 'var(--s5)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="chip" style={{ padding: '6px 12px', fontWeight: 600 }}>📄 {previewData.fileName}</span>
            <button onClick={() => handleFilterChange('all')} className={`chip ${activeFilter === 'all' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>All ({counts.total})</button>
            <button onClick={() => handleFilterChange('valid')} className={`chip ${activeFilter === 'valid' ? 'ok' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Valid ({counts.valid})</button>
            <button onClick={() => handleFilterChange('invalid')} className={`chip ${activeFilter === 'invalid' ? 'err' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Invalid ({counts.invalid})</button>
            <button onClick={() => handleFilterChange('duplicates')} className={`chip ${activeFilter === 'duplicates' ? 'warn' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Duplicates ({counts.duplicates})</button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s1)', flexWrap: 'wrap', gap: 'var(--s2)' }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>💡 Click a column name to rename it, drag to reorder, or use × to remove it, all before you run.</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
              {previewData.creditsPerItem != null && (
                <span className="chip accent" style={{ padding: '6px 12px' }}>
                  Uses {counts.valid * previewData.creditsPerItem} credits
                </span>
              )}
              <button className="btn btn-primary" onClick={() => handleStartJob(false)}>
                Start report, {counts.valid} links
              </button>
            </div>
          </div>

          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', marginBottom: 'var(--s2)' }}>
            🔒 These columns are filled in once the report runs, so you know exactly what's coming: <strong>{LOCKED_COLUMNS[type].join(', ')}</strong>
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
                          <span style={{ color: 'var(--text-3)', cursor: 'grab' }} title="Drag to reorder">⠿</span>
                          {editingColName === c.name ? (
                            <input
                              type="text"
                              value={tempColName}
                              onChange={e => setTempColName(e.target.value)}
                              onBlur={() => handleRenameColumn(c.name)}
                              onKeyDown={e => e.key === 'Enter' && handleRenameColumn(c.name)}
                              autoFocus
                              style={{ background: 'var(--surface)', border: '1px solid var(--accent)', padding: '2px 4px', width: '100px', fontSize: 'var(--fs-xs)' }}
                            />
                          ) : (
                            <span
                              onClick={() => { setEditingColName(c.name); setTempColName(colName); }}
                              style={{ cursor: 'pointer' }}
                              title="Click to rename"
                            >
                              {colName} ✏️
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteColumn(c.name)}
                            title={`Remove "${colName}" from this report`}
                            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </div>
                      </th>
                    );
                  })}
                  {LOCKED_COLUMNS[type].map(name => (
                    <th key={name} className="numeric" style={{ backgroundColor: 'var(--locked)', color: 'var(--text-2)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      🔒 {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.i} style={{ backgroundColor: r.state === 'invalid' ? 'var(--err-soft)' : r.state === 'duplicate' ? 'var(--warn-soft)' : 'transparent' }}>
                    <td className="mono" style={{ color: 'var(--text-3)' }}>{r.i}</td>
                    <td className="mono" style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <a href={r.input.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{r.input.url}</a> <CopyButton text={r.input.url} />
                    </td>
                    <td>
                      {r.state === 'invalid' && <span className="chip err" title={r.error}>Invalid link</span>}
                      {r.state === 'duplicate' && <span className="chip warn">Duplicate, won't be processed</span>}
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
            </table>
          </div>

          {/* Pagination Footer */}
          <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: 'var(--s6)' }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
              Showing {rows.length} of {totalRows} rows (50 per page)
            </div>
            <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
              <button
                className="btn btn-secondary"
                disabled={currentPage <= 1}
                onClick={() => { const p = currentPage - 1; setCurrentPage(p); fetchRowsPage(p, activeFilter); }}
              >
                Previous
              </button>
              <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-data)' }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn btn-secondary"
                disabled={currentPage >= totalPages}
                onClick={() => { const p = currentPage + 1; setCurrentPage(p); fetchRowsPage(p, activeFilter); }}
              >
                Next
              </button>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--surface)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
            <div>
              <span style={{ fontFamily: 'var(--font-data)', fontWeight: 600 }}>{counts.valid} valid links ready</span>
              <span style={{ color: 'var(--text-2)', marginLeft: '8px', fontSize: 'var(--fs-sm)' }}>
                (Estimated duration: ~{Math.ceil(counts.valid / 3 * 4 / 60)} min{previewData.creditsPerItem != null ? `, uses ${counts.valid * previewData.creditsPerItem} credits` : ''})
              </span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--s3)' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmDiscard(true)}>Discard</button>
              <button className="btn btn-primary" onClick={() => handleStartJob(false)}>
                Start report, {counts.valid} links
              </button>
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

          <div className="card" style={{ marginBottom: 'var(--s5)' }}>
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
                🔒 This report keeps going even if you close the tab. Come back anytime.
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
                  <button className="btn btn-secondary" disabled title="Available once at least one link has finished">
                    Download partial ↓
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: 'var(--s3) var(--s4)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--surface-2)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
              <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-2)' }}>Results, updating live</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
                <label style={{ fontSize: 'var(--fs-xs)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }} title="Get a browser notification the moment this report finishes.">
                  <input type="checkbox" checked={notifyOnDone} onChange={e => handleToggleNotify(e.target.checked)} />
                  Notify me when done
                </label>
                <label style={{ fontSize: 'var(--fs-xs)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }} title="Keep the newest result in view as the run streams.">
                  <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
                  Auto-scroll to newest
                </label>
              </div>
            </div>

            <ResultsTable rows={rows} type={type} scrollRef={liveTableRef} onViewReels={setViewedReels} onEditNote={openNoteEditor} />
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 'var(--s2)' }}>
            {ER_FORMULA[type]}
            {' · '}
            <button type="button" onClick={() => setShowMethodology(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>
              How is this calculated?
            </button>
          </div>
        </div>
      )}

      {/* State D: Done (With In-App Results Preview Table) */}
      {jobState === 'done' && (
        <div>
          <div className="card" style={{ marginBottom: 'var(--s6)', textAlign: 'center', padding: 'var(--s6)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
              🎉 Report Ready: {counts.success} of {counts.total} Succeeded
            </h2>
            <p style={{ color: 'var(--text-2)', maxWidth: '440px', margin: '0 auto var(--s2) auto', fontSize: 'var(--fs-base)' }}>
              Verify results in the live preview below or download your professional Excel/CSV export.
            </p>
            {processingTimeLabel() && (
              <p style={{ color: 'var(--text-3)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s5)' }}>
                Processed {counts.total} items in {processingTimeLabel()}.
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              <a href={`/api/export/${jobId}.xlsx`} className="btn btn-primary" download>
                Download Excel (.xlsx) ↓
              </a>
              <a href={`/api/export/${jobId}.csv`} className="btn btn-secondary" download>
                Download CSV ↓
              </a>
              {counts.failed > 0 && (
                <button className="btn btn-secondary" onClick={handleRetryFailed}>
                  Retry failed ({counts.failed})
                </button>
              )}
              <button className="btn btn-secondary" onClick={handleDiscard}>
                Run another report
              </button>
            </div>
          </div>

          {/* Highlights: plain-English summary + best/worst performer callouts */}
          {insights && (
            <div className="card" style={{ marginBottom: 'var(--s6)', padding: 'var(--s5)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s2)' }}>
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
              <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)', marginBottom: insights.hasSpread ? 'var(--s5)' : 0 }}>
                {type === 'reel'
                  ? `This report covers ${insights.count} Reels, averaging ${formatCompactNumber(insights.avgViews)} views and a ${insights.avgEr.toFixed(1)}% engagement rate.`
                  : `This report covers ${insights.count} profiles, averaging ${formatCompactNumber(insights.avgViews)} views per Reel and a ${insights.avgEr.toFixed(1)}% engagement rate.`}
              </p>
              {insights.hasSpread && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--s4)' }}>
                  <a
                    href={insights.top.link}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'block', padding: 'var(--s4)', borderRadius: 'var(--r-md)', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', textDecoration: 'none' }}
                  >
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--s1)' }}>
                      🏆 Top performer
                    </div>
                    <div className="mono" style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 'var(--fs-base)' }}>@{insights.top.name}</div>
                    <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: 'var(--s1)' }}>
                      {formatCompactNumber(insights.top.views)} views · {insights.top.er.toFixed(1)}% ER
                    </div>
                  </a>
                  <a
                    href={insights.bottom.link}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'block', padding: 'var(--s4)', borderRadius: 'var(--r-md)', backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)', textDecoration: 'none' }}
                  >
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: 'var(--s1)' }}>
                      Lowest performer
                    </div>
                    <div className="mono" style={{ color: 'var(--accent)', fontWeight: 700, fontSize: 'var(--fs-base)' }}>@{insights.bottom.name}</div>
                    <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: 'var(--s1)' }}>
                      {formatCompactNumber(insights.bottom.views)} views · {insights.bottom.er.toFixed(1)}% ER
                    </div>
                  </a>
                </div>
              )}
            </div>
          )}

          {/* In-App Results Preview Table */}
          <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: 'var(--s4)', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>Results</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Search by username or link"
                  value={resultsSearch}
                  onChange={(e) => setResultsSearch(e.target.value)}
                  style={{ height: '32px', fontSize: 'var(--fs-sm)', width: '220px' }}
                />
                <span className="chip ok">
                  {resultsSearch ? `${searchedRows.length} matching` : `${counts.success} succeeded`}
                </span>
              </div>
            </div>
            <ResultsTable rows={searchedRows} type={type} onViewReels={setViewedReels} onEditNote={openNoteEditor} />
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 'var(--s2)' }}>
            {ER_FORMULA[type]}
            {' · '}
            <button type="button" onClick={() => setShowMethodology(true)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline' }}>
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
            ⚑ Flagged
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
            return (
              <>
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
                              {c.timestamp ? new Date(c.timestamp).toLocaleDateString() : '-'}
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
    </div>
  );
}
