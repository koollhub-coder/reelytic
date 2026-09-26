import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BrandLoader } from '../components/BrandLoader';
import { MiniBrandSpinner } from '../components/MiniBrandSpinner';
import { Select } from '../components/Select';
import { ActivityChart } from '../components/ActivityChart';
import { Tooltip, TooltipRows } from '../components/Tooltip';
import { usePlanCreditsTotal } from '../hooks/usePlanCreditsTotal';
import { formatDate, formatDayKey } from '../utils/date';
import { displayName, reportPath } from '../utils/reports';
import { RowMenu } from '../components/RowMenu';
import {
  ReelIcon, ProfileIcon, LayersIcon, TrendingUpIcon, PlusIcon, CalendarIcon, FileIcon,
  DownloadIcon, ArrowUpRightIcon, SuccessIcon, ClockIcon, StarIcon,
} from '../components/Icon';

// Matches server/routes/me.routes.js's ALLOWED_RANGE_DAYS exactly -- an
// option here that the server would reject is worse than not offering it.
const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const STATUS_LABELS = {
  preview: { label: 'Not started', chip: 'warn' },
  running: { label: 'Running', chip: 'info' },
  paused: { label: 'Paused', chip: 'info' },
  done: { label: 'Complete', chip: 'ok' },
};

// Fixed row heights, not "however tall the content is" -- a card whose
// height depends on its own content is exactly what made two cards sharing
// a row look randomly sized against each other. Every card in a given row
// uses the same constant.
//
// METRIC_CARD_H is taller than the reference spec's suggested 136px: at the
// spec's own type sizes (44px icon, 32px value, a trend line) the content
// itself needs ~168px before padding even without wrapping, so 136px was
// overflowing the card's bottom edge in real content -- the "percentages
// floating out of the box" bug. Measured against real rendered content
// (icon+margin 56 + label ~14 + value 37 + trend 22 + 40 padding) rather
// than kept at the spec number.

