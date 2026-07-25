import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { StatCard } from '../../components/StatCard';
import { Shimmer } from '../../components/Shimmer';

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
        <Shimmer height="120px" />
        <Shimmer height="300px" />
      </div>
    );
  }

  const stats = data?.stats || { reelJobs: 0, profileJobs: 0, linksProcessed: 0, successRate: 100 };
  const activity = data?.activity14Days || [];
  const maxCount = Math.max(...activity.map(a => a.count), 1);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s6)' }}>Admin Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
        <StatCard label="Reel Jobs" value={stats.reelJobs} />
        <StatCard label="Profile Jobs" value={stats.profileJobs} />
        <StatCard label="Total Links Processed" value={stats.linksProcessed} />
        <StatCard label="Success Rate" value={`${stats.successRate}%`} accent={true} />
      </div>

      {/* Hand-rolled SVG Bar Chart */}
      <div className="card" style={{ marginBottom: 'var(--s6)' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)' }}>14-Day Link Processing Activity</h3>
        {activity.length === 0 ? (
          <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>No activity yet this fortnight.</div>
        ) : (
          <div className="rl-chart-track" style={{ width: '100%', height: '220px', display: 'flex', alignItems: 'flex-end', gap: '12px', paddingBottom: '24px', borderBottom: '1px solid var(--border)' }}>
            {activity.map((a, i) => {
              const heightPct = (a.count / maxCount) * 160;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }} title={`${a.date}: ${a.count} links`}>
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: '10px', color: 'var(--text-3)', marginBottom: '4px' }}>{a.count}</div>
                  <div style={{ width: '100%', maxWidth: '36px', height: `${Math.max(heightPct, 4)}px`, backgroundColor: 'var(--accent)', borderRadius: '4px 4px 0 0', transition: 'height 300ms ease' }} />
                  <div style={{ fontFamily: 'var(--font-data)', fontSize: '9px', color: 'var(--text-3)', transform: 'rotate(-45deg)', whiteSpace: 'nowrap', marginTop: '12px' }}>{a.date.slice(5)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
