import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BrandLoader } from '../components/BrandLoader';
import { Tooltip, TooltipRows } from '../components/Tooltip';
import { formatDate, formatDayKey } from '../utils/date';
import {
  ReelIcon, ProfileIcon, LayersIcon, TrendingUpIcon, PlusIcon, CalendarIcon,
  EyeIcon, DownloadIcon, ArrowUpRightIcon, SuccessIcon, ClockIcon, StarIcon,
} from '../components/Icon';

// The user doc only ever stores the CURRENT balance -- there is no
// "credits granted" field anywhere (see credits.service.js), so a progress
// bar has nothing to measure against unless it borrows one. The free tier's
// one-time grant is the same 10 used in Signup/Landing's own copy; paid
// tiers borrow their plan's monthly credits figure from the live pricing
// API (the same one Pricing.jsx renders), so if pricing ever changes this
// stays correct with zero code changes here.
const FREE_TIER_CREDITS = 10;

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
function MetricCard({ icon, tone, label, value, trend, tooltip }) {
  const toneColor = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : tone === 'info' ? 'var(--info)' : 'var(--accent)';
  const toneSoft = tone === 'ok' ? 'var(--ok-soft)' : tone === 'warn' ? 'var(--warn-soft)' : tone === 'info' ? 'var(--info-soft)' : 'var(--accent-soft)';
  return (
    <div className="card" style={{ height: `${METRIC_CARD_H}px`, padding: '20px', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        width: '44px', height: '44px', borderRadius: '12px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: toneSoft, color: toneColor, marginBottom: '12px',
      }}>
        {icon}
      </div>
      <Tooltip content={tooltip}>
        <div style={{ fontSize: '12px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, cursor: tooltip ? 'help' : 'default', width: 'fit-content' }}>{label}</div>
      </Tooltip>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: '32px', fontWeight: 700, marginTop: '2px', lineHeight: 1.1 }}>{value}</div>
      <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
        {trend !== null && trend !== undefined && (
          <Tooltip content="Compared with the previous 14-day period">
            <div style={{ fontSize: '12px', fontWeight: 600, color: trend >= 0 ? 'var(--ok)' : 'var(--err)', width: 'fit-content', cursor: 'help' }}>
              {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}% <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>vs previous 14 days</span>
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
  if (total === 0) return null;
  const r = 60;
  const circumference = 2 * Math.PI * r;
  const reelFrac = reelCount / total;
  const reelLen = circumference * reelFrac;
  const gap = 3; // surface-color gap between the two segments, both ends
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '28px', flex: 1 }}>
      <svg width="160" height="160" viewBox="0 0 160 160" style={{ flexShrink: 0 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-2)', minWidth: 0 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: 'var(--accent)', display: 'inline-block', flexShrink: 0 }} />
            Reel reports
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: '20px', fontWeight: 700 }}>{reelCount.toLocaleString()}</span>
            <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>{Math.round(reelFrac * 100)}%</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-2)', minWidth: 0 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: 'var(--ok)', display: 'inline-block', flexShrink: 0 }} />
            Profile reports
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: '20px', fontWeight: 700 }}>{profileCount.toLocaleString()}</span>
            <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>{Math.round((1 - reelFrac) * 100)}%</span>
          </div>
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
  const [planCreditsTotal, setPlanCreditsTotal] = useState(null);

  useEffect(() => {
    apiFetch('/me/stats')
      .then((res) => { setData(res); setError(''); })
      .catch((err) => setError(err.message));
  }, []);

  // Public endpoint, same one Pricing.jsx reads -- no admin route, no
  // separate source of truth to drift out of sync with what a client
  // actually sees when they go to upgrade.
  useEffect(() => {
    if (user?.plan === 'unlimited') return;
    if (user?.plan === 'free' || !user?.plan) { setPlanCreditsTotal(FREE_TIER_CREDITS); return; }
    apiFetch('/pricing/plans')
      .then((res) => {
        const plan = (res.plans || []).find((p) => p.id === user.plan);
        setPlanCreditsTotal(plan ? plan.credits : FREE_TIER_CREDITS);
      })
      .catch(() => setPlanCreditsTotal(null));
  }, [user?.plan]);

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

  const daily = data.activity14Days || [];
  const maxTotal = Math.max(...daily.map((d) => d.total), 1);
  const periodTotal = daily.reduce((sum, d) => sum + d.total, 0);
  const activeDays = daily.filter((d) => d.total > 0).length;
  const busiestDay = daily.reduce((best, d) => (d.total > (best?.total || 0) ? d : best), null);
  const hasActivity = periodTotal > 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const hasReports = (data.totalCount || 0) > 0;
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
      {/* Header: greeting + subtitle left, fixed-window date badge and the
          two report actions right. The date badge is a plain label, not a
          working dropdown -- /me/stats has no query-param range to select
          from, so a clickable selector here would promise a filter that
          does not exist. All three controls share the same 48px height. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 600 }}>
            {greeting}, {user?.username} <span aria-hidden="true">👋</span>
          </h1>
          <p style={{ color: 'var(--text-2)', fontSize: '14px' }}>Here's what's happening in your Reelytic workspace.</p>
        </div>
        <div className="rl-dashboard-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span className="chip" style={{ height: '48px', padding: '0 16px', gap: '8px', fontSize: '13px' }}>
            <CalendarIcon size={14} />Last 14 days
          </span>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/reels')} style={{ gap: '8px', height: '48px', padding: '0 20px' }}>
            <PlusIcon size={16} />New Reel Report
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/profiles')} style={{ gap: '8px', height: '48px', padding: '0 20px' }}>
            <PlusIcon size={16} />New Profile Report
          </button>
        </div>
      </div>

      {/* 4 equal metric cards -- see METRIC_CARD_H, all identical height regardless of content. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px' }} className="rl-dashboard-metrics">
        <MetricCard
          icon={<ReelIcon size={20} />} tone="accent" label="Reel Reports"
          value={data.reelCount.toLocaleString()} trend={trends.reelCount}
          tooltip="Reel links processed in the last 14 days"
        />
        <MetricCard
          icon={<ProfileIcon size={20} />} tone="ok" label="Profile Reports"
          value={data.profileCount.toLocaleString()} trend={trends.profileCount}
          tooltip="Profile links processed in the last 14 days"
        />
        <MetricCard
          icon={<LayersIcon size={20} />} tone="info" label="Total Processed"
          value={data.totalCount.toLocaleString()} trend={trends.totalCount}
          tooltip="Total reel and profile links processed during the selected period"
        />
        <MetricCard
          icon={<TrendingUpIcon size={20} />} tone="warn" label="Success Rate"
          value={`${data.successRate}%`} trend={trends.successRate}
          tooltip="Percentage of submitted links successfully processed"
        />
      </div>

      {!hasReports ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--s7)', marginBottom: 'var(--s4)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>No reports yet</div>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>Run your first Reel or Profile report to start seeing workspace activity.</p>
          <div style={{ display: 'flex', gap: 'var(--s3)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/reels')}>+ New Reel Report</button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate('/profiles')}>+ New Profile Report</button>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 600 }}>
                  Activity (last 14 days)
                </h3>
                {hasActivity && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', fontSize: '12px', color: 'var(--text-2)' }}>
                    <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{periodTotal.toLocaleString()}</strong> processed</span>
                    <span>Active <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{activeDays}/14</strong> days</span>
                    {busiestDay && busiestDay.total > 0 && (
                      <span>Busiest: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{formatDayKey(busiestDay.date)}</strong></span>
                    )}
                  </div>
                )}
              </div>
              {!hasActivity ? (
                <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>No activity in this window yet.</div>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 'var(--s4)', marginBottom: 'var(--s3)', fontSize: '12px', color: 'var(--text-2)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'var(--accent)', display: 'inline-block' }} />Reel reports
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'var(--ok)', display: 'inline-block' }} />Profile reports
                    </span>
                  </div>
                  {/* Bar height is a PERCENTAGE of its own flex:1 sub-container,
                      not a hardcoded pixel cap against a guessed track height --
                      a fixed 130px cap here is exactly what overflowed the card
                      (the value label got pushed up into the legend row above)
                      whenever the actual available track height came out
                      shorter than 130px. A percentage of a flex-computed
                      container can never exceed the space that's really there. */}
                  <div className="rl-chart-track" style={{ width: '100%', flex: 1, minHeight: 0, display: 'flex', gap: '8px', paddingBottom: '24px', borderBottom: '1px solid var(--border)' }}>
                    {daily.map((d, i) => {
                      const reelPct = maxTotal > 0 ? (d.reels / maxTotal) * 100 : 0;
                      const profilePct = maxTotal > 0 ? (d.profiles / maxTotal) * 100 : 0;
                      const dateLabel = formatDayKey(d.date);
                      const bar = (
                        <div style={{ width: '100%', maxWidth: '28px', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                          {d.profiles > 0 && <div style={{ width: '100%', height: `${Math.max(profilePct, 3)}%`, backgroundColor: 'var(--ok)', borderRadius: '3px 3px 0 0', transition: 'height 300ms ease' }} />}
                          {d.reels > 0 && <div style={{ width: '100%', height: `${Math.max(reelPct, 3)}%`, backgroundColor: 'var(--accent)', borderRadius: d.profiles > 0 ? 0 : '3px 3px 0 0', transition: 'height 300ms ease' }} />}
                          {d.total === 0 && <div style={{ width: '100%', height: '2px', backgroundColor: 'var(--border)', flexShrink: 0 }} />}
                        </div>
                      );
                      return (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-data)', fontSize: '10px', color: 'var(--text-3)', marginBottom: '4px', minHeight: '13px', flexShrink: 0 }}>{d.total || ''}</div>
                          {d.total > 0 ? (
                            <Tooltip
                              content={<TooltipRows heading={dateLabel} rows={[
                                { color: 'var(--accent)', label: 'Reel reports', value: d.reels },
                                { color: 'var(--ok)', label: 'Profile reports', value: d.profiles },
                              ]} />}
                              style={{ width: '100%', flex: 1, minHeight: 0 }}
                            >
                              {bar}
                            </Tooltip>
                          ) : bar}
                          <div style={{ fontFamily: 'var(--font-data)', fontSize: '9px', color: 'var(--text-3)', transform: 'rotate(-45deg)', whiteSpace: 'nowrap', marginTop: '10px', flexShrink: 0 }}>{d.date.slice(5)}</div>
                        </div>
                      );
                    })}
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
                  <div className="rl-table-scroll" style={{ flex: 1 }}>
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
                <InsightRow
                  icon={<TrendingUpIcon size={16} />}
                  tone="ok"
                  title={`Your success rate is ${data.successRate}%`}
                  detail={`${data.successCount ?? data.totalCount}/${data.totalCount} links processed successfully.`}
                />
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
                    detail={`${activeDays} of the last 14 days had activity, ${periodTotal.toLocaleString()} processed in total.`}
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