/*
  One headline number. Icon beside the label and value, so the card is only as
  tall as its content and never has an empty band underneath. The comparison
  with the previous period is an operator's number, so it only appears when a
  trend is passed (admins).
*/
function MetricCard({ icon, tone, label, value, trend, tooltip, periodDays }) {
  const toneColor = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'info' ? 'var(--info)' : 'var(--accent)';
  const toneSoft = tone === 'ok' ? 'var(--ok-soft)' : tone === 'warn' ? 'var(--warn-soft)' : tone === 'info' ? 'var(--info-soft)' : 'var(--accent-soft)';
  return (
    <div className="card rl-mc">
      <div className="rl-mc-icon" style={{ background: toneSoft, color: toneColor }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <Tooltip content={tooltip}>
          <div className="rl-mc-label" style={{ cursor: tooltip ? 'help' : 'default' }}>{label}</div>
        </Tooltip>
        <div className="rl-mc-value">{value}</div>
        {trend !== null && trend !== undefined && (
          <Tooltip content={`Compared with the previous ${periodDays}-day period`}>
            <div className="rl-mc-trend" style={{ color: trend >= 0 ? 'var(--ok)' : 'var(--err)' }}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% <span className="rl-hide-mobile" style={{ color: 'var(--text-3)', fontWeight: 400 }}>vs previous {periodDays} days</span>
            </div>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

// Reel/Profile split, the only two categories this data ever has -- fixed
// hue order (accent for Reel, ok for Profile) matching the activity chart's
// own legend below, so the same color always means the same report type
// everywhere on this page.
function ReportSplitDonut({ reelCount, profileCount }) {
  const total = reelCount + profileCount;
  if (total === 0) {
    return (
      <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)', width: '100%' }}>
        No reports in this window yet. Run a Reel or Profile report to see the split here.
      </div>
    );
  }
  const r = 60;
  const circumference = 2 * Math.PI * r;
  const reelFrac = reelCount / total;
  const reelLen = circumference * reelFrac;
  const gap = 3; // surface-color gap between the two segments, both ends
  return (
    <div className="rl-donut-row" style={{ display: 'flex', alignItems: 'center', gap: '28px', flex: 1 }}>
      <svg className="rl-donut-svg" width="160" height="160" viewBox="0 0 160 160" style={{ flexShrink: 0 }}>
        <g transform="translate(80,80) rotate(-90)">
          <circle r={r} fill="none" stroke="var(--surface-2)" strokeWidth="18" />
          {reelCount > 0 && (
            <circle
              r={r} fill="none" stroke="var(--accent)" strokeWidth="18"
              strokeDasharray={`${Math.max(0, reelLen - gap)} ${circumference - reelLen + gap}`}
              strokeLinecap="round"
            />
          )}
          {profileCount > 0 && (
            <circle
              r={r} fill="none" stroke="var(--ok)" strokeWidth="18"
              strokeDasharray={`${Math.max(0, circumference - reelLen - gap)} ${reelLen + gap}`}
              strokeDashoffset={-reelLen}
              strokeLinecap="round"
            />
          )}
        </g>
        <text x="80" y="76" textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--text)" fontFamily="var(--font-data)">{total.toLocaleString()}</text>
        <text x="80" y="96" textAnchor="middle" fontSize="11" fill="var(--text-3)">links</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: '13px', color: 'var(--text-2)', flexWrap: 'wrap' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: 'var(--accent)', display: 'inline-block', flexShrink: 0, alignSelf: 'center' }} />
          <span>Reel links</span>
          <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, color: 'var(--text)' }}>{reelCount.toLocaleString()}</span>
          <span style={{ color: 'var(--text-3)' }}>· {(reelFrac * 100).toFixed(1)}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: '13px', color: 'var(--text-2)', flexWrap: 'wrap' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: 'var(--ok)', display: 'inline-block', flexShrink: 0, alignSelf: 'center' }} />
          <span>Profile links</span>
          <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, color: 'var(--text)' }}>{profileCount.toLocaleString()}</span>
          <span style={{ color: 'var(--text-3)' }}>· {((1 - reelFrac) * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

// Left-aligned "3 / 10 credits", right-aligned "30% left", same row, same
// baseline -- not stacked, not centered. Color shifts from accent to warn to
// err as the pool runs low, the same semantic the rest of the app already
// uses for status chips.
function CreditsBar({ remaining, total }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((remaining / total) * 100))) : 0;
  const barColor = pct <= 15 ? 'var(--err)' : pct <= 40 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
        <span style={{ fontSize: '13px', fontWeight: 600 }}>
          {remaining.toLocaleString()} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>/ {total.toLocaleString()} credits</span>
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>{pct}% left</span>
      </div>
      <Tooltip content={`${remaining} of ${total} available report credits remaining`} style={{ display: 'block', width: '100%' }}>
        <div style={{ height: '6px', borderRadius: 'var(--r-full)', backgroundColor: 'var(--surface-2)', overflow: 'hidden', cursor: 'help' }}>
          <div style={{ width: `${pct}%`, height: '100%', backgroundColor: barColor, borderRadius: 'var(--r-full)', transition: 'width 300ms ease' }} />
        </div>
      </Tooltip>
    </div>
  );
}

