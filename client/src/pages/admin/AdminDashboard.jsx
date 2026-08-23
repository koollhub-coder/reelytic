import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { StatCard } from '../../components/StatCard';
import { BrandLoader } from '../../components/BrandLoader';
import { Tooltip, TooltipRows } from '../../components/Tooltip';
import { formatDate, formatDateTime, formatDayKey } from '../../utils/date';

export function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/admin/overview')
      .then(res => setData(res))
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <BrandLoader message="Loading dashboard..." />
    );
  }

  const stats = data?.stats || { reelJobs: 0, profileJobs: 0, linksProcessed: 0, successRate: 100 };
  const activity = data?.activity14Days || [];
  const maxCount = Math.max(...activity.map(a => a.count), 1);
  const periodTotal = activity.reduce((sum, a) => sum + a.count, 0);
  const activeDays = activity.filter((a) => a.count > 0).length;
  const busiestDay = activity.reduce((best, a) => (a.count > (best?.count || 0) ? a : best), null);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s6)' }}>Admin Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
        <StatCard label="Reel Jobs" value={stats.reelJobs} />
        <StatCard label="Profile Jobs" value={stats.profileJobs} />
        <StatCard label="Total Links Processed" value={stats.linksProcessed} />
        <StatCard label="Success Rate" value={`${stats.successRate}%`} accent={true} />
      </div>

      {/* 14-day activity chart, split by report type -- mirrors the client dashboard's chart */}
      <div className="card" style={{ marginBottom: 'var(--s6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
            Activity (last 14 days), all clients
          </h3>
          {periodTotal > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
              <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{periodTotal.toLocaleString()}</strong> processed</span>
              <span>Active <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{activeDays}/14</strong> days</span>
              {busiestDay && busiestDay.count > 0 && (
                <span>Busiest: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{formatDayKey(busiestDay.date)}</strong></span>
              )}
            </div>
          )}
        </div>
        {activity.every((a) => a.count === 0) ? (
          <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>No activity yet this fortnight.</div>
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
            <div className="rl-chart-track" style={{ width: '100%', height: '220px', display: 'flex', alignItems: 'flex-end', gap: '12px', paddingBottom: '24px', borderBottom: '1px solid var(--border)' }}>
              {activity.map((a, i) => {
                const reelPct = (a.reels / maxCount) * 160;
                const profilePct = (a.profiles / maxCount) * 160;
                const dateLabel = formatDayKey(a.date);
                const bar = (
                  <div style={{ width: '100%', maxWidth: '36px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    {a.profiles > 0 && <div style={{ width: '100%', height: `${Math.max(profilePct, 3)}px`, backgroundColor: 'var(--ok)', borderRadius: '4px 4px 0 0', transition: 'height 300ms ease' }} />}
                    {a.reels > 0 && <div style={{ width: '100%', height: `${Math.max(reelPct, 3)}px`, backgroundColor: 'var(--accent)', borderRadius: a.profiles > 0 ? 0 : '4px 4px 0 0', transition: 'height 300ms ease' }} />}
                    {a.count === 0 && <div style={{ width: '100%', height: '2px', backgroundColor: 'var(--border)' }} />}
                  </div>
                );
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '10px', color: 'var(--text-3)', marginBottom: '4px' }}>{a.count || ''}</div>
                    {a.count > 0 ? (
                      <Tooltip
                        content={<TooltipRows heading={dateLabel} rows={[
                          { color: 'var(--accent)', label: 'Reel reports', value: a.reels },
                          { color: 'var(--ok)', label: 'Profile reports', value: a.profiles },
                        ]} />}
                        style={{ width: '100%' }}
                      >
                        {bar}
                      </Tooltip>
                    ) : bar}
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '9px', color: 'var(--text-3)', transform: 'rotate(-45deg)', whiteSpace: 'nowrap', marginTop: '12px' }}>{a.date.slice(5)}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
