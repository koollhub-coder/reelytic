import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { BrandLoader } from '../components/BrandLoader';
import { Modal } from '../components/Modal';
import { Select } from '../components/Select';
import { useToast } from '../context/ToastContext';
import { formatDate, formatDateTime, formatDayKey } from '../utils/date';
import { TableSkeleton } from '../components/TableSkeleton';
import {
  PlusIcon, ChartIcon, FileIcon, ReelIcon, ProfileIcon, SuccessIcon, ClockIcon,
  SearchIcon, ChevronDownIcon, MoreIcon, TrashIcon,
} from '../components/Icon';
import { CampaignAvatar, CampaignAvatarPicker } from '../components/CampaignAvatar';
import { Tooltip } from '../components/Tooltip';

// chip: matches the same semantic language as everywhere else in the app --
// green = done, amber = not started, and running/paused share one "in
// progress" blue-ish tone (--info) since both mean "not finished yet,"
// distinguished from each other by their label text, not their color.
const STATUS_LABELS = {
  preview: { label: 'Not started', chip: 'warn', filterGroup: 'not-started' },
  running: { label: 'Running', chip: 'info', filterGroup: 'in-progress' },
  paused: { label: 'Paused', chip: 'info', filterGroup: 'in-progress' },
  done: { label: 'Complete', chip: 'ok', filterGroup: 'done' },
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

// Generic "⋮" row-actions menu -- what actually killed the horizontal
// scroll: instead of every report row laying out 3-4 buttons side by side
// (View, .xlsx, .csv, Branded report), only View stays inline and everything
// else collapses into this. Click-outside/Escape handling mirrors the same
// pattern CampaignCombobox already uses.
function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const handleKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!items || items.length === 0) return null;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        style={{
          width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'none', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)',
          color: 'var(--text-2)', cursor: 'pointer',
        }}
      >
        <MoreIcon size={15} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, minWidth: '180px', zIndex: 150,
          backgroundColor: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)',
          boxShadow: 'var(--shadow-lg)', padding: '4px',
        }}>
          {items.map((item, i) => (
            item.href ? (
              <a
                key={i}
                href={item.href}
                download={item.download}
                onClick={() => setOpen(false)}
                style={{ display: 'block', padding: '8px 10px', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', color: 'var(--text)', textDecoration: 'none' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => { setOpen(false); item.onClick(); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-sm)', color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                {item.label}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  );
}

// Page numbers with a single "..." for gaps -- always shows first, last, and
// current +/-1, so a long list doesn't render 71 page buttons in a row.
function paginationRange(current, total) {
  const range = [];
  const add = (n) => { if (!range.includes(n)) range.push(n); };
  add(1);
  for (let n = current - 1; n <= current + 1; n++) { if (n > 1 && n < total) add(n); }
  add(total);
  const out = [];
  let prev = 0;
  for (const n of range.sort((a, b) => a - b)) {
    if (n - prev > 1) out.push('...');
    out.push(n);
    prev = n;
  }
  return out;
}

// Purely a display slice over data already loaded in memory -- load() below
// still fetches (and background-streams) the FULL matching set exactly as
// before; this only changes how many of those already-fetched rows render
// on screen at once, and where the reader can jump in that list.
function Pagination({ page, totalPages, pageSize, totalItems, onPageChange, onPageSizeChange }) {
  if (totalItems === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  return (
    <div className="rl-history-pagination" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)' }}>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>Showing {start}-{end} of {totalItems}</span>
      <div className="rl-history-pagination-controls" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
        <Select
          value={String(pageSize)}
          onChange={(v) => onPageSizeChange(Number(v))}
          options={[10, 25, 50].map((n) => ({ value: String(n), label: `${n} per page` }))}
          style={{ minWidth: '110px' }}
        />
        {totalPages > 1 && (
          <div className="rl-history-pagination-pages" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button type="button" className="btn btn-secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)} style={{ height: '28px', width: '28px', padding: 0, fontSize: 'var(--fs-sm)' }}>‹</button>
            {paginationRange(page, totalPages).map((p, i) => (
              p === '...'
                ? <span key={`gap-${i}`} style={{ padding: '0 4px', color: 'var(--text-3)' }}>...</span>
                : (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onPageChange(p)}
                    className={p === page ? 'btn btn-primary' : 'btn btn-secondary'}
                    style={{ height: '28px', minWidth: '28px', padding: '0 8px', fontSize: 'var(--fs-sm)' }}
                  >
                    {p}
                  </button>
                )
            ))}
            <button type="button" className="btn btn-secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} style={{ height: '28px', width: '28px', padding: 0, fontSize: 'var(--fs-sm)' }}>›</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Reports stay put on History instead of navigating away -- this page
// already shows everything meaningful about a finished report (status,
// counts, timing, downloads). The one exception is a report that hasn't
// finished yet: pausing, resuming, or starting it can only happen inside
// the report engine itself, so those get one clearly-labeled "Resume" link
// rather than making the whole row a hidden navigation trap.
function ReportRow({ job, campaigns, onReassign, navigate, selectable, selected, onToggleSelect }) {
  const statusInfo = STATUS_LABELS[job.status] || { label: job.status, chip: '' };
  const isDone = job.status === 'done';
  const campaignOptions = [{ value: '', label: 'No campaign' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))];

  return (
    <tr>
      {selectable && (
        <td style={{ width: '36px' }}>
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect(job.id)} aria-label={`Select ${job.fileName}`} />
        </td>
      )}
      {/* File name leads the row -- it's what a person is scanning for,
          same hierarchy the reference asked for: name -> status -> links ->
          time/date -> campaign -> actions. Filenames are arbitrary length
          and were wrapping to two lines, which set the height of every row;
          truncate with the full name on hover instead. */}
      <td style={{ fontWeight: 600, maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <Tooltip content={job.fileName}><span>{job.fileName}</span></Tooltip>
      </td>
      <td>
        <span className={`chip ${job.type === 'reel' ? 'accent' : 'ok'}`} style={{ textTransform: 'uppercase' }}>
          {job.type}
        </span>
      </td>
      <td className="numeric mono">{job.counts?.total || 0}</td>
      <td>
        <span className={`chip ${statusInfo.chip}`}>{statusInfo.label}</span>
      </td>
      <td className="mono" style={{ color: 'var(--text-3)' }}>{formatDuration(job.startedAt, job.finishedAt)}</td>
      <td className="mono" style={{ color: 'var(--text-3)' }}>
        {formatDateTime(job.createdAt)}
      </td>
      <td>
        <Select
          value={job.campaignId || ''}
          onChange={(v) => onReassign(job.id, v || null)}
          options={campaignOptions}
          style={{ minWidth: '100px', maxWidth: '120px' }}
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
            {/* Only View stays inline -- Excel/CSV/branded collapse into the
                menu instead of each getting their own button, which is what
                forced every row wider than the table before. */}
            {(job.counts?.success || 0) > 0 && (
              <RowMenu
                items={[
                  { label: 'Download Excel (.xlsx)', href: `/api/export/${job.id}.xlsx`, download: true },
                  { label: 'Download CSV', href: `/api/export/${job.id}.csv`, download: true },
                  { label: 'Branded report', onClick: () => navigate(`/reports/${job.id}/branded`) },
                ]}
              />
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

/*
  Mobile equivalent of ReportRow -- an 8-column table (checkbox, name, type,
  links, status, time, date, campaign, actions) has no honest way to fit a
  375px screen, and forcing it to meant either crushed columns or a
  horizontal-scroll table where the actions on the far right were the part
  most likely to need reaching. Stacked card, same fields, same handlers,
  hierarchy matching ReportRow's own comment: name -> status -> links ->
  time/date -> campaign -> actions.
*/
function ReportCardMobile({ job, campaigns, onReassign, navigate, selectable, selected, onToggleSelect }) {
  const statusInfo = STATUS_LABELS[job.status] || { label: job.status, chip: '' };
  const isDone = job.status === 'done';
  const campaignOptions = [{ value: '', label: 'No campaign' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))];

  return (
    <div className="card" style={{ padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s2)' }}>
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(job.id)}
            aria-label={`Select ${job.fileName}`}
            style={{ marginTop: '3px', flexShrink: 0 }}
          />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <Tooltip content={job.fileName}>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {job.fileName}
            </div>
          </Tooltip>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
            <span className={`chip ${job.type === 'reel' ? 'accent' : 'ok'}`} style={{ textTransform: 'uppercase', fontSize: '10px' }}>{job.type}</span>
            <span className={`chip ${statusInfo.chip}`} style={{ fontSize: '10px' }}>{statusInfo.label}</span>
            <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>{job.counts?.total || 0} links</span>
          </div>
          <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: '4px' }}>
            {formatDuration(job.startedAt, job.finishedAt)} &middot; {formatDateTime(job.createdAt)}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 'var(--s3)' }}>
        <Select
          value={job.campaignId || ''}
          onChange={(v) => onReassign(job.id, v || null)}
          options={campaignOptions}
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: 'var(--s3)' }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ flex: 1, height: '36px', fontSize: 'var(--fs-sm)' }}
          onClick={() => navigate(`${job.type === 'reel' ? '/reels' : '/profiles'}?job=${job.id}`)}
        >
          {isDone ? 'View' : 'Resume →'}
        </button>
        {isDone && (job.counts?.success || 0) > 0 && (
          <RowMenu
            items={[
              { label: 'Download Excel (.xlsx)', href: `/api/export/${job.id}.xlsx`, download: true },
              { label: 'Download CSV', href: `/api/export/${job.id}.csv`, download: true },
              { label: 'Branded report', onClick: () => navigate(`/reports/${job.id}/branded`) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

function ReportsTable({ jobs, campaigns, navigate, onReassign, loading = false, selectable, selectedIds, onToggleSelect, onToggleSelectAll }) {
  const allSelected = selectable && jobs.length > 0 && jobs.every((j) => selectedIds && selectedIds.has(j.id));
  return (
    <>
      <div className="rl-table-scroll rl-hide-mobile" data-tour="history-table">
        <table className="data-table rl-history-table">
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: '32px' }}>
                  <input type="checkbox" checked={allSelected} onChange={() => onToggleSelectAll(jobs)} aria-label="Select all" />
                </th>
              )}
              <th>File Name</th>
              <th>Type</th>
              <th className="numeric">Links</th>
              <th>Status</th>
              <th>Time taken</th>
              <th>Date</th>
              <th>Campaign</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          {loading ? <TableSkeleton rows={6} columns={8} rowHeight={67} label="Loading your reports" /> : (
          <tbody>
            {jobs.map((j) => (
              <ReportRow
                key={j.id}
                job={j}
                navigate={navigate}
                campaigns={campaigns}
                onReassign={onReassign}
                selectable={selectable}
                selected={!!(selectedIds && selectedIds.has(j.id))}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </tbody>
          )}
        </table>
      </div>

      {/* Mobile: stacked cards instead of the same 8-column table squeezed
          into a horizontal scroll -- see ReportCardMobile's own note. */}
      <div className="rl-mobile-only" style={{ flexDirection: 'column', padding: 'var(--s3)' }}>
        {selectable && jobs.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginBottom: 'var(--s2)' }}>
            <input type="checkbox" checked={allSelected} onChange={() => onToggleSelectAll(jobs)} />
            Select all
          </label>
        )}
        {loading ? (
          <div style={{ padding: 'var(--s4)', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-sm)' }}>Loading your reports...</div>
        ) : (
          jobs.map((j) => (
            <ReportCardMobile
              key={j.id}
              job={j}
              navigate={navigate}
              campaigns={campaigns}
              onReassign={onReassign}
              selectable={selectable}
              selected={!!(selectedIds && selectedIds.has(j.id))}
              onToggleSelect={onToggleSelect}
            />
          ))
        )}
      </div>
    </>
  );
}

function CampaignCard({ campaign, jobs, campaigns, navigate, onReassign, expanded, onToggle, onDelete, onAvatarChange }) {
  return (
    <div className="card" style={{ marginBottom: 'var(--s3)', padding: 0, overflow: 'hidden' }}>
      <div
        onClick={onToggle}
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
          {/* A single-item "..." menu was ceremony for its own sake -- one
              action gets one button, a direct delete icon, not a dropdown
              that opens to reveal exactly one row. */}
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

// Read-only info tile for the summary strip -- deliberately not a filter
// control (the toolbar right below already owns filtering); this row only
// answers "how many, of what kind" at a glance.
function SummaryTile({ icon, tone, value, label, sublabel }) {
  const toneColor = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'info' ? 'var(--info)' : tone === 'accent' ? 'var(--accent)' : 'var(--text-2)';
  const toneSoft = tone === 'ok' ? 'var(--ok-soft)' : tone === 'warn' ? 'var(--warn-soft)' : tone === 'info' ? 'var(--info-soft)' : tone === 'accent' ? 'var(--accent-soft)' : 'var(--surface-2)';
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', flex: '1 1 150px' }}>
      <div style={{
        width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: toneSoft, color: toneColor,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${toneColor} 25%, transparent)`,
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, fontSize: 'var(--fs-lg)', lineHeight: 1.1, color: toneColor === 'var(--text-2)' ? 'var(--text)' : toneColor }}>{value}</span>
          {sublabel && <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-xs)', color: toneColor, whiteSpace: 'nowrap' }}>{sublabel}</span>}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{label}</div>
      </div>
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
  const [newCampaignAvatarUrl, setNewCampaignAvatarUrl] = useState(null);
  const [creatingCampaign, setCreatingCampaign] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState('all'); // all, 7d, 30d
  // Client-side only, same as typeFilter/dateFilter -- job.status is already
  // in every job object the existing load() fetches, this just adds one more
  // filter over data already in memory rather than a new query.
  const [statusFilter, setStatusFilter] = useState('all'); // all, not-started, in-progress, done
  const [creatorSearch, setCreatorSearch] = useState('');
  // Mobile-only: whether the filter toolbar (desktop: always visible) is
  // currently expanded. Never read on desktop -- the toolbar's own CSS
  // only checks this class inside the mobile media query.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Display-only paging over the already-loaded jobs array -- separate page
  // state for the flat table and the Unassigned table since they show
  // different slices of the same underlying data.
  const [flatPage, setFlatPage] = useState(1);
  const [flatPageSize, setFlatPageSize] = useState(10);
  const [unassignedPage, setUnassignedPage] = useState(1);
  const [unassignedPageSize, setUnassignedPageSize] = useState(10);
  const [selectedUnassignedIds, setSelectedUnassignedIds] = useState(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);
  // Campaigns tab leads with a curated "Recent reports" preview (most
  // recently active campaigns first) rather than every campaign at once --
  // "View all" swaps to the full list, computed from the same campaigns
  // array either way, so nothing here is a new fetch.
  const [showAllCampaigns, setShowAllCampaigns] = useState(false);
  const RECENT_CAMPAIGNS_COUNT = 2;
  // Set once from the very first (unfiltered) load and never touched again --
  // controls whether the filter bar shows at all. Using jobs.length instead
  // would hide the search box itself the moment a creator search matches
  // nothing, trapping the user with no way to clear it.
  const [hasAnyReports, setHasAnyReports] = useState(false);

  // Older pages stream in behind the first one rather than the page waiting
  // on the full set. Tracked so the run can be abandoned when the filter
  // changes or the page unmounts mid-stream, otherwise a stale background
  // fetch would append the previous filter's reports over the new results.
  const [loadingMore, setLoadingMore] = useState(false);
  const loadRunId = useRef(0);

  const PAGE_SIZE = 100;

  const load = useCallback((creator = '') => {
    const runId = ++loadRunId.current;
    const qs = (page) => {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (creator) params.set('creator', creator);
      return `/jobs?${params.toString()}`;
    };

    setLoading(true);
    Promise.all([apiFetch(qs(1)), apiFetch('/campaigns')])
      .then(([jobsRes, campaignsRes]) => {
        if (runId !== loadRunId.current) return;
        const firstPage = jobsRes.jobs || [];
        setJobs(firstPage);
        setCampaigns(campaignsRes.campaigns || []);
        setUncategorizedRollup(campaignsRes.uncategorized || null);
        // Collapsed by default -- every campaign auto-expanding on load meant
        // the page opened as one long wall of every report in every
        // campaign at once, which is what "doesn't look responsive at all"
        // on a phone actually was: nothing to scroll past, just everything.
        if (!creator) setHasAnyReports(firstPage.length > 0);
        setLoading(false);

        // Page one is on screen and interactive at this point; the rest
        // arrives underneath it without another spinner.
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
                  // Guard against duplicates: a report created while paging
                  // shifts everything down a slot, which would otherwise
                  // re-append rows already on screen.
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
      })
      .catch(() => {
        if (runId === loadRunId.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    // Abandons any in-flight background paging when the page unmounts.
    return () => { loadRunId.current += 1; };
  }, [load]);

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

  // A filter change can put page 3 out of range for the new, smaller result
  // set -- reset to page 1 rather than showing an empty page or clamping
  // silently.
  useEffect(() => {
    setFlatPage(1);
    setUnassignedPage(1);
  }, [typeFilter, statusFilter, dateFilter, creatorSearch]);

  /*
    This used to call load() on success, which re-fetches every report AND
    every campaign from scratch and, because load() sets loading=true first,
    flashes the entire table back to its skeleton state -- for changing
    ONE row's campaign. Moving a report between campaigns only actually
    needs two things updated: that one row (which we already know the new
    value of, no server round trip required) and the campaign rollup
    numbers (report count, total views, avg ER) shown on the campaign
    cards, which DO need a real fetch since they're computed server-side.
    So: move the row instantly and optimistically, and refresh just the
    rollups quietly in the background -- no skeleton, no full reload.
  */
  const handleReassign = async (jobId, campaignId) => {
    const job = jobs.find((j) => j.id === jobId);
    const prevCampaignId = job ? (job.campaignId || null) : null;
    if (prevCampaignId === campaignId) return;

    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, campaignId } : j)));

    try {
      await apiFetch(`/jobs/${jobId}/campaign`, { method: 'PATCH', body: JSON.stringify({ campaignId }) });
      addToast('Report moved', 'ok');
      apiFetch('/campaigns')
        .then((res) => {
          setCampaigns(res.campaigns || []);
          setUncategorizedRollup(res.uncategorized || null);
        })
        .catch(() => {});
    } catch (err) {
      // Roll back the optimistic move -- the server never actually applied it.
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, campaignId: prevCampaignId } : j)));
      addToast(err.message || "Couldn't move that report, try again", 'err');
    }
  };

  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim()) return;
    setCreatingCampaign(true);
    try {
      await apiFetch('/campaigns', { method: 'POST', body: JSON.stringify({ name: newCampaignName.trim(), avatarUrl: newCampaignAvatarUrl }) });
      addToast('Campaign created', 'ok');
      setNewCampaignName('');
      setNewCampaignAvatarUrl(null);
      setNewCampaignOpen(false);
      load(creatorSearch.trim());
    } catch (err) {
      addToast(err.message || "Couldn't create that campaign, try again", 'err');
    } finally {
      setCreatingCampaign(false);
    }
  };

  // Existing campaign's avatar, changed in place (click the avatar anywhere
  // it renders) -- optimistic update same shape as handleReassign above:
  // move the value locally first, PATCH in the background, roll back on
  // failure instead of a full reload for a one-field change.
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

  const toggleUnassignedSelect = (jobId) => {
    setSelectedUnassignedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId); else next.add(jobId);
      return next;
    });
  };

  const toggleUnassignedSelectAll = (visibleJobs) => {
    setSelectedUnassignedIds((prev) => {
      const allSelected = visibleJobs.length > 0 && visibleJobs.every((j) => prev.has(j.id));
      const next = new Set(prev);
      for (const j of visibleJobs) { if (allSelected) next.delete(j.id); else next.add(j.id); }
      return next;
    });
  };

  // Reuses the exact same single-report PATCH handleReassign already calls
  // -- no new endpoint, this just loops the existing one over every selected
  // id. Reports that fail stay selected (and uncategorized) so it's obvious
  // which ones still need attention; the rest clear out of the selection.
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
      addToast(`${ids.length - failed.length} assigned, ${failed.length} failed -- try those again`, 'err');
    }
    setSelectedUnassignedIds(new Set(failed));
    load(creatorSearch.trim());
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
  const typeFilteredJobs = typeFilter === 'all' ? dateFilteredJobs : dateFilteredJobs.filter((j) => j.type === typeFilter);
  const filteredJobs = statusFilter === 'all'
    ? typeFilteredJobs
    : typeFilteredJobs.filter((j) => (STATUS_LABELS[j.status] || {}).filterGroup === statusFilter);
  const reelCount = dateFilteredJobs.filter((j) => j.type === 'reel').length;
  const profileCount = dateFilteredJobs.filter((j) => j.type === 'profile').length;
  // Summary-strip counts -- derived from data already loaded, not a new
  // fetch. done and running/paused ("in progress") reuse the same grouping
  // STATUS_LABELS already defines for the status filter above, so the strip
  // and the filter can never disagree about what counts as which.
  const completedCount = dateFilteredJobs.filter((j) => (STATUS_LABELS[j.status] || {}).filterGroup === 'done').length;
  const inProgressCount = dateFilteredJobs.filter((j) => (STATUS_LABELS[j.status] || {}).filterGroup === 'in-progress').length;
  const notStartedCount = dateFilteredJobs.filter((j) => (STATUS_LABELS[j.status] || {}).filterGroup === 'not-started').length;

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

  const campaignsByRecency = [...campaigns].sort((a, b) => {
    const at = a.latestAt ? new Date(a.latestAt).getTime() : 0;
    const bt = b.latestAt ? new Date(b.latestAt).getTime() : 0;
    return bt - at;
  });
  const visibleCampaigns = showAllCampaigns ? campaignsByRecency : campaignsByRecency.slice(0, RECENT_CAMPAIGNS_COUNT);

  const flatTotalPages = Math.max(1, Math.ceil(filteredJobs.length / flatPageSize));
  const pagedFlatJobs = filteredJobs.slice((flatPage - 1) * flatPageSize, flatPage * flatPageSize);
  const unassignedTotalPages = Math.max(1, Math.ceil(uncategorizedJobs.length / unassignedPageSize));
  const pagedUnassignedJobs = uncategorizedJobs.slice((unassignedPage - 1) * unassignedPageSize, unassignedPage * unassignedPageSize);

  const statusOptions = [
    { value: 'all', label: 'All status' },
    { value: 'done', label: `Completed (${completedCount})` },
    { value: 'in-progress', label: `In progress (${inProgressCount})` },
    { value: 'not-started', label: `Not started (${notStartedCount})` },
  ];

  // Drives the dot on the mobile "Filters" toggle -- anything other than
  // the all-encompassing default counts as "something is filtered."
  const activeFilterCount = [
    typeFilter !== 'all',
    statusFilter !== 'all',
    dateFilter !== 'all',
    creatorSearch.trim() !== '',
  ].filter(Boolean).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s4)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700 }}>Report History</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>Track, review and manage all your reports</p>
        </div>
        <div className="rl-history-header-actions" style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          {campaigns.length >= 2 && (
            <button className="btn btn-secondary" onClick={() => setCompareOpen(true)} style={{ gap: 'var(--s2)' }}>
              <ChartIcon size={15} />Compare campaigns
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setNewCampaignOpen(true)} style={{ gap: 'var(--s2)' }}>
            <PlusIcon size={15} />New campaign
          </button>
        </div>
      </div>

      {!loading && hasAnyReports && (
        <>
          {/* Summary strip: read-only counts, not filters -- the toolbar
              below is where filtering actually happens. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
            <SummaryTile icon={<FileIcon size={14} />} tone="neutral" value={dateFilteredJobs.length} label="Total reports" />
            <SummaryTile icon={<ReelIcon size={14} />} tone="accent" value={reelCount} label="Reel reports" />
            <SummaryTile icon={<ProfileIcon size={14} />} tone="info" value={profileCount} label="Profile reports" />
            <SummaryTile icon={<SuccessIcon size={14} />} tone="ok" value={completedCount} label="Completed" />
            <SummaryTile icon={<ClockIcon size={14} />} tone="info" value={inProgressCount} label="In progress" />
          </div>

          {/* Primary view switch: same groupByCampaign state and grouping
              logic the checkbox used to drive, just presented as the
              Reports/Campaigns segmented control instead of a checkbox. */}
          <div style={{ display: 'inline-flex', padding: '3px', backgroundColor: 'var(--surface-2)', borderRadius: 'var(--r-md)', marginBottom: 'var(--s3)' }}>
            <button
              type="button"
              onClick={() => setGroupByCampaign(false)}
              className="btn"
              style={{
                height: '32px', padding: '0 var(--s4)', fontSize: 'var(--fs-sm)', fontWeight: 600, border: 'none',
                backgroundColor: !groupByCampaign ? 'var(--accent-soft)' : 'transparent',
                color: !groupByCampaign ? 'var(--accent)' : 'var(--text-2)',
                boxShadow: !groupByCampaign ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)' : 'none',
                transition: 'background var(--t-fast), color var(--t-fast)',
              }}
            >
              Reports
            </button>
            <button
              type="button"
              onClick={() => setGroupByCampaign(true)}
              className="btn"
              style={{
                height: '32px', padding: '0 var(--s4)', fontSize: 'var(--fs-sm)', fontWeight: 600, border: 'none',
                backgroundColor: groupByCampaign ? 'var(--accent-soft)' : 'transparent',
                color: groupByCampaign ? 'var(--accent)' : 'var(--text-2)',
                boxShadow: groupByCampaign ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)' : 'none',
                transition: 'background var(--t-fast), color var(--t-fast)',
              }}
            >
              Campaigns
            </button>
          </div>

          {/* Mobile only: the full toolbar below stays permanently visible
              on desktop, but four filter groups sitting on screen at all
              times on a phone is exactly the "cluttered" complaint -- this
              button reveals the SAME toolbar (same state, same handlers,
              nothing duplicated) rather than clutter every visit. The dot
              is a real "something is filtered" signal, not decoration. */}
          <button
            type="button"
            className="rl-mobile-only rl-history-filters-toggle"
            onClick={() => setMobileFiltersOpen((v) => !v)}
            style={{ alignItems: 'center', justifyContent: 'space-between', gap: 'var(--s2)', width: '100%', height: '40px', padding: '0 var(--s4)', marginBottom: 'var(--s3)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', color: 'var(--text)', fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'pointer' }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              Filters
              {activeFilterCount > 0 && (
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} aria-hidden="true" />
              )}
            </span>
            <ChevronDownIcon size={15} style={{ transform: mobileFiltersOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--t-fast)' }} />
          </button>

          {/* Filter toolbar: type + status + date + search, all filtering
              the SAME jobs array already in memory -- statusFilter is the
              only new piece of state; every handler below already existed. */}
          <div className={`card rl-history-filters${mobileFiltersOpen ? ' rl-history-filters-open' : ''}`} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s4)' }}>
            <div className="rl-history-filter-group" style={{ display: 'flex', gap: '4px' }}>
              <button onClick={() => setTypeFilter('all')} className={`chip ${typeFilter === 'all' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>All</button>
              <button onClick={() => setTypeFilter('reel')} className={`chip ${typeFilter === 'reel' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Reel</button>
              <button onClick={() => setTypeFilter('profile')} className={`chip ${typeFilter === 'profile' ? 'ok' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Profile</button>
            </div>
            <span className="rl-hide-mobile" style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--border)' }} />
            <Select value={statusFilter} onChange={setStatusFilter} options={statusOptions} style={{ minWidth: '150px' }} className="rl-history-filter-select" />
            <div className="rl-history-filter-group" style={{ display: 'flex', gap: '4px' }}>
              <button onClick={() => setDateFilter('all')} className={`chip ${dateFilter === 'all' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>All time</button>
              <button onClick={() => setDateFilter('30d')} className={`chip ${dateFilter === '30d' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Last 30 days</button>
              <button onClick={() => setDateFilter('7d')} className={`chip ${dateFilter === '7d' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }}>Last 7 days</button>
            </div>
            <span className="rl-hide-mobile" style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--border)' }} />
            <span className="rl-history-filter-search" style={{ position: 'relative', flex: '1 1 220px', minWidth: 0, maxWidth: '260px' }}>
              <SearchIcon size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
              <input
                type="text"
                className="input-field"
                placeholder="Search by creator username"
                value={creatorSearch}
                onChange={(e) => setCreatorSearch(e.target.value)}
                style={{ height: '32px', fontSize: 'var(--fs-sm)', width: '100%', paddingLeft: '30px' }}
              />
            </span>
          </div>
        </>
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
        <ReportsTable jobs={[]} campaigns={[]} navigate={navigate} onReassign={() => {}} loading />
      ) : !hasAnyReports ? (
        <EmptyState
          title="No reports yet"
          description="Your finished and in-progress reports will live here across sessions."
          action={<button className="btn btn-primary" onClick={() => navigate('/reels')}>New reel report</button>}
        />
      ) : creatorSearch.trim() && jobs.length === 0 ? (
        <EmptyState
          title="No reports match that creator"
          description={`Nothing found for "${creatorSearch.trim()}". Check the spelling or try a shorter search.`}
        />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          title="No reports of this type yet"
          description="Switch filters above, or start a new report."
        />
      ) : !groupByCampaign ? (
        <div className="data-table-container">
          <ReportsTable jobs={pagedFlatJobs} campaigns={campaigns} navigate={navigate} onReassign={handleReassign} />
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <Pagination
              page={flatPage}
              totalPages={flatTotalPages}
              pageSize={flatPageSize}
              totalItems={filteredJobs.length}
              onPageChange={setFlatPage}
              onPageSizeChange={(n) => { setFlatPageSize(n); setFlatPage(1); }}
            />
          </div>
        </div>
      ) : (
        <div>
          {campaigns.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s3)' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>
                {showAllCampaigns ? 'Campaigns' : 'Recent reports'}
              </h2>
              {campaigns.length > RECENT_CAMPAIGNS_COUNT && (
                <button
                  type="button"
                  onClick={() => setShowAllCampaigns((v) => !v)}
                  className="rl-text-link"
                  style={{ fontSize: 'var(--fs-sm)' }}
                >
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
            />
          ))}

          {uncategorizedJobs.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', rowGap: 'var(--s3)', padding: 'var(--s3) var(--s4)' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-md)' }}>
                    Unassigned reports <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>· {uncategorizedJobs.length}</span>
                  </div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
                    Reports not yet assigned to a campaign
                  </div>
                </div>
                {/* Same handleReassign PATCH every per-row dropdown already
                    calls, just looped over the checked rows -- no new
                    endpoint, only appears once something is actually
                    selected. */}
                {selectedUnassignedIds.size > 0 && (
                  <Select
                    value=""
                    onChange={handleBulkAssign}
                    options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
                    placeholder={bulkAssigning ? 'Assigning...' : `Assign ${selectedUnassignedIds.size} to campaign`}
                    style={{ minWidth: '200px' }}
                  />
                )}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', overflowX: 'auto' }}>
                <ReportsTable
                  jobs={pagedUnassignedJobs}
                  campaigns={campaigns}
                  navigate={navigate}
                  onReassign={handleReassign}
                  selectable
                  selectedIds={selectedUnassignedIds}
                  onToggleSelect={toggleUnassignedSelect}
                  onToggleSelectAll={toggleUnassignedSelectAll}
                />
              </div>
              <div style={{ borderTop: '1px solid var(--border)' }}>
                <Pagination
                  page={unassignedPage}
                  totalPages={unassignedTotalPages}
                  pageSize={unassignedPageSize}
                  totalItems={uncategorizedJobs.length}
                  onPageChange={setUnassignedPage}
                  onPageSizeChange={(n) => { setUnassignedPageSize(n); setUnassignedPage(1); }}
                />
              </div>
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
    </div>
  );
}
