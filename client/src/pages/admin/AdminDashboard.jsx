import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { StatCard } from '../../components/StatCard';
import { BrandLoader } from '../../components/BrandLoader';
import { Select } from '../../components/Select';
import { ActivityChart } from '../../components/ActivityChart';
import { CalendarIcon, UsersIcon, ActivityIcon, ClockIcon } from '../../components/Icon';
import { formatDayKey, formatAge } from '../../utils/date';

// Matches server/routes/admin.routes.js's OVERVIEW_RANGE_DAYS, which is
// itself the same whitelist the personal dashboard uses -- one picker, same
// four choices, wherever a range is offered in the app.
const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export function AdminDashboard() {
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(14);

  useEffect(() => {
    if (data !== null) setRefreshing(true);
    apiFetch(`/admin/overview?days=${days}`)
      .then(res => setData(res))
      .catch(() => { })
      .finally(() => setRefreshing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  if (!data) {
    return (
      <BrandLoader message="Loading dashboard..." />
    );
  }

  const stats = data?.stats || { reelJobs: 0, profileJobs: 0, linksProcessed: 0, successRate: 100, totalClients: 0, activeClients: 0 };
  const activity = data?.activityByDay || [];
  const runningJobs = data?.runningJobs || [];
  const recentLogins = data?.recentLogins || [];
  const periodTotal = activity.reduce((sum, a) => sum + a.count, 0);
  const activeDays = activity.filter((a) => a.count > 0).length;
  const busiestDay = activity.reduce((best, a) => (a.count > (best?.count || 0) ? a : best), null);

  return (
    <div style={{ opacity: refreshing ? 0.6 : 1, transition: 'opacity 150ms ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Admin Dashboard</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CalendarIcon size={14} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          <Select value={String(days)} onChange={(v) => setDays(Number(v))} options={RANGE_OPTIONS} disabled={refreshing} style={{ minWidth: '150px' }} />
          {refreshing && <span className="rl-inline-spinner" aria-label="Updating" />}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
        <StatCard label="Total Clients" value={stats.totalClients} />
        <StatCard label="Active Clients (period)" value={stats.activeClients} sub={stats.totalClients > 0 ? `${Math.round((stats.activeClients / stats.totalClients) * 100)}% of all clients` : null} />
        <StatCard label="Reel Jobs" value={stats.reelJobs} />
        <StatCard label="Profile Jobs" value={stats.profileJobs} />
        <StatCard label="Total Links Processed" value={stats.linksProcessed} />
        <StatCard label="Success Rate" value={`${stats.successRate}%`} accent={true} />
      </div>

      {/* Activity chart, split by report type -- mirrors the client dashboard's chart */}
      <div className="card" style={{ marginBottom: 'var(--s6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
            Activity (last {days} days), all clients
          </h3>
          {periodTotal > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
              <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{periodTotal.toLocaleString()}</strong> processed</span>
              <span>Active <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{activeDays}/{days}</strong> days</span>
              {busiestDay && busiestDay.count > 0 && (
                <span>Busiest: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{formatDayKey(busiestDay.date)}</strong></span>
              )}
            </div>
          )}
        </div>
        {activity.every((a) => a.count === 0) ? (
          <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>No activity in this period yet.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 'var(--s4)', marginBottom: 'var(--s3)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'var(--accent)', display: 'inline-block' }} />Reel reports
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: 'var(--ok)', display: 'inline-block' }} />Profile reports
              </span>
            </div>
            <ActivityChart data={activity} height={260} />
          </>
        )}
      </div>

      {/* Live ops: what's running right now, and who's actually been signing
          in -- both were already fetched by /overview and simply thrown
          away by this page before. An admin's real day-to-day question is
          "is anything stuck" and "who's using this," not just a chart. */}
      <div className="rl-admin-overview-lower" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)' }}>
        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)' }}>
            <ActivityIcon size={16} style={{ color: 'var(--accent)' }} />
            Running right now
          </h3>
          {runningJobs.length === 0 ? (
            <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s5)' }}>Nothing is running -- the queue is idle.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
              {runningJobs.map((j) => (
                <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 'var(--s3)', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{j.owner || 'Unknown client'}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'capitalize' }}>{j.type} report</div>
                  </div>
                  {j.counts && (
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', fontFamily: 'var(--font-data)' }}>
                      {(j.counts.done ?? 0)}/{j.counts.total ?? '?'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)' }}>
            <UsersIcon size={16} style={{ color: 'var(--accent)' }} />
            Recent sign-ins
          </h3>
          {recentLogins.length === 0 ? (
            <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s5)' }}>No sign-in activity recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
              {recentLogins.slice(0, 6).map((l, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 'var(--s3)', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{l.username}</div>
                    {l.device && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>{l.device}</div>}
                  </div>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--fs-xs)', color: l.success ? 'var(--text-2)' : 'var(--err)' }}>
                    <ClockIcon size={12} />{formatAge(l.at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
