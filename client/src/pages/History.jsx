import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { formatDate } from '../utils/date';
import {
  PlusIcon, ChartIcon, FileIcon, ReelIcon, ProfileIcon, SearchIcon, ChevronDownIcon,
  TrashIcon, GlobeIcon, DownloadIcon,
} from '../components/Icon';
import { CampaignAvatar, CampaignAvatarPicker } from '../components/CampaignAvatar';
import { Tooltip } from '../components/Tooltip';
import { PortalDialog } from '../components/PortalDialog';
import { UpgradeDialog, PREMIUM_FEATURES } from '../components/Premium';
import { RowMenu } from '../components/RowMenu';
import { DataTable } from '../components/DataTable';

// chip: matches the same semantic language as everywhere else in the app --
// green = done, amber = not started, and running/paused share one "in
// progress" blue-ish tone (--info) since both mean "not finished yet,"
// distinguished from each other by their label text, not their color.
const STATUS_LABELS = {
  preview: { label: 'Not started', chip: 'warn' },
  running: { label: 'Running', chip: 'info' },
  paused: { label: 'Paused', chip: 'info' },
  done: { label: 'Complete', chip: 'ok' },
};

function formatDuration(startedAt, finishedAt) {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const totalSec = Math.max(0, Math.floor((end - start) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatDateRange(earliestAt, latestAt) {
  if (!earliestAt) return '';
  const fmt = (d) => formatDate(d);
  if (!latestAt || fmt(earliestAt) === fmt(latestAt)) return fmt(earliestAt);
  return `${fmt(earliestAt)} - ${fmt(latestAt)}`;
}

function formatViews(n) {
  if (n == null) return '-';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function timeOf(d) {
  try { return new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
}

// Pasted lists are all called "pasted-links.txt", which makes forty of them
// impossible to tell apart. A plain name reads better, and a name the person
// typed on the upload screen is shown as typed.
const displayName = (job) => (!job.fileName || job.fileName === 'pasted-links.txt' ? 'Pasted links' : job.fileName);

const reportPath = (job) => `${job.type === 'reel' ? '/reels' : '/profiles'}?job=${job.id}`;

function exportItems(job, navigate) {
  return [
    { label: 'Download Excel (.xlsx)', icon: DownloadIcon, href: `/api/export/${job.id}.xlsx`, download: true },
    { label: 'Download CSV', icon: DownloadIcon, href: `/api/export/${job.id}.csv`, download: true },
    { label: 'Branded report', icon: FileIcon, onClick: () => navigate(`/reports/${job.id}/branded`), divider: true },
  ];
}

// One row's actions. The primary button and the menu slot are always the same
// width, so the buttons line up down the whole column.
function ReportActions({ job, navigate }) {
  const isDone = job.status === 'done';
  const canExport = isDone && (job.counts?.success || 0) > 0;
  return (
    <div className="rl-actions">
      <button type="button" className="btn btn-secondary rl-actions-primary" onClick={() => navigate(reportPath(job))}>
        {isDone ? 'View' : 'Resume'}
      </button>
      <span className="rl-actions-slot">
        {canExport && <RowMenu items={exportItems(job, navigate)} />}
      </span>
    </div>
  );
}

function reportColumns({ campaigns, onReassign, navigate }) {
  const campaignName = new Map(campaigns.map((c) => [c.id, c.name]));
  const campaignOptions = [{ value: '', label: 'No campaign' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))];
  const nameOf = (j) => campaignName.get(j.campaignId) || 'No campaign';
  return [
    {
      key: 'name', label: 'Report', type: 'text', accessor: (j) => displayName(j),
      render: (j) => (
        <Tooltip content={j.fileName || displayName(j)}>
          <div className="rl-cell-title">{displayName(j)}</div>
        </Tooltip>
      ),
    },
    {
      key: 'type', label: 'Type', type: 'select', accessor: (j) => j.type,
      optionLabel: (v) => (v === 'reel' ? 'Reel' : 'Profile'),
      render: (j) => <span className={`chip ${j.type === 'reel' ? 'accent' : 'ok'}`} style={{ textTransform: 'uppercase' }}>{j.type}</span>,
    },
    { key: 'links', label: 'Links', type: 'number', align: 'right', mono: true, accessor: (j) => j.counts?.total || 0 },
    {
      key: 'status', label: 'Status', type: 'select', accessor: (j) => (STATUS_LABELS[j.status] || { label: j.status }).label,
      render: (j) => {
        const info = STATUS_LABELS[j.status] || { label: j.status, chip: '' };
        const took = j.status === 'done' ? formatDuration(j.startedAt, j.finishedAt) : null;
        return (
          <div>
            <span className={`chip ${info.chip}`}>{info.label}</span>
            {took && <div className="rl-cell-sub">Took {took}</div>}
          </div>
        );
      },
    },
    {
      key: 'created', label: 'Created', type: 'date', accessor: (j) => j.createdAt,
      render: (j) => (
        <div>
          <div style={{ fontSize: 'var(--fs-sm)' }}>{formatDate(j.createdAt)}</div>
          <div className="rl-cell-sub">{timeOf(j.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'campaign', label: 'Campaign', type: 'select', accessor: nameOf,
      render: (j) => (
        <Select value={j.campaignId || ''} onChange={(v) => onReassign(j.id, v || null)} options={campaignOptions} style={{ minWidth: '150px', maxWidth: '190px' }} />
      ),
    },
    {
      key: 'actions', label: '', type: 'none', sortable: false, filterable: false, align: 'right', width: '132px',
      accessor: () => '', render: (j) => <ReportActions job={j} navigate={navigate} />,
    },
  ];
}

/*
  Mobile equivalent of a table row: the same fields as a stacked card. A
  seven-column table has no honest way to fit a phone.
*/
function ReportCardMobile({ job, campaigns, onReassign, navigate, selectable, selected, onToggleSelect }) {
  const statusInfo = STATUS_LABELS[job.status] || { label: job.status, chip: '' };
  const isDone = job.status === 'done';
  const campaignOptions = [{ value: '', label: 'No campaign' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))];
  const took = isDone ? formatDuration(job.startedAt, job.finishedAt) : null;

  return (
    <div className="card" style={{ padding: 'var(--s3) var(--s4)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s2)' }}>
        {selectable && (
          <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Select ${displayName(job)}`} style={{ marginTop: '3px', flexShrink: 0 }} />
        )}
        <div style={{
          width: '32px', height: '32px', borderRadius: 'var(--r-md)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: job.type === 'reel' ? 'var(--accent-soft)' : 'var(--ok-soft)',
          color: job.type === 'reel' ? 'var(--accent)' : 'var(--ok)',
        }}>
          {job.type === 'reel' ? <ReelIcon size={15} /> : <ProfileIcon size={15} />}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(job)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
            <span className={`chip ${statusInfo.chip}`} style={{ fontSize: '10px' }}>{statusInfo.label}</span>
            <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>{job.counts?.total || 0} links</span>
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: '4px' }}>
            {formatDate(job.createdAt)}, {timeOf(job.createdAt)}{took ? ` · took ${took}` : ''}
          </div>
        </div>
        {isDone && (job.counts?.success || 0) > 0 && <RowMenu items={exportItems(job, navigate)} />}
      </div>

      <div style={{ marginTop: 'var(--s3)' }}>
        <Select value={job.campaignId || ''} onChange={(v) => onReassign(job.id, v || null)} options={campaignOptions} style={{ width: '100%' }} />
      </div>

      <button type="button" className="btn btn-secondary" style={{ width: '100%', height: '36px', fontSize: 'var(--fs-sm)', marginTop: 'var(--s3)' }} onClick={() => navigate(reportPath(job))}>
        {isDone ? 'View report →' : 'Resume report →'}
      </button>
    </div>
  );
}

// Every list of reports on this page is this one component, so they all
// behave the same: sortable and filterable headings, the shared page sizes,
// cards on a phone.
function ReportsList({ id, jobs, campaigns, navigate, onReassign, selection, loading = false, tourId, emptyTitle }) {
  const columns = useMemo(() => reportColumns({ campaigns, onReassign, navigate }), [campaigns, onReassign, navigate]);
  return (
    <DataTable
      id={id}
      tourId={tourId}
      columns={columns}
      rows={jobs}
      getRowId={(j) => j.id}
      selection={selection}
      defaultSort={{ key: 'created', dir: 'desc' }}
      loading={loading}
      emptyTitle={emptyTitle || 'No reports here yet'}
      renderMobile={(j, { selected, onToggle }) => (
        <ReportCardMobile job={j} campaigns={campaigns} onReassign={onReassign} navigate={navigate} selectable={!!selection} selected={selected} onToggleSelect={onToggle} />
      )}
    />
  );
}

// Compact icon-only button, findable by the tour on both the locked and
// unlocked render -- same "still visible, still clickable, wearing a
// lock" rule as LockedFeatureButton in Premium.jsx, just built here as its
// own small button since LockedFeatureButton's label+badge layout doesn't
// fit a 28px icon slot.
function PortalButton({ locked, onClick }) {
  return (
    <Tooltip content={locked ? 'Client portal, on Starter, Pro and Agency' : 'Client portal'}>
      <button
        type="button"
        data-tour="campaign-portal-button"
        onClick={onClick}
        aria-label="Client portal"
        style={{
          width: '28px', height: '28px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)',
          color: locked ? 'var(--text-3)' : 'var(--text-2)', cursor: 'pointer',
          transition: 'background var(--t-fast), border-color var(--t-fast)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
      >
        <GlobeIcon size={14} />
      </button>
    </Tooltip>
  );
}

function CampaignCard({ campaign, jobs, campaigns, navigate, onReassign, expanded, onToggle, onDelete, onAvatarChange, onOpenPortal, portalLocked }) {
  const [showUpgrade, setShowUpgrade] = useState(false);
  const openPortal = () => (portalLocked ? setShowUpgrade(true) : onOpenPortal(campaign));
  return (
    <>
    <UpgradeDialog isOpen={showUpgrade} onClose={() => setShowUpgrade(false)} feature={PREMIUM_FEATURES.clientPortal} />
    <div className="card" style={{ marginBottom: 'var(--s3)', padding: 0, overflow: 'hidden' }}>
      {/* Desktop: one clickable row, everything (avatar, stats, delete,
          expand chevron) inline -- unchanged from before this redesign. */}
      <div
        onClick={onToggle}
        className="rl-hide-mobile"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', rowGap: 'var(--s3)', padding: 'var(--s3) var(--s4)', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0, flex: '1 1 160px' }}>
          {/* stopPropagation -- the picker's own click (open file dialog)
              must not also fire the row's onToggle underneath it. */}
          <span onClick={(e) => e.stopPropagation()}>
            <CampaignAvatarPicker name={campaign.name} avatarUrl={campaign.avatarUrl} onChange={(url) => onAvatarChange(campaign.id, url)} size={36} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-md)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{campaign.name}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
              {campaign.reportCount} {campaign.reportCount === 1 ? 'report' : 'reports'}
              {campaign.earliestAt ? ` · ${formatDateRange(campaign.earliestAt, campaign.latestAt)}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s5)', flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>{formatViews(campaign.totalViews)}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Views</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--ok)' }}>{campaign.avgEr != null ? `${campaign.avgEr}%` : '-'}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Avg ER</div>
          </div>
          {/* Portal, then delete -- the one non-destructive action sits
              before the destructive one, same left-to-right severity order
              the row-menu's ⋮ list already uses everywhere else. */}
          <span onClick={(e) => e.stopPropagation()}>
            <PortalButton locked={portalLocked} onClick={(e) => { e.stopPropagation(); openPortal(); }} />
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(campaign); }}
            aria-label={`Delete ${campaign.name}`}
            style={{
              width: '28px', height: '28px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)',
              color: 'var(--text-2)', cursor: 'pointer', transition: 'background var(--t-fast), color var(--t-fast), border-color var(--t-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--err-soft)'; e.currentTarget.style.color = 'var(--err)'; e.currentTarget.style.borderColor = 'var(--err)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-2)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
          >
            <TrashIcon size={14} />
          </button>
          <span
            style={{
              width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: '50%',
              color: 'var(--text-2)',
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 150ms',
            }}
          >
            <ChevronDownIcon size={14} />
          </span>
        </div>
      </div>

      {/* Mobile: identity + one kebab menu on top, stats on their own row,
          one obvious primary action ("View reports") at the bottom -- the
          desktop row above crams avatar/name/stats/delete/chevron into one
          line, which is exactly the "too much info in one row" this
          composition avoids. Same campaign object, same handlers. */}
      <div className="rl-mobile-only" style={{ flexDirection: 'column', padding: 'var(--s3) var(--s4)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--s2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0, flex: 1 }}>
            <CampaignAvatarPicker name={campaign.name} avatarUrl={campaign.avatarUrl} onChange={(url) => onAvatarChange(campaign.id, url)} size={36} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{campaign.name}</div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
                {campaign.reportCount} {campaign.reportCount === 1 ? 'report' : 'reports'}
                {campaign.earliestAt ? ` · ${formatDateRange(campaign.earliestAt, campaign.latestAt)}` : ''}
              </div>
            </div>
          </div>
          <RowMenu items={[
            { label: 'Client portal', onClick: openPortal },
            { label: 'Delete campaign', onClick: () => onDelete(campaign), danger: true, divider: true },
          ]} />
        </div>

        <div style={{ display: 'flex', gap: 'var(--s5)', marginTop: 'var(--s3)' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: '18px', fontWeight: 700 }}>{formatViews(campaign.totalViews)}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Views</div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: '18px', fontWeight: 700, color: 'var(--ok)' }}>{campaign.avgEr != null ? `${campaign.avgEr}%` : '-'}</div>
            <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Avg ER</div>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggle}
          className="btn btn-secondary"
          style={{ width: '100%', height: '36px', fontSize: 'var(--fs-sm)', marginTop: 'var(--s3)' }}
        >
          {expanded ? 'Hide reports' : 'View reports'} {expanded ? '' : '→'}
        </button>
      </div>

      {expanded && (
        jobs.length === 0 ? (
          <div style={{ padding: 'var(--s4) var(--s5)', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', borderTop: '1px solid var(--border)' }}>
            No reports match the current filter.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
            <ReportsList id="history-campaign" jobs={jobs} campaigns={campaigns} navigate={navigate} onReassign={onReassign} />
          </div>
        )
      )}
    </div>
    </>
  );
}

function CompareCard({ c, bestId }) {
  const successRate = c.totalLinks > 0 ? Math.round((c.successCount / c.totalLinks) * 100) : null;
  return (
    <div className="card" style={{ padding: 'var(--s3) var(--s4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: 'var(--s3)' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px' }}>{c.name}</span>
        {c.id === bestId && <span className="chip ok" style={{ fontSize: '10px' }}>Top performer</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--s3)' }}>
        <div>
          <div className="mono" style={{ fontSize: '13px', fontWeight: 700 }}>{c.reportCount}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Reports</div>
        </div>
        <div>
          <div className="mono" style={{ fontSize: '13px', fontWeight: 700 }}>{c.totalLinks}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Links</div>
        </div>
        <div>
          <div className="mono" style={{ fontSize: '13px', fontWeight: 700 }}>{successRate != null ? `${successRate}%` : '-'}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Success</div>
        </div>
        <div>
          <div className="mono" style={{ fontSize: '13px', fontWeight: 700 }}>{formatViews(c.totalViews)}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Views</div>
        </div>
        <div>
          <div className="mono" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ok)' }}>{c.avgEr != null ? `${c.avgEr}%` : '-'}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Avg ER</div>
        </div>
        <div>
          <div className="mono" style={{ fontSize: '11px', color: 'var(--text-3)' }}>{c.earliestAt ? formatDateRange(c.earliestAt, c.latestAt) : '-'}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase' }}>Active</div>
        </div>
      </div>
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

  const rate = (c) => (c.totalLinks > 0 ? Math.round((c.successCount / c.totalLinks) * 100) : null);
  const columns = [
    { key: 'name', label: 'Campaign', type: 'text', accessor: (c) => c.name, render: (c) => (
      <span style={{ fontWeight: 600 }}>
        {c.name}
        {c.id === bestId && <span className="chip ok" style={{ marginLeft: 'var(--s2)', fontSize: '10px' }}>Top performer</span>}
      </span>
    ) },
    { key: 'reportCount', label: 'Reports', type: 'number', align: 'right', mono: true, accessor: (c) => c.reportCount },
    { key: 'totalLinks', label: 'Links', type: 'number', align: 'right', mono: true, accessor: (c) => c.totalLinks },
    { key: 'rate', label: 'Success rate', type: 'number', align: 'right', mono: true, accessor: rate, render: (c) => (rate(c) != null ? rate(c) + '%' : '-') },
    { key: 'totalViews', label: 'Total views', type: 'number', align: 'right', mono: true, accessor: (c) => c.totalViews, render: (c) => formatViews(c.totalViews) },
    { key: 'avgEr', label: 'Avg ER', type: 'number', align: 'right', mono: true, accessor: (c) => c.avgEr, render: (c) => (c.avgEr != null ? <span style={{ color: 'var(--ok)', fontWeight: 600 }}>{c.avgEr}%</span> : '-') },
    { key: 'active', label: 'Active', type: 'date', accessor: (c) => c.latestAt, render: (c) => (c.earliestAt ? <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>{formatDateRange(c.earliestAt, c.latestAt)}</span> : '-') },
  ];

  return (
    <DataTable
      id="history-compare"
      columns={columns}
      rows={sorted}
      getRowId={(c) => c.id}
      defaultSort={{ key: 'avgEr', dir: 'desc' }}
      emptyTitle="No campaigns to compare"
      renderMobile={(c) => <CompareCard c={c} bestId={bestId} />}
    />
  );
}


export function History() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const [portalTarget, setPortalTarget] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [groupByCampaign, setGroupByCampaign] = useState(true);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newCampaignAvatarUrl, setNewCampaignAvatarUrl] = useState(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  // Filters the already-loaded jobs by name, entirely in the browser -- no
  // request, so no flash of the loading skeleton while typing. Everything
  // else (type, status, date, campaign, links) is filtered from the column
  // headings of each table, exactly like the Creator database.
  const [fileSearch, setFileSearch] = useState('');
  const [selectedUnassignedIds, setSelectedUnassignedIds] = useState(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);
  // Campaigns lead with the two most recently active ones; "View all" swaps to
  // the full list from the same array, so nothing here is a new fetch.
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const RECENT_CAMPAIGNS_COUNT = 2;
  // Set once from the very first load and never touched again -- controls
  // whether the toolbar shows at all. Using jobs.length instead would hide the
  // search box the moment a search matched nothing, trapping the user.
  const [hasAnyReports, setHasAnyReports] = useState(false);

  // Older pages stream in behind the first one rather than the page waiting
  // on the full set. Tracked so the run can be abandoned when the page
  // unmounts mid-stream, otherwise a stale fetch would append over new results.
  const [loadingMore, setLoadingMore] = useState(false);
  const loadRunId = useRef(0);

  const PAGE_SIZE = 100;
  const queryClient = useQueryClient();

  const qs = useCallback((page) => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    return `/jobs?${params.toString()}`;
  }, []);

  // Only page 1 (+ campaigns) is cached here, same reasoning as Creators.jsx:
  // "History -> Creators -> History" renders the first screen instantly instead
  // of a blank skeleton every visit. Pages 2+ still stream in fresh below.
  const firstPageQuery = useQuery({
    queryKey: ['history-first-page'],
    queryFn: () => Promise.all([apiFetch(qs(1)), apiFetch('/campaigns')])
      .then(([jobsRes, campaignsRes]) => ({ jobsRes, campaignsRes })),
  });

  useEffect(() => {
    if (firstPageQuery.error) { setLoading(false); return undefined; }
    if (!firstPageQuery.data) { setLoading(true); return undefined; }

    const runId = ++loadRunId.current;
    const { jobsRes, campaignsRes } = firstPageQuery.data;
    const firstPage = jobsRes.jobs || [];
    setJobs(firstPage);
    setCampaigns(campaignsRes.campaigns || []);
    setHasAnyReports(firstPage.length > 0);
    setLoading(false);

    // Page one is on screen and interactive at this point; the rest arrives
    // underneath it without another spinner.
    if (jobsRes.hasMore) {
      setLoadingMore(true);
      const drain = async () => {
        let page = 2;
        let more = true;
        while (more && runId === loadRunId.current) {
          try {
            const res = await apiFetch(qs(page));
            if (runId !== loadRunId.current) return;
            const batch = res.jobs || [];
            if (batch.length) {
              // Guard against duplicates: a report created while paging shifts
              // everything down a slot, which would re-append rows on screen.
              setJobs((prev) => {
                const seen = new Set(prev.map((j) => j.id));
                return [...prev, ...batch.filter((j) => !seen.has(j.id))];
              });
            }
            more = !!res.hasMore;
            page += 1;
          } catch {
            more = false;
          }
        }
        if (runId === loadRunId.current) setLoadingMore(false);
      };
      drain();
    }
    return () => { loadRunId.current += 1; };
  }, [firstPageQuery.data, firstPageQuery.error, qs]);

  // The "genuinely fresh reload" path (create/delete campaign, bulk assign).
  // Keeps the current page on screen and refetches underneath it.
  const reload = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['history-first-page'] });
  }, [queryClient]);

  /*
    Moving a report between campaigns needs two things updated: that one row
    (we already know the new value, no round trip) and the campaign rollups
    (report count, views, avg ER) shown on the cards, which are computed
    server-side. So: move the row instantly, refresh only the rollups quietly
    in the background. No skeleton, no full reload.
  */
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const handleReassign = useCallback(async (jobId, campaignId) => {
    const job = jobsRef.current.find((j) => j.id === jobId);
    const prevCampaignId = job ? (job.campaignId || null) : null;
    if (prevCampaignId === campaignId) return;
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, campaignId } : j)));

    try {
      await apiFetch(`/jobs/${jobId}/campaign`, { method: 'PATCH', body: JSON.stringify({ campaignId }) });
      addToast('Report moved', 'ok');
      apiFetch('/campaigns').then((res) => setCampaigns(res.campaigns || [])).catch(() => {});
    } catch (err) {
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, campaignId: prevCampaignId } : j)));
      addToast(err.message || "Couldn't move that report, try again", 'err');
    }
  }, [addToast]);

  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim()) return;
    setCreatingCampaign(true);
    try {
      await apiFetch('/campaigns', { method: 'POST', body: JSON.stringify({ name: newCampaignName.trim(), avatarUrl: newCampaignAvatarUrl }) });
      addToast('Campaign created', 'ok');
      setNewCampaignName('');
      setNewCampaignAvatarUrl(null);
      setNewCampaignOpen(false);
      reload();
    } catch (err) {
      addToast(err.message || "Couldn't create that campaign, try again", 'err');
    } finally {
      setCreatingCampaign(false);
    }
  };

  // Existing campaign's avatar, changed in place: optimistic, PATCH in the
  // background, rolled back on failure.
  const handleAvatarChange = async (campaignId, avatarUrl) => {
    const prev = campaigns.find((c) => c.id === campaignId);
    const prevAvatarUrl = prev ? prev.avatarUrl : null;
    setCampaigns((list) => list.map((c) => (c.id === campaignId ? { ...c, avatarUrl } : c)));
    try {
      await apiFetch(`/campaigns/${campaignId}`, { method: 'PATCH', body: JSON.stringify({ avatarUrl }) });
    } catch (err) {
      setCampaigns((list) => list.map((c) => (c.id === campaignId ? { ...c, avatarUrl: prevAvatarUrl } : c)));
      addToast(err.message || "Couldn't update the avatar, try again", 'err');
    }
  };

  const toggleUnassignedSelect = useCallback((jobId) => {
    setSelectedUnassignedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  }, []);

  const toggleUnassignedSelectAll = useCallback((visibleJobs) => {
    setSelectedUnassignedIds((prev) => {
      const allSelected = visibleJobs.length > 0 && visibleJobs.every((j) => prev.has(j.id));
      const next = new Set(prev);
      for (const j of visibleJobs) { if (allSelected) next.delete(j.id); else next.add(j.id); }
      return next;
    });
  }, []);

  // Loops the same single-report PATCH over every selected id. Reports that
  // fail stay selected so it is obvious which still need attention.
  const handleBulkAssign = async (campaignId) => {
    const ids = Array.from(selectedUnassignedIds);
    if (ids.length === 0 || !campaignId) return;
    setBulkAssigning(true);
    const failed = [];
    for (const id of ids) {
      try {
        await apiFetch(`/jobs/${id}/campaign`, { method: 'PATCH', body: JSON.stringify({ campaignId }) });
      } catch {
        failed.push(id);
      }
    }
    setBulkAssigning(false);
    if (failed.length === 0) {
      addToast(`${ids.length} report${ids.length === 1 ? '' : 's'} assigned`, 'ok');
    } else {
      addToast(`${ids.length - failed.length} assigned, ${failed.length} failed. Try those again.`, 'err');
    }
    setSelectedUnassignedIds(new Set(failed));
    reload();
  };

  const handleDeleteCampaign = async () => {
    if (!deleteTarget) return;
    try {
      await apiFetch(`/campaigns/${deleteTarget.id}`, { method: 'DELETE' });
      addToast('Campaign deleted, its reports are now uncategorized', 'ok');
      setDeleteTarget(null);
      reload();
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

  const needle = fileSearch.trim().toLowerCase();
  const searchedJobs = useMemo(
    () => (needle ? jobs.filter((j) => `${j.fileName || ''} ${displayName(j)}`.toLowerCase().includes(needle)) : jobs),
    [jobs, needle],
  );

  const jobsByCampaignId = new Map();
  const uncategorizedJobs = [];
  for (const j of searchedJobs) {
    if (j.campaignId) {
      if (!jobsByCampaignId.has(j.campaignId)) jobsByCampaignId.set(j.campaignId, []);
      jobsByCampaignId.get(j.campaignId).push(j);
    } else {
      uncategorizedJobs.push(j);
    }
  }

  const campaignsByRecency = [...campaigns].sort((a, b) => {
    const at = a.latestAt ? new Date(a.latestAt).getTime() : 0;
    const bt = b.latestAt ? new Date(b.latestAt).getTime() : 0;
    return bt - at;
  });
  const visibleCampaigns = showAllCampaigns ? campaignsByRecency : campaignsByRecency.slice(0, RECENT_CAMPAIGNS_COUNT);

  // One quiet line instead of five stat tiles. The status counts are still in
  // the Status column filter, so nothing was lost.
  const doneCount = jobs.filter((j) => j.status === 'done').length;
  const pausedCount = jobs.filter((j) => j.status === 'paused').length;
  const summary = jobs.length === 0
    ? 'All your past imports and reports.'
    : `${jobs.length} ${jobs.length === 1 ? 'report' : 'reports'} · ${doneCount} complete${pausedCount ? ` · ${pausedCount} paused` : ''}`;

  const unassignedSelection = { ids: selectedUnassignedIds, onToggle: toggleUnassignedSelect, onToggleAll: toggleUnassignedSelectAll };

  return (
    <div>
      <div className="rl-page-head">
        <div>
          <h1 className="rl-history-heading">History</h1>
          <p>{summary}</p>
        </div>
        <div className="rl-page-head-actions rl-history-header-actions">
          {campaigns.length >= 2 && (
            <button className="btn btn-secondary" onClick={() => setCompareOpen(true)} style={{ gap: 'var(--s2)' }}>
              <ChartIcon size={15} />Compare campaigns
            </button>
          )}
          <button data-tour="new-campaign-btn" className="btn btn-primary" onClick={() => setNewCampaignOpen(true)} style={{ gap: 'var(--s2)' }}>
            <PlusIcon size={15} />New campaign
          </button>
        </div>
      </div>

      {!loading && hasAnyReports && (
        <div className="rl-toolbar">
          <div className="rl-tabs" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={!groupByCampaign} className={`rl-tab${!groupByCampaign ? ' on' : ''}`} onClick={() => setGroupByCampaign(false)}>
              All reports <span className="rl-tab-count">{jobs.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={groupByCampaign} className={`rl-tab${groupByCampaign ? ' on' : ''}`} onClick={() => setGroupByCampaign(true)}>
              By campaign <span className="rl-tab-count">{campaigns.length}</span>
            </button>
          </div>
          <label className="rl-search">
            <SearchIcon size={14} />
            <input type="text" className="input-field" placeholder="Search reports" aria-label="Search reports" value={fileSearch} onChange={(e) => setFileSearch(e.target.value)} />
          </label>
        </div>
      )}

      {/* Quiet, non-blocking: the list is already usable, this just explains
          why rows are still appearing underneath. */}
      {!loading && loadingMore && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s3)' }}>
          <span
            aria-hidden="true"
            style={{
              width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0,
              border: '2px solid color-mix(in srgb, var(--accent) 25%, transparent)',
              borderTopColor: 'var(--accent)',
              animation: 'rl-loader-spin 900ms linear infinite',
            }}
          />
          Loading older reports...
        </div>
      )}

      {loading ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <ReportsList id="history-reports" jobs={[]} campaigns={[]} navigate={navigate} onReassign={() => {}} loading />
        </div>
      ) : !hasAnyReports ? (
        <EmptyState
          title="No reports yet"
          description="Your finished and in-progress reports will live here across sessions."
          action={<button className="btn btn-primary" onClick={() => navigate('/reels')}>New reel report</button>}
        />
      ) : needle && searchedJobs.length === 0 ? (
        <EmptyState
          title="No reports match that search"
          description={`Nothing found for "${fileSearch.trim()}". Check the spelling or try a shorter search.`}
        />
      ) : !groupByCampaign ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <ReportsList id="history-reports" tourId="history-table" jobs={searchedJobs} campaigns={campaigns} navigate={navigate} onReassign={handleReassign} />
        </div>
      ) : (
        <div>
          {campaigns.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s3)' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>
                {showAllCampaigns ? 'All campaigns' : 'Recent campaigns'}
              </h2>
              {campaigns.length > RECENT_CAMPAIGNS_COUNT && (
                <button type="button" onClick={() => setShowAllCampaigns((v) => !v)} className="rl-text-link" style={{ fontSize: 'var(--fs-sm)' }}>
                  {showAllCampaigns ? 'Show recent only' : `View all (${campaigns.length})`}
                </button>
              )}
            </div>
          )}
          {visibleCampaigns.map((c) => (
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
              onAvatarChange={handleAvatarChange}
              onOpenPortal={setPortalTarget}
              portalLocked={!user?.features?.clientPortal}
            />
          ))}

          {uncategorizedJobs.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: campaigns.length > 0 ? 'var(--s5)' : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', rowGap: 'var(--s3)', padding: 'var(--s4) var(--s4) var(--s3)' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-md)' }}>
                    Not in a campaign <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>· {uncategorizedJobs.length}</span>
                  </div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
                    Tick some reports to move them into a campaign together.
                  </div>
                </div>
                {/* Same PATCH every per-row dropdown already calls, just
                    looped over the checked rows. Only appears once something
                    is selected. */}
                {selectedUnassignedIds.size > 0 && (
                  <div className="rl-history-bulk-bar" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{selectedUnassignedIds.size} selected</span>
                    <Select
                      value=""
                      onChange={handleBulkAssign}
                      options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
                      placeholder={bulkAssigning ? 'Assigning...' : 'Move to campaign'}
                      style={{ minWidth: '180px' }}
                    />
                  </div>
                )}
              </div>
              <ReportsList id="history-unassigned" tourId="history-table" jobs={uncategorizedJobs} campaigns={campaigns} navigate={navigate} onReassign={handleReassign} selection={unassignedSelection} />
            </div>
          )}
        </div>
      )}

      <Modal
        isOpen={newCampaignOpen}
        onClose={() => { setNewCampaignOpen(false); setNewCampaignAvatarUrl(null); }}
        title="New campaign"
        width="380px"
      >
        {/* Click the circle to upload, Instagram-style; falls back to the
            initials + color it'll render with anywhere in the app until an
            image is set. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
          <CampaignAvatarPicker name={newCampaignName || '?'} avatarUrl={newCampaignAvatarUrl} onChange={setNewCampaignAvatarUrl} size={48} />
          <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
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
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: 'var(--s4)' }}>
          <button className="btn btn-secondary" onClick={() => { setNewCampaignOpen(false); setNewCampaignAvatarUrl(null); }}>Cancel</button>
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

      {portalTarget && (
        <PortalDialog
          isOpen={!!portalTarget}
          onClose={() => setPortalTarget(null)}
          campaignId={portalTarget.id}
          campaignName={portalTarget.name}
        />
      )}
    </div>
  );
}

