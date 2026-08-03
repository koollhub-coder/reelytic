import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { Shimmer } from '../components/Shimmer';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { useToast } from '../context/ToastContext';

const STATUS_LABELS = {
  preview: { label: 'Not started', chip: 'warn' },
  running: { label: 'Running', chip: 'accent' },
  paused: { label: 'Paused', chip: 'warn' },
  done: { label: 'Complete', chip: 'ok' },
};

function formatDuration(startedAt, finishedAt) {
  if (!startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const totalSec = Math.max(0, Math.floor((end - start) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatDateRange(earliestAt, latestAt) {
  if (!earliestAt) return '';
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (!latestAt || fmt(earliestAt) === fmt(latestAt)) return fmt(earliestAt);
  return `${fmt(earliestAt)} - ${fmt(latestAt)}`;
}

function formatViews(n) {
  if (n == null) return '-';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

// Reports stay put on History instead of navigating away -- this page
// already shows everything meaningful about a finished report (status,
// counts, timing, downloads). The one exception is a report that hasn't
// finished yet: pausing, resuming, or starting it can only happen inside
// the report engine itself, so those get one clearly-labeled "Resume" link
// rather than making the whole row a hidden navigation trap.
function ReportRow({ job, campaigns, onReassign, navigate }) {
  const statusInfo = STATUS_LABELS[job.status] || { label: job.status, chip: '' };
  const isDone = job.status === 'done';
  const campaignOptions = [{ value: '', label: 'No campaign' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))];

  return (
    <tr>
      <td>
        <span className={`chip ${job.type === 'reel' ? 'accent' : 'ok'}`} style={{ textTransform: 'uppercase' }}>
          {job.type}
        </span>
      </td>
      <td style={{ fontWeight: 600 }}>{job.fileName}</td>
      <td className="numeric mono">{job.counts?.total || 0}</td>
      <td>
        <span className={`chip ${statusInfo.chip}`}>{statusInfo.label}</span>
      </td>
      <td className="mono" style={{ color: 'var(--text-3)' }}>{formatDuration(job.startedAt, job.finishedAt)}</td>
      <td className="mono" style={{ color: 'var(--text-3)' }}>
        {new Date(job.createdAt).toLocaleDateString()} {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </td>
      <td>
        <Select
          value={job.campaignId || ''}
          onChange={(v) => onReassign(job.id, v || null)}
          options={campaignOptions}
          style={{ minWidth: '140px' }}
        />
      </td>
      <td style={{ textAlign: 'right' }}>
        {isDone ? (
          <div style={{ display: 'inline-flex', gap: '6px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ height: '28px', fontSize: 'var(--fs-xs)', padding: '0 10px' }}
              onClick={() => navigate(`${job.type === 'reel' ? '/reels' : '/profiles'}?job=${job.id}`)}
            >
              View
            </button>
            {(job.counts?.success || 0) > 0 && (
              <>
                <a className="btn btn-secondary" style={{ height: '28px', fontSize: 'var(--fs-xs)', lineHeight: '28px', padding: '0 10px' }} href={`/api/export/${job.id}.xlsx`} download>
                  .xlsx
                </a>
                <a className="btn btn-secondary" style={{ height: '28px', fontSize: 'var(--fs-xs)', lineHeight: '28px', padding: '0 10px' }} href={`/api/export/${job.id}.csv`} download>
                  .csv
                </a>
              </>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            style={{ height: '28px', fontSize: 'var(--fs-xs)', padding: '0 10px' }}
            onClick={() => navigate(`${job.type === 'reel' ? '/reels' : '/profiles'}?job=${job.id}`)}
          >
            Resume →
          </button>
        )}
      </td>
    </tr>
  );
}

function ReportsTable({ jobs, campaigns, navigate, onReassign }) {
  return (
    <div className="rl-table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>File Name</th>
            <th className="numeric">Links</th>
            <th>Status</th>
            <th>Time taken</th>
            <th>Date</th>
            <th>Campaign</th>
            <th style={{ textAlign: 'right' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <ReportRow key={j.id} job={j} navigate={navigate} campaigns={campaigns} onReassign={onReassign} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CampaignCard({ campaign, jobs, campaigns, navigate, onReassign, expanded, onToggle, onDelete }) {
  return (
    <div className="card" style={{ marginBottom: 'var(--s4)', padding: 0, overflow: 'hidden' }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--s4) var(--s5)', cursor: 'pointer', borderLeft: '3px solid var(--accent)' }}
      >
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-md)' }}>{campaign.name}</div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
            {campaign.reportCount} {campaign.reportCount === 1 ? 'report' : 'reports'}
            {campaign.earliestAt ? ` · ${formatDateRange(campaign.earliestAt, campaign.latestAt)}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s5)' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>{formatViews(campaign.totalViews)}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Views</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--ok)' }}>{campaign.avgEr != null ? `${campaign.avgEr}%` : '-'}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Avg ER</div>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(campaign); }}
            title="Delete this campaign (reports stay, just uncategorized)"
            style={{
              width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: '50%',
              color: 'var(--text-2)', cursor: 'pointer', fontSize: '15px', lineHeight: 1, transition: 'background var(--t-fast), color var(--t-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--err-soft)'; e.currentTarget.style.color = 'var(--err)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-2)'; }}
          >
            ×
          </button>
          <span
            style={{
              width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: '50%',
              color: 'var(--text-2)', fontSize: '13px',
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms',
            }}
          >
            ▾
          </span>
        </div>
      </div>
      {expanded && (
        jobs.length === 0 ? (
          <div style={{ padding: 'var(--s4) var(--s5)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', borderTop: '1px solid var(--border)' }}>
            No reports match the current filter.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
            <ReportsTable jobs={jobs} campaigns={campaigns} navigate={navigate} onReassign={onReassign} />
          </div>
        )
      )}
    </div>
  );
}

// Side-by-side campaign comparison. Uses the rollups the campaigns list
// already fetched -- no extra API call. Sorted best-to-worst by average
// engagement rate, since that reflects quality rather than just scale.
function CampaignCompareTable({ campaigns }) {
  const withEr = campaigns.filter((c) => c.avgEr != null);
  const bestId = withEr.length >= 2
    ? withEr.reduce((best, c) => (c.avgEr > best.avgEr ? c : best)).id
    : null;

  const sorted = [...campaigns].sort((a, b) => {
    if (a.avgEr == null) return 1;
    if (b.avgEr == null) return -1;
    return b.avgEr - a.avgEr;
  });

  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Reports</th>
            <th>Links</th>
            <th>Success rate</th>
            <th>Total views</th>
            <th>Avg ER</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const successRate = c.totalLinks > 0 ? Math.round((c.successCount / c.totalLinks) * 100) : null;
            return (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>
                  {c.name}
                  {c.id === bestId && (
                    <span className="chip ok" style={{ marginLeft: 'var(--s2)', fontSize: '10px' }}>Top performer</span>
                  )}
                </td>
                <td className="numeric mono">{c.reportCount}</td>
                <td className="numeric mono">{c.totalLinks}</td>
                <td className="numeric mono">{successRate != null ? `${successRate}%` : '-'}</td>
                <td className="numeric mono">{formatViews(c.totalViews)}</td>
                <td className="numeric mono" style={{ color: 'var(--ok)', fontWeight: 600 }}>{c.avgEr != null ? `${c.avgEr}%` : '-'}</td>
                <td className="mono" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>{c.earliestAt ? formatDateRange(c.earliestAt, c.latestAt) : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function History() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [jobs, setJobs] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [uncategorizedRollup, setUncategorizedRollup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [groupByCampaign, setGroupByCampaign] = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState('all'); // all, 7d, 30d
  const [creatorSearch, setCreatorSearch] = useState('');
  // Set once from the very first (unfiltered) load and never touched again --
  // controls whether the filter bar shows at all. Using jobs.length instead
  // would hide the search box itself the moment a creator search matches
  // nothing, trapping the user with no way to clear it.
  const [hasAnyReports, setHasAnyReports] = useState(false);

  const load = useCallback((creator = '') => {
    const jobsQs = creator ? `?creator=${encodeURIComponent(creator)}` : '';
    Promise.all([apiFetch(`/jobs${jobsQs}`), apiFetch('/campaigns')])
      .then(([jobsRes, campaignsRes]) => {
        setJobs(jobsRes.jobs || []);
        setCampaigns(campaignsRes.campaigns || []);
        setUncategorizedRollup(campaignsRes.uncategorized || null);
        setExpandedIds(new Set((campaignsRes.campaigns || []).map((c) => c.id)));
        if (!creator) setHasAnyReports((jobsRes.jobs || []).length > 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Debounced: search by creator hits the server (it has to join against
  // every report's individual rows, not just job-level fields), so wait for
  // a pause in typing rather than firing a request per keystroke. Skips its
  // first run so it doesn't duplicate the immediate initial load() above.
  const creatorSearchMounted = useRef(false);
  useEffect(() => {
    if (!creatorSearchMounted.current) { creatorSearchMounted.current = true; return; }
    const handle = setTimeout(() => load(creatorSearch.trim()), 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorSearch]);

  const handleReassign = async (jobId, campaignId) => {
    try {
      await apiFetch(`/jobs/${jobId}/campaign`, { method: 'PATCH', body: JSON.stringify({ campaignId }) });
      addToast('Report moved', 'ok');
      load(creatorSearch.trim());
    } catch (err) {
      addToast(err.message || "Couldn't move that report, try again", 'err');
    }
  };

  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim()) return;
    setCreatingCampaign(true);
    try {
      await apiFetch('/campaigns', { method: 'POST', body: JSON.stringify({ name: newCampaignName.trim() }) });
      addToast('Campaign created', 'ok');
      setNewCampaignName('');
      setNewCampaignOpen(false);
      load(creatorSearch.trim());
    } catch (err) {
      addToast(err.message || "Couldn't create that campaign, try again", 'err');
    } finally {
      setCreatingCampaign(false);
    }
  };

  const handleDeleteCampaign = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/campaigns/${deleteTarget.id}`, { method: 'DELETE' });
      addToast('Campaign deleted, its reports are now uncategorized', 'ok');
      setDeleteTarget(null);
      load(creatorSearch.trim());
    } catch (err) {
      addToast(err.message || "Couldn't delete that campaign, try again", 'err');
    }
  };

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const dateFilteredJobs = dateFilter === 'all' ? jobs : jobs.filter((j) => {
    const days = dateFilter === '7d' ? 7 : 30;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return new Date(j.createdAt).getTime() >= cutoff;
  });
  const filteredJobs = typeFilter === 'all' ? dateFilteredJobs : dateFilteredJobs.filter((j) => j.type === typeFilter);
  const reelCount = dateFilteredJobs.filter((j) => j.type === 'reel').length;
  const profileCount = dateFilteredJobs.filter((j) => j.type === 'profile').length;

  const jobsByCampaignId = new Map();
  const uncategorizedJobs = [];
  for (const j of filteredJobs) {
    if (j.campaignId) {
      if (!jobsByCampaignId.has(j.campaignId)) jobsByCampaignId.set(j.campaignId, []);
      jobsByCampaignId.get(j.campaignId).push(j);
    } else {
      uncategorizedJobs.push(j);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s5)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Report History</h1>
        <div style={{ display: 'flex', gap: 'var(--s3)' }}>
          {campaigns.length >= 2 && (
            <button className="btn btn-secondary" onClick={() => setCompareOpen(true)}>Compare campaigns</button>
          )}
          <button className="btn btn-secondary" onClick={() => setNewCampaignOpen(true)}>+ New campaign</button>
        </div>
      </div>

      {!loading && hasAnyReports && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
          <button onClick={() => setTypeFilter('all')} className={`chip ${typeFilter === 'all' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>All ({dateFilteredJobs.length})</button>
          <button onClick={() => setTypeFilter('reel')} className={`chip ${typeFilter === 'reel' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Reel Reports ({reelCount})</button>
          <button onClick={() => setTypeFilter('profile')} className={`chip ${typeFilter === 'profile' ? 'ok' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Profile Reports ({profileCount})</button>
          <span className="rl-hide-mobile" style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--border)', margin: '0 2px' }} />
          <button onClick={() => setDateFilter('all')} className={`chip ${dateFilter === 'all' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>All time</button>
          <button onClick={() => setDateFilter('30d')} className={`chip ${dateFilter === '30d' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Last 30 days</button>
          <button onClick={() => setDateFilter('7d')} className={`chip ${dateFilter === '7d' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Last 7 days</button>
          <span className="rl-hide-mobile" style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--border)', margin: '0 2px' }} />
          <input
            type="text"
            className="input-field"
            placeholder="Search by creator username"
            value={creatorSearch}
            onChange={(e) => setCreatorSearch(e.target.value)}
            style={{ height: '32px', fontSize: 'var(--fs-sm)', width: '220px' }}
          />
          <label style={{ fontSize: 'var(--fs-xs)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={groupByCampaign} onChange={(e) => setGroupByCampaign(e.target.checked)} />
            Group by campaign
          </label>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Shimmer key={i} height="52px" borderRadius="10px" />
          ))}
        </div>
      ) : !hasAnyReports ? (
        <EmptyState
          icon="⏱️"
          title="No reports yet"
          description="Your finished and in-progress reports will live here across sessions."
          action={<button className="btn btn-primary" onClick={() => navigate('/reels')}>New reel report</button>}
        />
      ) : creatorSearch.trim() && jobs.length === 0 ? (
        <EmptyState
          icon="🔎"
          title="No reports match that creator"
          description={`Nothing found for "${creatorSearch.trim()}". Check the spelling or try a shorter search.`}
        />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          icon="⏱️"
          title="No reports of this type yet"
          description="Switch filters above, or start a new report."
        />
      ) : !groupByCampaign ? (
        <div className="data-table-container">
          <ReportsTable jobs={filteredJobs} campaigns={campaigns} navigate={navigate} onReassign={handleReassign} />
        </div>
      ) : (
        <div>
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              jobs={jobsByCampaignId.get(c.id) || []}
              campaigns={campaigns}
              navigate={navigate}
              onReassign={handleReassign}
              expanded={expandedIds.has(c.id)}
              onToggle={() => toggleExpanded(c.id)}
              onDelete={setDeleteTarget}
            />
          ))}

          {uncategorizedJobs.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: 'var(--s4) var(--s5)', borderLeft: '3px solid var(--border-strong)' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-md)' }}>No campaign</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
                  {uncategorizedJobs.length} {uncategorizedJobs.length === 1 ? 'report' : 'reports'} not yet assigned to a campaign
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
                <ReportsTable jobs={uncategorizedJobs} campaigns={campaigns} navigate={navigate} onReassign={handleReassign} />
              </div>
            </div>
          )}
        </div>
      )}

      <Modal isOpen={newCampaignOpen} onClose={() => setNewCampaignOpen(false)} title="New campaign" width="380px">
        <div className="input-group">
          <label className="input-label" htmlFor="campaign-name">Campaign name</label>
          <input
            id="campaign-name"
            type="text"
            className="input-field"
            style={{ width: '100%' }}
            value={newCampaignName}
            onChange={(e) => setNewCampaignName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateCampaign()}
            placeholder="e.g. Nike Summer Drop"
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: 'var(--s4)' }}>
          <button className="btn btn-secondary" onClick={() => setNewCampaignOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={creatingCampaign || !newCampaignName.trim()} onClick={handleCreateCampaign}>
            {creatingCampaign ? 'Creating...' : 'Create campaign'}
          </button>
        </div>
      </Modal>

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete this campaign?" width="380px">
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
          {deleteTarget && `"${deleteTarget.name}" will be removed. Its reports aren't deleted, they'll just show up under "No campaign" again.`}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleDeleteCampaign}>Delete campaign</button>
        </div>
      </Modal>

      <Modal isOpen={compareOpen} onClose={() => setCompareOpen(false)} title="Compare campaigns" width="720px">
        <p style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s3)' }}>
          Every campaign side by side, ranked by average engagement rate.
        </p>
        <CampaignCompareTable campaigns={campaigns} />
      </Modal>
    </div>
  );
}
