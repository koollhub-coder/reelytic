import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api/client';
import { FileDrop } from '../components/FileDrop';
import { Shimmer } from '../components/Shimmer';
import { StatCard } from '../components/StatCard';
import { ProgressBar } from '../components/ProgressBar';
import { CopyButton } from '../components/CopyButton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { useToast } from '../context/ToastContext';
import { FixedSizeList as List } from 'react-window';

export function ReportEngine({ type = 'reel' }) {
  const { addToast } = useToast();
  const [jobId, setJobId] = useState(null);
  const [jobState, setJobState] = useState('upload'); // upload, preview, running, paused, done
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Preview state
  const [previewData, setPreviewData] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all'); // all, valid, invalid, duplicates
  const [currentPage, setCurrentPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [overLimitModal, setOverLimitModal] = useState(false);
  const [overLimitCount, setOverLimitCount] = useState(0);
  const [editingColName, setEditingColName] = useState(null);
  const [tempColName, setTempColName] = useState('');

  // Running state
  const [counts, setCounts] = useState({ total: 0, processed: 0, failed: 0, success: 0, skipped: 0 });
  const [cursor, setCursor] = useState(0);
  const [etaMs, setEtaMs] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [displayEtaMs, setDisplayEtaMs] = useState(0);
  const [currentRows, setCurrentRows] = useState([]);
  const [followLive, setFollowLive] = useState(true);
  const listRef = useRef(null);

  // Confirm dialogs
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const handleFileSelected = async (fileOrText) => {
    setLoading(true);
    setLoadingMessage('Reading your sheet…');

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
      addToast(err.message || 'Failed to parse file', 'err');
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
      addToast('Column renamed successfully', 'ok');
    } catch (err) {
      addToast('Failed to rename column', 'err');
    }
  };

  const handleStartJob = async (confirmLimit = false) => {
    try {
      await apiFetch(`/jobs/${jobId}/start`, {
        method: 'POST',
        body: JSON.stringify({ limitTo2000Confirmed: confirmLimit })
      });
      setJobState('running');
      setOverLimitModal(false);
      addToast('Report started successfully', 'ok');
    } catch (err) {
      if (err.code === 'OVER_LIMIT') {
        setOverLimitCount(err.validRowsCount);
        setOverLimitModal(true);
      } else {
        addToast(err.message || 'Failed to start job', 'err');
      }
    }
  };

  const handlePause = async () => {
    try {
      await apiFetch(`/jobs/${jobId}/pause`, { method: 'POST' });
      setJobState('paused');
    } catch (err) {
      addToast('Failed to pause', 'err');
    }
  };

  const handleResume = async () => {
    try {
      await apiFetch(`/jobs/${jobId}/resume`, { method: 'POST' });
      setJobState('running');
    } catch (err) {
      addToast('Failed to resume', 'err');
    }
  };

  const handleReset = async () => {
    try {
      await apiFetch(`/jobs/${jobId}/reset`, { method: 'POST' });
      setJobState('preview');
      fetchRowsPage(1, activeFilter);
      addToast('Job reset to preview', 'accent');
    } catch (err) {
      addToast('Failed to reset', 'err');
    }
  };

  const handleRetryFailed = async () => {
    try {
      await apiFetch(`/jobs/${jobId}/retry-failed`, { method: 'POST' });
      setJobState('running');
      addToast('Retrying failed rows...', 'accent');
    } catch (err) {
      addToast('Failed to retry', 'err');
    }
  };
  useEffect(() => {
    if (jobState !== 'running' || !jobId) return;

    let maxSeenIndex = 0;
    const interval = setInterval(async () => {
      try {
        const data = await apiFetch(`/jobs/${jobId}/progress?after=${maxSeenIndex}`);
        setCounts(data.counts);
        setCursor(data.cursor);
        setEtaMs(data.etaMs);
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
        setCurrentRows(data.currentRows);

        if (data.status === 'done') {
          setJobState('done');
          const allRowsRes = await apiFetch(`/jobs/${jobId}/rows?page=1&state=all`);
          setRows(allRowsRes.rows || []);
          addToast(`Report finished — ${data.counts.success} of ${data.counts.total} succeeded.`, 'ok');
          document.title = `✓ Report ready · Reelytic`;
        } else {
          const pct = data.counts.total > 0 ? Math.round((data.counts.processed / data.counts.total) * 100) : 0;
          document.title = `▶ ${pct}% · Reelytic`;
        }

        if (data.updates && data.updates.length > 0) {
          const updateMap = new Map(data.updates.map(u => [u.i, u]));
          setRows(prev => prev.map(r => updateMap.has(r.i) ? { ...r, ...updateMap.get(r.i) } : r));
          const maxUpdateI = Math.max(...data.updates.map(u => u.i));
          if (maxUpdateI > maxSeenIndex) maxSeenIndex = maxUpdateI;
        }
      } catch (err) {
        console.error(err);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      document.title = 'Reelytic — Campaign Reports in Minutes';
    };
  }, [jobState, jobId]);

  useEffect(() => {
    if (jobState !== 'running') return;
    const ticker = setInterval(() => {
      setElapsedMs(prev => prev + 1000);
      setDisplayEtaMs(prev => Math.max(0, prev - 1000));
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
    if (!ms || ms <= 0) return 'finishing up…';
    return `${formatDuration(ms)} left`;
  };
  const totalPages = Math.ceil(totalRows / 100) || 1;

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
            {jobState === 'paused' && 'Job is currently paused. Resume anytime.'}
            {jobState === 'done' && 'Report complete. Inspect results below or download styled Excel/CSV.'}
          </p>
        </div>

        {jobState !== 'upload' && (
          <button className="btn btn-secondary" onClick={() => setConfirmDiscard(true)}>
            Start new report
          </button>
        )}
      </div>

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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s2)' }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>💡 Click any column header below to rename it before running.</div>
            <div style={{ display: 'flex', gap: 'var(--s3)' }}>
              <button className="btn btn-primary" onClick={() => handleStartJob(false)}>
                Start report — {counts.valid} links
              </button>
            </div>
          </div>

          <div className="data-table-container" style={{ marginBottom: 'var(--s4)' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>SR</th>
                  <th>URL / Link</th>
                  <th>Status</th>
                  {previewData.columns.map(c => {
                    const colName = c.renamedTo || c.name;
                    return (
                      <th key={c.name} style={{ cursor: 'pointer' }} onClick={() => { setEditingColName(c.name); setTempColName(colName); }}>
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
                          <span>{colName} ✏️</span>
                        )}
                      </th>
                    );
                  })}
                  <th style={{ backgroundColor: 'var(--locked)', color: 'var(--text-3)' }}>🔒 Reelytic Metrics</th>
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
                      {r.state === 'invalid' && <span className="chip err" title={r.error}>Invalid: {r.error}</span>}
                      {r.state === 'duplicate' && <span className="chip warn">Duplicate</span>}
                      {r.state === 'pending' && <span className="chip ok">Valid</span>}
                    </td>
                    {previewData.columns.map(c => (
                      <td key={c.name} style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {String(r.input.original[c.name] ?? '')}
                      </td>
                    ))}
                    <td style={{ backgroundColor: 'var(--locked)', color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>
                      Appended on run
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: 'var(--s6)' }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
              Showing {rows.length} of {totalRows} rows (100 per page)
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

          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--surface)' }}>
            <div>
              <span style={{ fontFamily: 'var(--font-data)', fontWeight: 600 }}>{counts.valid} valid links ready</span>
              <span style={{ color: 'var(--text-2)', marginLeft: '8px', fontSize: 'var(--fs-sm)' }}>
                (Estimated duration: ~{Math.ceil(counts.valid / 3 * 4 / 60)} min)
              </span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--s3)' }}>
              <button className="btn btn-secondary" onClick={() => setConfirmDiscard(true)}>Discard</button>
              <button className="btn btn-primary" onClick={() => handleStartJob(false)}>
                Start report — {counts.valid} links
              </button>
            </div>
          </div>
        </div>
      )}

      {/* State C: Running / Paused */}
      {(jobState === 'running' || jobState === 'paused') && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
            <StatCard label="Total Links" value={counts.total} />
            <StatCard label="Processed" value={counts.processed} />
            <StatCard label="Success" value={counts.success} accent={true} />
            <StatCard label="Failed" value={counts.failed} />
            <StatCard label="Elapsed" value={formatDuration(elapsedMs)} sub={jobState === 'paused' ? 'Paused' : 'Live'} />
            <StatCard label="Est. Remaining" value={jobState === 'paused' ? 'Paused' : formatEta(displayEtaMs)} sub={jobState === 'paused' ? 'Job paused' : 'Learns over time'} />
          </div>

          <div className="card" style={{ marginBottom: 'var(--s5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--s2)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
              <span>{jobState === 'paused' ? 'Job paused' : 'Processing batch…'}</span>
              <span className="mono">{counts.total > 0 ? Math.round((counts.processed / counts.total) * 100) : 0}%</span>
            </div>
            <ProgressBar percent={counts.total > 0 ? (counts.processed / counts.total) * 100 : 0} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--s4)' }}>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
                🔒 Safe to close this tab — report keeps running on the server.
              </div>
              <div style={{ display: 'flex', gap: 'var(--s3)' }}>
                {jobState === 'running' ? (
                  <button className="btn btn-secondary" onClick={handlePause}>Pause</button>
                ) : (
                  <button className="btn btn-primary" onClick={handleResume}>Resume</button>
                )}
                <button className="btn btn-secondary" onClick={handleReset}>Reset</button>
                <a href={`/api/export/${jobId}.xlsx`} className="btn btn-secondary" download>
                  Download partial ↓
                </a>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: 'var(--s3) var(--s4)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--surface-2)' }}>
              <span style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-2)' }}>Live Run Stream (Name, Views, Likes, Comments)</span>
              <label style={{ fontSize: 'var(--fs-xs)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <input type="checkbox" checked={followLive} onChange={e => setFollowLive(e.target.checked)} />
                Follow live
              </label>
            </div>

            <div style={{ height: '400px', width: '100%' }}>
              <List
                height={400}
                itemCount={rows.length}
                itemSize={40}
                width="100%"
                ref={listRef}
              >
                {({ index, style }) => {
                  const r = rows[index];
                  return (
                    <div style={{ ...style, display: 'flex', alignItems: 'center', padding: '0 var(--s4)', borderBottom: '1px solid var(--border)', fontSize: 'var(--fs-sm)', backgroundColor: r.state === 'done' ? 'transparent' : r.state === 'failed' ? 'var(--err-soft)' : 'var(--surface-2)' }}>
                      <span className="mono rl-stream-sr" style={{ width: '50px', color: 'var(--text-3)' }}>{r.i}</span>
                      <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={r.input.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{r.input.url}</a>
                      </span>
                      <span className="rl-stream-status" style={{ width: '110px' }}>
                        {r.state === 'pending' && <span className="chip">pending</span>}
                        {r.state === 'processing' && <span className="chip accent">posting…</span>}
                        {r.state === 'done' && <span className="chip ok">✓ success</span>}
                        {r.state === 'failed' && <span className="chip err" title={r.error}>failed</span>}
                        {r.state === 'invalid' && <span className="chip err">invalid</span>}
                      </span>
                      <span className="mono rl-stream-result" style={{ width: '360px', textAlign: 'right', fontSize: '11.5px', color: 'var(--text)' }}>
                        {r.result ? (
                          type === 'reel'
                            ? `${r.result.name} · ${r.result.views?.toLocaleString()} views · ${r.result.likes?.toLocaleString()} likes · ${r.result.comments?.toLocaleString()} cmt`
                            : `${r.result.name} · ${r.result.followers?.toLocaleString()} followers · ${r.result.avgViews?.toLocaleString()} avg views`
                        ) : '—'}
                      </span>
                    </div>
                  );
                }}
              </List>
            </div>
          </div>
        </div>
      )}

      {/* State D: Done (With In-App Results Preview Table) */}
      {jobState === 'done' && (
        <div>
          <div className="card" style={{ marginBottom: 'var(--s6)', textAlign: 'center', padding: 'var(--s6)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
              🎉 Report Ready — {counts.success} of {counts.total} Succeeded
            </h2>
            <p style={{ color: 'var(--text-2)', maxWidth: '440px', margin: '0 auto var(--s5) auto', fontSize: 'var(--fs-base)' }}>
              Verify results in the live preview below or download your professional Excel/CSV export.
            </p>
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
              <button className="btn btn-secondary" onClick={() => { setJobState('upload'); setJobId(null); }}>
                Run another report
              </button>
            </div>
          </div>

          {/* In-App Results Preview Table */}
          <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: 'var(--s4)', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>In-App Verified Results Preview</h3>
              <span className="chip ok">{counts.success} records processed</span>
            </div>
            <div className="data-table-container" style={{ border: 'none', borderRadius: '0' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {type === 'reel' ? (
                      <>
                        <th>SR</th>
                        <th>Creator Name</th>
                        <th>Profile Link</th>
                        <th>Reel Link</th>
                        <th className="numeric">Views</th>
                        <th className="numeric">Likes</th>
                        <th className="numeric">Comments</th>
                        <th className="numeric">ER (%)</th>
                      </>
                    ) : (
                      <>
                        <th>SR</th>
                        <th>Creator Name</th>
                        <th>Profile Link</th>
                        <th className="numeric">Followers</th>
                        <th className="numeric">Avg Views</th>
                        <th className="numeric">Avg ER (%)</th>
                        <th className="numeric">Reels Analyzed</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.filter(r => r.state === 'done' && r.result).map((r, idx) => {
                    const res = r.result;
                    if (type === 'reel') {
                      return (
                        <tr key={idx}>
                          <td className="mono" style={{ color: 'var(--text-3)' }}>{idx + 1}</td>
                          <td style={{ fontWeight: 600 }}>{res.name}</td>
                          <td className="mono">
                            <a href={res.profileLink} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Profile ↗</a>
                          </td>
                          <td className="mono" style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <a href={res.reelLink || r.input.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{res.reelLink || r.input.url}</a>
                          </td>
                          <td className="numeric mono">{res.views?.toLocaleString()}</td>
                          <td className="numeric mono">{res.likes?.toLocaleString()}</td>
                          <td className="numeric mono">{res.comments?.toLocaleString()}</td>
                          <td className="numeric mono" style={{ color: 'var(--ok)', fontWeight: 600 }}>{res.er}%</td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={idx}>
                        <td className="mono" style={{ color: 'var(--text-3)' }}>{idx + 1}</td>
                        <td style={{ fontWeight: 600 }}>{res.name}</td>
                        <td className="mono">
                          <a href={res.profileLink} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Profile ↗</a>
                        </td>
                        <td className="numeric mono">{res.followers?.toLocaleString() || '—'}</td>
                        <td className="numeric mono">{res.avgViews?.toLocaleString() || '—'}</td>
                        <td className="numeric mono" style={{ color: 'var(--ok)', fontWeight: 600 }}>{res.avgEr ?? '—'}%</td>
                        <td className="numeric mono">{res.reelsAnalyzed ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={overLimitModal} onClose={() => setOverLimitModal(false)} title="2,000-Link Job Limit">
        <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s4)' }}>
          This sheet has {overLimitCount} valid links. Reelytic runs up to 2,000 links per job for optimal performance and cost predictability.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={() => setOverLimitModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => handleStartJob(true)}>Run first 2,000 links</button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={confirmDiscard}
        title="Discard current report?"
        message="Any unsaved progress on this report will be lost."
        confirmText="Discard"
        isDestructive={true}
        onConfirm={() => {
          setJobState('upload');
          setJobId(null);
        }}
        onClose={() => setConfirmDiscard(false)}
      />
    </div>
  );
}
