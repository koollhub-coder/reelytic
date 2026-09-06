import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BrandLoader } from '../components/BrandLoader';
import { Select } from '../components/Select';
import { ActivityChart } from '../components/ActivityChart';
import { Tooltip, TooltipRows } from '../components/Tooltip';
import { usePlanCreditsTotal } from '../hooks/usePlanCreditsTotal';
import { formatDate, formatDayKey } from '../utils/date';
import {
  ReelIcon, ProfileIcon, LayersIcon, TrendingUpIcon, PlusIcon, CalendarIcon,
  EyeIcon, DownloadIcon, ArrowUpRightIcon, SuccessIcon, ClockIcon, StarIcon,
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
const METRIC_CARD_H = 176;
const ANALYTICS_CARD_H = 292;
const LOWER_CARD_H = 400;

/*
  Metric tile: icon+label/value pinned to the top, the trend line pinned to
  the BOTTOM via margin-top:auto inside a flex column -- so the trend always
  sits on the same baseline across all four cards regardless of how long the
  label text runs, instead of trailing wherever the content above happens to
  end.

  `trend` is a real percentage from /api/me/stats (current 14-day window vs
  the previous one), or null when there's no previous-period data to compare
  against (division by zero has no percentage) -- never a placeholder value.
*/
function MetricCard({ icon, tone, label, value, trend, tooltip, periodDays }) {
  const toneColor = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'info' ? 'var(--info)' : 'var(--accent)';
  const toneSoft = tone === 'ok' ? 'var(--ok-soft)' : tone === 'warn' ? 'var(--warn-soft)' : tone === 'info' ? 'var(--info-soft)' : 'var(--accent-soft)';
  return (
    <div className="card rl-metric-card" style={{ height: `${METRIC_CARD_H}px`, padding: '20px', display: 'flex', flexDirection: 'column' }}>
      <div className="rl-metric-card-icon" style={{
        width: '44px', height: '44px', borderRadius: '12px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: toneSoft, color: toneColor, marginBottom: '12px',
      }}>
        {icon}
      </div>
      <Tooltip content={tooltip}>
        <div className="rl-metric-card-label" style={{ fontSize: '12px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, cursor: tooltip ? 'help' : 'default', width: 'fit-content' }}>{label}</div>
      </Tooltip>
      <div className="rl-metric-card-value" style={{ fontFamily: 'var(--font-data)', fontSize: '32px', fontWeight: 700, marginTop: '2px', lineHeight: 1.1 }}>{value}</div>
      <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
        {trend !== null && trend !== undefined && (
          <Tooltip content={`Compared with the previous ${periodDays}-day period`}>
            <div className="rl-metric-card-trend" style={{ fontSize: '12px', fontWeight: 600, color: trend >= 0 ? 'var(--ok)' : 'var(--err)', width: 'fit-content', cursor: 'help' }}>
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
        No reports in this window yet -- run a Reel or Profile report to see the split here.
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
        <text x="80" y="96" textAnchor="middle" fontSize="11" fill="var(--text-3)">reports</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: '13px', color: 'var(--text-2)', flexWrap: 'wrap' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: 'var(--accent)', display: 'inline-block', flexShrink: 0, alignSelf: 'center' }} />
          <span>Reel reports</span>
          <span style={{ fontFamily: 'var(--font-data)', fontWeight: 700, color: 'var(--text)' }}>{reelCount.toLocaleString()}</span>
          <span style={{ color: 'var(--text-3)' }}>· {(reelFrac * 100).toFixed(1)}%</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: '13px', color: 'var(--text-2)', flexWrap: 'wrap' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: 'var(--ok)', display: 'inline-block', flexShrink: 0, alignSelf: 'center' }} />
          <span>Profile reports</span>
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

// Compact icon button, used for the two row actions in Recent Reports --
// same width/height/border regardless of which icon, tooltip instead of the
// native title= this used to carry.
function IconButton({ tooltip, ...props }) {
  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        style={{ width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)', color: 'var(--text-2)', cursor: 'pointer', transition: 'background 150ms ease' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        {...props}
      />
    </Tooltip>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // Only true for a range-switch refetch, not the first load -- the first
  // load has its own full-page BrandLoader below since there's nothing to
  // show yet. Without this, switching "14 days" to "30 days" left the old
  // numbers on screen with no indication anything was happening until the
  // new response landed.
  const [refreshing, setRefreshing] = useState(false);
  const planCreditsTotal = usePlanCreditsTotal(user);
  // 14 is still what a visitor lands on -- only the ceiling on how far back
  // they can pull it changed. See RANGE_OPTIONS below for the other choices
  // and server/routes/me.routes.js's ALLOWED_RANGE_DAYS for why these four.
  const [days, setDays] = useState(14);

  useEffect(() => {
    if (data !== null) setRefreshing(true);
    apiFetch(`/me/stats?days=${days}`)
      .then((res) => { setData(res); setError(''); })
      .catch((err) => setError(err.message))
      .finally(() => setRefreshing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

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
  const trends = data.trends || {};

  // Report-mix insight: which type this workspace mostly runs. Only a
  // meaningful statement when the two counts actually differ -- an exact
  // tie has no "majority" to report.
  const totalReports = (data.reelCount || 0) + (data.profileCount || 0);
  const reportMix = totalReports > 0 && data.reelCount !== data.profileCount
    ? (data.reelCount > data.profileCount
      ? { type: 'Reel', pct: Math.round((data.reelCount / totalReports) * 100) }
      : { type: 'Profile', pct: Math.round((data.profileCount / totalReports) * 100) })
    : null;

  return (
    <div>
      {/* Header: greeting + subtitle left, a real range picker and the two
          report actions right. The picker drives /me/stats?days= (see
          RANGE_OPTIONS above and the server's ALLOWED_RANGE_DAYS) -- 14 is
          still what a visitor lands on, but it's an actual filter now, not
          a label promising one. All three controls share the same 48px
          height. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 600 }}>
            {greeting}, {user?.username} <span aria-hidden="true">👋</span>
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: '14px' }}>Here's what's happening in your Reelytic workspace.</p>
        </div>
        <div className="rl-dashboard-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarIcon size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <Select
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              options={RANGE_OPTIONS}
              disabled={refreshing}
              style={{ height: '48px', minWidth: '150px', fontSize: '13px' }}
            />
            {refreshing && <span className="rl-inline-spinner" aria-label="Updating" />}
            {dateRangeLabel && (
              <span className="rl-hide-mobile" style={{ fontSize: '12px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>({dateRangeLabel})</span>
            )}
          </div>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/reels')} style={{ gap: '8px', height: '48px', padding: '0 20px' }}>
            <PlusIcon size={16} />New Reel Report
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/profiles')} style={{ gap: '8px', height: '48px', padding: '0 20px' }}>
            <PlusIcon size={16} />New Profile Report
          </button>
        </div>
      </div>

      {/* Mobile only: one prominent "total processed + trend" summary,
          matching the reference design's top card -- real data already
          computed below (data.totalCount, trends.totalCount), nothing
          invented. This sits ABOVE the 4-metric grid rather than replacing
          it: the reference shows this one number most prominently, but the
          per-type breakdown and success rate it doesn't show are still
          real, previously-required information that stays, restructured
          rather than removed. */}
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

      {/* 4 equal metric cards -- see METRIC_CARD_H, all identical height regardless of content. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px' }} className="rl-dashboard-metrics">
        <MetricCard
          icon={<ReelIcon size={20} />} tone="accent" label="Reel Reports"
          value={data.reelCount.toLocaleString()} trend={trends.reelCount} periodDays={days}
          tooltip={`Reel links processed in the last ${days} days`}
        />
        <MetricCard
          icon={<ProfileIcon size={20} />} tone="ok" label="Profile Reports"
          value={data.profileCount.toLocaleString()} trend={trends.profileCount} periodDays={days}
          tooltip={`Profile links processed in the last ${days} days`}
        />
        <MetricCard
          icon={<LayersIcon size={20} />} tone="info" label="Total Processed"
          value={data.totalCount.toLocaleString()} trend={trends.totalCount} periodDays={days}
          tooltip="Total reel and profile links processed during the selected period"
        />
        <MetricCard
          icon={<TrendingUpIcon size={20} />} tone="warn" label="Success Rate"
          value={`${data.successRate}%`} trend={trends.successRate} periodDays={days}
          tooltip="Percentage of submitted links successfully processed"
        />
      </div>

      {!hasReports ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--s7)', marginBottom: 'var(--s4)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>No reports yet</div>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>Run your first Reel or Profile report to start seeing workspace activity.</p>
          <div style={{ display: 'flex', gap: 'var(--s3)', justifyContent: 'center', flexWrap: 'wrap' }}>
            {/* A drawn PlusIcon, not a literal "+" character -- same reason
                the header's two report buttons above already use it: a
                plain glyph renders at whatever weight the visitor's font
                happens to pick, which is exactly why it read as a
                different, less-finished button than its header twin doing
                the identical action. */}
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
          {/* Activity (58%) + Report type split (42%) -- fixed, identical
              height (ANALYTICS_CARD_H) rather than "however tall the
              content is," with the donut's content vertically centered so
              a naturally shorter card never reads as leftover dead space. */}
          <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: '16px', marginBottom: '16px' }} className="rl-dashboard-analytics">
            <div className="card" style={{ height: `${ANALYTICS_CARD_H}px`, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--s3)' }}>
                Activity (last {days} days)
              </h3>
              {!hasActivity ? (
                <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>No activity in this window yet.</div>
              ) : (
                <>
                  {/* Three icon-badge stats: same shape as the reference
                      design, and the same information the old plain-text
                      row had (nothing added, nothing dropped) -- just
                      restructured so it reads clearly at any width instead
                      of one wrapping text line. */}
                  <div className="rl-activity-stats" style={{ display: 'flex', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
                    <div className="rl-activity-stat">
                      <span className="rl-activity-stat-icon" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><LayersIcon size={14} /></span>
                      <span>
                        <span className="rl-activity-stat-value">{periodTotal.toLocaleString()}</span>
                        <span className="rl-activity-stat-label">Processed</span>
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

                  <div style={{ display: 'flex', gap: 'var(--s4)', marginBottom: 'var(--s3)', fontSize: '12px', color: 'var(--text-2)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'var(--accent)', display: 'inline-block' }} />Reel reports
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'var(--ok)', display: 'inline-block' }} />Profile reports
                    </span>
                  </div>

                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ActivityChart data={daily} height={ANALYTICS_CARD_H - 130} />
                  </div>
                </>
              )}
            </div>

            <div className="card" style={{ height: `${ANALYTICS_CARD_H}px`, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--s3)' }}>Report type split</h3>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                <ReportSplitDonut reelCount={data.reelCount} profileCount={data.profileCount} />
              </div>
            </div>
          </div>

          {/* Recent reports (58%) + Quick insights (42%) -- same fixed-height reasoning. */}
          <div style={{ display: 'grid', gridTemplateColumns: '7fr 5fr', gap: '16px' }} className="rl-dashboard-lower">
            <div className="card" style={{ height: `${LOWER_CARD_H}px`, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: 'var(--s4)', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600 }}>Recent reports</h3>
              </div>
              {(!data.recentJobs || data.recentJobs.length === 0) ? (
                <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s5)' }}>No reports yet.</div>
              ) : (
                <>
                  {/* Mobile: icon + filename + status + date as one compact
                      row per report, instead of the 5-column desktop table
                      squeezed into a horizontal scroll -- same pattern
                      already used for History's own report list. */}
                  <div className="rl-mobile-only" style={{ flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
                    {data.recentJobs.map((j) => {
                      const statusInfo = STATUS_LABELS[j.status] || { label: j.status, chip: '' };
                      const canDownload = j.status === 'done' && (j.counts?.success || 0) > 0;
                      return (
                        <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s3) var(--s4)', borderBottom: '1px solid var(--border)' }}>
                          <div style={{
                            width: '36px', height: '36px', borderRadius: 'var(--r-md)', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: j.type === 'reel' ? 'var(--accent-soft)' : 'var(--ok-soft)',
                            color: j.type === 'reel' ? 'var(--accent)' : 'var(--ok)',
                          }}>
                            {j.type === 'reel' ? <ReelIcon size={16} /> : <ProfileIcon size={16} />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {j.fileName || 'Pasted links'}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                              <span className={`chip ${j.type === 'reel' ? 'accent' : 'ok'}`} style={{ fontSize: '10px', textTransform: 'uppercase' }}>{j.type}</span>
                              <span className={`chip ${statusInfo.chip}`} style={{ fontSize: '10px' }}>{statusInfo.label}</span>
                              <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
                                {formatDate(j.createdAt)}{j.counts?.total ? ` · ${j.counts.total} links` : ''}
                              </span>
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            <IconButton tooltip="View report" onClick={() => navigate(j.type === 'reel' ? '/reels' : '/profiles')}>
                              <EyeIcon size={14} />
                            </IconButton>
                            {canDownload && (
                              <Tooltip content="Download report">
                                <a
                                  href={`/api/export/${j.id}.xlsx`}
                                  download
                                  style={{ width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)', color: 'var(--text-2)' }}
                                >
                                  <DownloadIcon size={14} />
                                </a>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rl-table-scroll rl-hide-mobile" style={{ flex: 1 }}>
                    <table className="data-table rl-dashboard-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>File</th>
                          <th>Status</th>
                          <th>Date</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentJobs.map((j) => {
                          const statusInfo = STATUS_LABELS[j.status] || { label: j.status, chip: '' };
                          const canDownload = j.status === 'done' && (j.counts?.success || 0) > 0;
                          return (
                            <tr key={j.id}>
                              <td><span className={`chip ${j.type === 'reel' ? 'accent' : 'ok'}`} style={{ textTransform: 'uppercase' }}>{j.type}</span></td>
                              <td style={{ color: 'var(--text-2)', maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <Tooltip content={j.fileName || 'Pasted links'}>
                                  <span>{j.fileName || 'Pasted links'}</span>
                                </Tooltip>
                              </td>
                              <td><span className={`chip ${statusInfo.chip}`}>{statusInfo.label}</span></td>
                              <td className="mono" style={{ color: 'var(--text-3)' }}>{formatDate(j.createdAt)}</td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: '4px' }}>
                                  <IconButton tooltip="View report" onClick={() => navigate(j.type === 'reel' ? '/reels' : '/profiles')}>
                                    <EyeIcon size={14} />
                                  </IconButton>
                                  {canDownload && (
                                    <Tooltip content="Download report">
                                      <a
                                        href={`/api/export/${j.id}.xlsx`}
                                        download
                                        style={{ width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)', color: 'var(--text-2)' }}
                                      >
                                        <DownloadIcon size={14} />
                                      </a>
                                    </Tooltip>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: 'var(--s3) var(--s4)', borderTop: '1px solid var(--border)' }}>
                    <button type="button" onClick={() => navigate('/history')} className="rl-text-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 'var(--fs-sm)' }}>
                      View all reports <ArrowUpRightIcon size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="card" style={{ height: `${LOWER_CARD_H}px`, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--s4)' }}>Quick insights</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)', flex: 1, justifyContent: 'space-between' }}>
                {data.totalCount === 0 && !reportMix && (
                  <InsightRow
                    icon={<TrendingUpIcon size={16} />}
                    tone="info"
                    title="No insights yet"
                    detail={`Run a Reel or Profile report and this panel fills in with your success rate, busiest day, and report mix.`}
                  />
                )}
                {/* A "100% success rate, 0/0 processed" row is not an
                    insight for a brand-new or empty-window account -- it's
                    a division-by-zero default reading as a real stat. Only
                    worth showing once something has actually been
                    processed to have a rate over. */}
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
                {hasActivity && (
                  <InsightRow
                    icon={<ClockIcon size={16} />}
                    tone="info"
                    title="Processing activity"
                    detail={`${activeDays} of the last ${days} days had activity, ${periodTotal.toLocaleString()} processed in total.`}
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
                {user?.plan === 'unlimited' ? (
                  <InsightRow icon={<StarIcon size={16} />} tone="accent" title="Credits" detail="Unlimited plan, no credit limit." />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
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
                      {planCreditsTotal ? (
                        <CreditsBar remaining={user?.credits ?? 0} total={planCreditsTotal} />
                      ) : (
                        <div style={{ fontSize: '12px', color: 'var(--text-2)' }}>{(user?.credits ?? 0).toLocaleString()} credits remaining.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