function InsightRow({ icon, tone, title, detail }) {
  const toneColor = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'info' ? 'var(--info)' : 'var(--accent)';
  const toneSoft = tone === 'ok' ? 'var(--ok-soft)' : tone === 'warn' ? 'var(--warn-soft)' : tone === 'info' ? 'var(--info-soft)' : 'var(--accent-soft)';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
      <div style={{
        width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: toneSoft, color: toneColor,
      }}>
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>{detail}</div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const planCreditsTotal = usePlanCreditsTotal(user);
  // 14 is still what a visitor lands on -- only the ceiling on how far back
  // they can pull it changed. See RANGE_OPTIONS below for the other choices
  // and server/routes/me.routes.js's ALLOWED_RANGE_DAYS for why these four.
  const [days, setDays] = useState(14);

  // Cached per days value (queryKey), and cached across navigation for
  // App.jsx's default staleTime -- leaving for Creators and coming back to
  // Dashboard within that window renders the last-known numbers instantly
  // instead of the full loading sequence below firing again from zero.
  // placeholderData:keepPreviousData is what reproduces the old refetch
  // effect's exact behavior on a days change: keep showing the previous
  // range's numbers (not a blank state) while the new range loads, same as
  // the old code never clearing `data` in its .finally.
  const { data, error: queryError, isLoading, isFetching } = useQuery({
    queryKey: ['me-stats', days],
    queryFn: () => apiFetch(`/me/stats?days=${days}`),
    placeholderData: keepPreviousData,
  });
  const error = queryError?.message || '';
  // isLoading is only true pre-first-data for THIS query key; once any data
  // (real or kept-previous) is on screen, further fetches are a background
  // isFetching -- same "old numbers stay up, small spinner shows" case the
  // old refreshing state covered.
  const refreshing = isFetching && !isLoading;

  if (error) {
    return (
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '30px', fontWeight: 600, marginBottom: 'var(--s4)' }}>Dashboard</h1>
        <div className="card" style={{ color: 'var(--err)' }}>{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <BrandLoader message="Loading your dashboard..." />
    );
  }

  const daily = data.activityByDay || [];
  // Display only, reusing the same dates the chart already has -- no new
  // fetch, no new calculation of what the window actually is.
  const dateRangeLabel = daily.length > 0
    ? (() => {
      const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const parse = (s) => { const [, , m, d] = s.match(/^(\d{4})-(\d{2})-(\d{2})$/).map(Number); return { d, m }; };
      const start = parse(daily[0].date);
      const end = parse(daily[daily.length - 1].date);
      return start.m === end.m
        ? `${String(start.d).padStart(2, '0')}-${String(end.d).padStart(2, '0')} ${MONTHS_SHORT[start.m - 1]}`
        : `${String(start.d).padStart(2, '0')} ${MONTHS_SHORT[start.m - 1]} - ${String(end.d).padStart(2, '0')} ${MONTHS_SHORT[end.m - 1]}`;
    })()
    : null;
  const periodTotal = daily.reduce((sum, d) => sum + d.total, 0);
  const activeDays = daily.filter((d) => d.total > 0).length;
  const busiestDay = daily.reduce((best, d) => (d.total > (best?.total || 0) ? d : best), null);
  const hasActivity = periodTotal > 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  // Whether this account has EVER submitted anything, not whether it's
  // done anything in the last 14 days -- those are different questions,
  // and answering "No reports yet, run your first report" with the
  // windowed count was telling an account with hundreds of historical
  // reports that it had none, just because its most recent activity
  // happened to fall outside the trailing 14-day window. recentJobs is
  // fetched unscoped by date (see server/routes/me.routes.js), so any
  // account with real history has at least one entry here regardless of
  // when it last ran something.
  const hasReports = !!(data.recentJobs && data.recentJobs.length > 0);
  // The "vs previous period" percentages are an operator's number. A client
  // just wants their own figures, so only admins get the comparison.
  const trends = user && user.role === 'admin' ? (data.trends || {}) : {};

  // Report-mix insight: which type this workspace mostly runs. Only a
  // meaningful statement when the two counts actually differ -- an exact
  // tie has no "majority" to report.
  const totalReports = (data.reelCount || 0) + (data.profileCount || 0);
  const reportMix = totalReports > 0 && data.reelCount !== data.profileCount
    ? (data.reelCount > data.profileCount
      ? { type: 'Reel', pct: Math.round((data.reelCount / totalReports) * 100) }
      : { type: 'Profile', pct: Math.round((data.profileCount / totalReports) * 100) })
    : null;

  const recent = (data.recentJobs || []).slice(0, 6);

  return (
    <div>
      {/* Header: who and what, then the two things a person comes here to do.
          The date range is not a header control (it changes the numbers below,
          not the page), so it lives with those numbers instead. */}
      <div className="rl-page-head">
        <div>
          <h1>{greeting}, {user?.name ? String(user.name).split(' ')[0] : user?.username}</h1>
          <p>Here's what's happening in your Reelytic workspace.</p>
        </div>
        <div className="rl-page-head-actions rl-dashboard-header-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate('/reels')} style={{ gap: '8px' }}>
            <PlusIcon size={16} />New Reel Report
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/profiles')} style={{ gap: '8px' }}>
            <PlusIcon size={16} />New Profile Report
          </button>
        </div>
      </div>

      <div className="rl-section-head">
        <h2>Overview</h2>
        <div className="rl-section-tools">
          {dateRangeLabel && <span className="rl-hide-mobile" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{dateRangeLabel}</span>}
          {refreshing && <MiniBrandSpinner />}
          <Select
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={RANGE_OPTIONS}
            disabled={refreshing}
            style={{ minWidth: '150px' }}
          />
        </div>
      </div>

      {/* Mobile only: one prominent "total processed + trend" summary. Admin
          only, since the comparison is an operator's number. */}
      {trends.totalCount !== null && trends.totalCount !== undefined && (
        <div className="rl-mobile-only card" style={{ padding: 'var(--s4)', marginBottom: '16px', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: trends.totalCount >= 0 ? 'var(--ok)' : 'var(--err)' }}>
              {trends.totalCount >= 0 ? '↑' : '↓'} {Math.abs(trends.totalCount)}% <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>vs previous {days} days</span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: '4px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-2)' }}>Total reports processed</span>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: '24px', fontWeight: 700 }}>{data.totalCount.toLocaleString()}</span>
          </div>
        </div>
      )}

      <div className="rl-dashboard-metrics rl-metric-grid">
        <MetricCard
          icon={<FileIcon size={20} />} tone="accent" label="Reports"
          value={(data.reportCount || 0).toLocaleString()} trend={trends.reportCount} periodDays={days}
          tooltip={`Reports you ran in the last ${days} days (${data.reelReportCount || 0} reel, ${data.profileReportCount || 0} profile)`}
        />
        <MetricCard
          icon={<ReelIcon size={20} />} tone="info" label="Reel links"
          value={data.reelCount.toLocaleString()} trend={trends.reelCount} periodDays={days}
          tooltip={`Reel links processed in the last ${days} days`}
        />
        <MetricCard
          icon={<ProfileIcon size={20} />} tone="ok" label="Profile links"
          value={data.profileCount.toLocaleString()} trend={trends.profileCount} periodDays={days}
          tooltip={`Profile links processed in the last ${days} days`}
        />
        <MetricCard
          icon={<TrendingUpIcon size={20} />} tone="warn" label="Success rate"
          value={data.totalCount > 0 ? `${data.successRate}%` : '-'} trend={trends.successRate} periodDays={days}
          tooltip="Percentage of submitted links successfully processed"
        />
      </div>

      {!hasReports ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--s7)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>No reports yet</div>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>Run your first Reel or Profile report to start seeing workspace activity.</p>
          <div style={{ display: 'flex', gap: 'var(--s3)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/reels')} style={{ gap: 'var(--s2)' }}>
              <PlusIcon size={15} />New Reel Report
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/profiles')} style={{ gap: 'var(--s2)' }}>
              <PlusIcon size={15} />New Profile Report
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Activity (58%) + Report type split (42%). Heights follow their
              content, never a fixed number, so there is no empty band at the
              bottom of a card. */}
          <div className="rl-dashboard-analytics rl-two-col">
            <div className="card">
              <div className="rl-card-head">
                <h3>Activity</h3>
                {hasActivity && (
                  <div className="rl-legend">
                    <span><i style={{ background: 'var(--accent)' }} />Reels</span>
                    <span><i style={{ background: 'var(--ok)' }} />Profiles</span>
                  </div>
                )}
              </div>
              {!hasActivity ? (
                <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6) var(--s4)' }}>No activity in this window yet. Try a longer range.</div>
              ) : (
                <>
                  <div className="rl-activity-stats" style={{ display: 'flex', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
                    <div className="rl-activity-stat">
                      <span className="rl-activity-stat-icon" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><LayersIcon size={14} /></span>
                      <span>
                        <span className="rl-activity-stat-value">{periodTotal.toLocaleString()}</span>
                        <span className="rl-activity-stat-label">Links processed</span>
                      </span>
                    </div>
                    <div className="rl-activity-stat">
                      <span className="rl-activity-stat-icon" style={{ background: 'var(--ok-soft)', color: 'var(--ok)' }}><SuccessIcon size={14} /></span>
                      <span>
                        <span className="rl-activity-stat-value">{activeDays}/{days}</span>
                        <span className="rl-activity-stat-label">Active days</span>
                      </span>
                    </div>
                    {busiestDay && busiestDay.total > 0 && (
                      <div className="rl-activity-stat">
                        <span className="rl-activity-stat-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><ClockIcon size={14} /></span>
                        <span>
                          <span className="rl-activity-stat-value">{formatDayKey(busiestDay.date)}</span>
                          <span className="rl-activity-stat-label">Busiest day</span>
                        </span>
                      </div>
                    )}
                  </div>
                  <ActivityChart data={daily} height={230} />
                </>
              )}
            </div>

            <div className="card">
              <div className="rl-card-head"><h3>Reel and profile links</h3></div>
              <div style={{ display: 'flex', alignItems: 'center', minHeight: 200 }}>
                <ReportSplitDonut reelCount={data.reelCount} profileCount={data.profileCount} />
              </div>
            </div>
          </div>

          {/* Recent reports (58%) + Quick insights (42%). */}
          <div className="rl-dashboard-lower rl-two-col">
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="rl-card-head" style={{ padding: 'var(--s4) var(--s4) var(--s3)' }}>
                <h3>Recent reports</h3>
                <button type="button" onClick={() => navigate('/history')} className="rl-text-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--fs-sm)' }}>
                  View all <ArrowUpRightIcon size={13} />
                </button>
              </div>
              {recent.length === 0 ? (
                <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s5)' }}>No reports yet.</div>
              ) : (
                <>
                  {/* Phone: one compact row per report. */}
                  <div className="rl-mobile-only" style={{ flexDirection: 'column' }}>
                    {recent.map((j) => {
                      const statusInfo = STATUS_LABELS[j.status] || { label: j.status, chip: '' };
                      return (
                        <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)', borderTop: '1px solid var(--border)' }}>
                          <div style={{
                            width: '36px', height: '36px', borderRadius: 'var(--r-md)', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: j.type === 'reel' ? 'var(--accent-soft)' : 'var(--ok-soft)',
                            color: j.type === 'reel' ? 'var(--accent)' : 'var(--ok)',
                          }}>
                            {j.type === 'reel' ? <ReelIcon size={16} /> : <ProfileIcon size={16} />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(j)}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                              <span className={`chip ${statusInfo.chip}`} style={{ fontSize: '10px' }}>{statusInfo.label}</span>
                              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>{formatDate(j.createdAt)}{j.counts?.total ? ` · ${j.counts.total} ${j.counts.total === 1 ? 'link' : 'links'}` : ''}</span>
                            </div>
                          </div>
                          <button type="button" className="btn btn-secondary" style={{ height: 32, padding: '0 12px', fontSize: 'var(--fs-sm)' }} onClick={() => navigate(reportPath(j))}>
                            {j.status === 'done' ? 'View' : 'Resume'}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="data-table-container rl-hide-mobile" style={{ border: 0, borderRadius: 0, borderTop: '1px solid var(--border)' }}>
                    <table className="data-table rl-dt-table">
                      <thead>
                        <tr>
                          <th>Report</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th style={{ textAlign: 'right', width: 132 }} />
                        </tr>
                      </thead>
                      <tbody>
                        {recent.map((j) => {
                          const statusInfo = STATUS_LABELS[j.status] || { label: j.status, chip: '' };
                          const canDownload = j.status === 'done' && (j.counts?.success || 0) > 0;
                          return (
                            <tr key={j.id}>
                              <td style={{ maxWidth: 0, width: '44%' }}>
                                <div className="rl-cell-title" title={displayName(j)} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(j)}</div>
                                <div className="rl-cell-sub">{j.type === 'reel' ? 'Reel' : 'Profile'}{j.counts?.total ? ` · ${j.counts.total} ${j.counts.total === 1 ? 'link' : 'links'}` : ''}</div>
                              </td>
                              <td><span className={`chip ${statusInfo.chip}`}>{statusInfo.label}</span></td>
                              <td style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' }}>{formatDate(j.createdAt)}</td>
                              <td style={{ textAlign: 'right' }}>
                                <div className="rl-actions">
                                  <button type="button" className="btn btn-secondary rl-actions-primary" onClick={() => navigate(reportPath(j))}>
                                    {j.status === 'done' ? 'View' : 'Resume'}
                                  </button>
                                  <span className="rl-actions-slot">
                                    {canDownload && (
                                      <RowMenu items={[
                                        { label: 'Download Excel (.xlsx)', icon: DownloadIcon, href: `/api/export/${j.id}.xlsx`, download: true },
                                        { label: 'Download CSV', icon: DownloadIcon, href: `/api/export/${j.id}.csv`, download: true },
                                      ]} />
                                    )}
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <div className="card">
              <div className="rl-card-head"><h3>Quick insights</h3></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)', flex: 1 }}>
                {data.totalCount === 0 && !reportMix && (
                  <InsightRow
                    icon={<TrendingUpIcon size={16} />}
                    tone="info"
                    title="No insights yet"
                    detail="Run a Reel or Profile report and this panel fills in with your success rate, busiest day, and report mix."
                  />
                )}
                {/* A "100% success rate, 0/0 processed" row is not an insight
                    for an empty window -- it is a division-by-zero default
                    reading as a real stat. */}
                {data.totalCount > 0 && (
                  <InsightRow
                    icon={<TrendingUpIcon size={16} />}
                    tone="ok"
                    title={`Your success rate is ${data.successRate}%`}
                    detail={`${data.successCount ?? data.totalCount}/${data.totalCount} links processed successfully.`}
                  />
                )}
                {busiestDay && busiestDay.total > 0 && (
                  <InsightRow
                    icon={<CalendarIcon size={16} />}
                    tone="accent"
                    title="Most active day"
                    detail={`${formatDayKey(busiestDay.date)} with ${busiestDay.total} report${busiestDay.total === 1 ? '' : 's'}.`}
                  />
                )}
                {reportMix && (
                  <InsightRow
                    icon={<SuccessIcon size={16} />}
                    tone="warn"
                    title="Report mix"
                    detail={`${reportMix.type} reports make up ${reportMix.pct}% of your workspace.`}
                  />
                )}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginTop: 'auto', paddingTop: 'var(--s3)', borderTop: '1px solid var(--border)' }}>
                  <Tooltip content="Credits available before your current plan limit is reached">
                    <div style={{
                      width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'help',
                    }}>
                      <StarIcon size={16} />
                    </div>
                  </Tooltip>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Credits</div>
                    {planCreditsTotal && (user?.credits ?? 0) <= planCreditsTotal ? (
                      <CreditsBar remaining={user?.credits ?? 0} total={planCreditsTotal} />
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>{(user?.credits ?? 0).toLocaleString()} credits remaining.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
