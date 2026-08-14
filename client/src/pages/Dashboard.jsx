import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BrandLoader } from '../components/BrandLoader';
import { formatDate, formatDateTime, formatDayKey } from '../utils/date';

const cardStyle = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-lg)',
    padding: 'var(--s5)',
};
const labelStyle = {
    fontSize: 'var(--fs-xs)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--text-3)',
    fontWeight: 600,
};
const STATUS_LABELS = {
    preview: 'Not started',
    running: 'Running',
    paused: 'Paused',
    done: 'Complete',
};

export function Dashboard() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        apiFetch('/me/stats')
            .then((res) => { setData(res); setError(''); })
            .catch((err) => setError(err.message));
    }, []);

    if (error) {
        return (
            <div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Dashboard</h1>
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
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

    return (
        <div>
            <div style={{ marginBottom: 'var(--s6)' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 4 }}>
                    {greeting}, {user?.username}
                </h1>
                <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>Here's what you've processed with Reelytic.</p>
            </div>

            {/* Headline stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
                <div style={cardStyle}>
                    <div style={labelStyle}>Reel Reports</div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '30px', fontWeight: 700, marginTop: 6 }}>{data.reelCount.toLocaleString()}</div>
                </div>
                <div style={cardStyle}>
                    <div style={labelStyle}>Profile Reports</div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '30px', fontWeight: 700, marginTop: 6 }}>{data.profileCount.toLocaleString()}</div>
                </div>
                <div style={cardStyle}>
                    <div style={labelStyle}>Total Processed</div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '30px', fontWeight: 700, marginTop: 6 }}>{data.totalCount.toLocaleString()}</div>
                </div>
                <div style={cardStyle}>
                    <div style={labelStyle}>Success Rate</div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '30px', fontWeight: 700, marginTop: 6, color: data.successRate >= 90 ? 'var(--ok)' : data.successRate >= 70 ? 'var(--warn)' : 'var(--err)' }}>
                        {data.successRate}%
                    </div>
                </div>
            </div>

            {/* Quick actions */}
            <div style={{ display: 'flex', gap: 'var(--s3)', marginBottom: 'var(--s6)', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-primary" onClick={() => navigate('/reels')}>+ New Reel Report</button>
                <button type="button" className="btn btn-secondary" onClick={() => navigate('/profiles')}>+ New Profile Report</button>
                <button type="button" className="btn btn-ghost" onClick={() => navigate('/history')}>View full history</button>
            </div>

            {/* 14-day activity chart */}
            <div style={{ ...cardStyle, marginBottom: 'var(--s6)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
                        Activity (last 14 days)
                    </h3>
                    {periodTotal > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
                            <span><strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{periodTotal.toLocaleString()}</strong> processed</span>
                            <span>Active <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{activeDays}/14</strong> days</span>
                            {busiestDay && busiestDay.total > 0 && (
                                <span>Busiest: <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-data)' }}>{formatDayKey(busiestDay.date)}</strong></span>
                            )}
                        </div>
                    )}
                </div>
                {daily.every((d) => d.total === 0) ? (
                    <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>No activity yet, run your first report to see it here.</div>
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
                        <div className="rl-chart-track" style={{ width: '100%', height: '180px', display: 'flex', alignItems: 'flex-end', gap: '8px', paddingBottom: '24px', borderBottom: '1px solid var(--border)' }}>
                            {daily.map((d, i) => {
                                const reelPct = (d.reels / maxTotal) * 130;
                                const profilePct = (d.profiles / maxTotal) * 130;
                                const dateLabel = formatDayKey(d.date);
                                return (
                                    // Native title= tooltips don't theme (always the browser's own
                                    // unstyled black box, wrong in dark mode) and effectively never
                                    // show on touch devices at all -- chart-bar-wrap/chart-tooltip is
                                    // the app's own themed equivalent (already defined in
                                    // components.css, previously unused anywhere).
                                    <div key={i} className="chart-bar-wrap" tabIndex={0} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end', outline: 'none' }}>
                                        {d.total > 0 && (
                                            <div className="chart-tooltip">
                                                <div className="chart-tooltip-date">{dateLabel}</div>
                                                <div className="chart-tooltip-row"><span className="chart-tooltip-dot" style={{ backgroundColor: 'var(--accent)' }} />{d.reels} reel {d.reels === 1 ? 'report' : 'reports'}</div>
                                                <div className="chart-tooltip-row"><span className="chart-tooltip-dot" style={{ backgroundColor: 'var(--ok)' }} />{d.profiles} profile {d.profiles === 1 ? 'report' : 'reports'}</div>
                                            </div>
                                        )}
                                        <div style={{ fontFamily: 'var(--font-data)', fontSize: '10px', color: 'var(--text-3)', marginBottom: '4px', minHeight: '13px' }}>{d.total || ''}</div>
                                        <div style={{ width: '100%', maxWidth: '28px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                            {d.profiles > 0 && <div style={{ width: '100%', height: `${Math.max(profilePct, 3)}px`, backgroundColor: 'var(--ok)', borderRadius: '3px 3px 0 0', transition: 'height 300ms ease' }} />}
                                            {d.reels > 0 && <div style={{ width: '100%', height: `${Math.max(reelPct, 3)}px`, backgroundColor: 'var(--accent)', borderRadius: d.profiles > 0 ? 0 : '3px 3px 0 0', transition: 'height 300ms ease' }} />}
                                            {d.total === 0 && <div style={{ width: '100%', height: '2px', backgroundColor: 'var(--border)' }} />}
                                        </div>
                                        <div style={{ fontFamily: 'var(--font-data)', fontSize: '9px', color: 'var(--text-3)', transform: 'rotate(-45deg)', whiteSpace: 'nowrap', marginTop: '10px' }}>{d.date.slice(5)}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            {/* Recent reports */}
            <div style={cardStyle}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Recent reports</h3>
                {(!data.recentJobs || data.recentJobs.length === 0) ? (
                    <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s5)' }}>No reports yet.</div>
                ) : (
                    <div className="rl-table-scroll"><table className="data-table">
                        <thead>
                            <tr>
                                <th>Type</th>
                                <th>File</th>
                                <th className="numeric">Rows</th>
                                <th>Status</th>
                                <th>Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.recentJobs.map((j) => (
                                <tr key={j.id} style={{ cursor: 'pointer' }} onClick={() => navigate(j.type === 'reel' ? '/reels' : '/profiles')}>
                                    <td><span className="chip" style={{ textTransform: 'uppercase' }}>{j.type}</span></td>
                                    <td style={{ color: 'var(--text-2)' }}>{j.fileName || 'Pasted links'}</td>
                                    <td className="numeric mono">{j.counts?.total ?? '-'}</td>
                                    <td>
                                        <span className={`chip ${j.status === 'done' ? 'ok' : j.status === 'running' ? 'accent' : 'warn'}`}>
                                            {STATUS_LABELS[j.status] || j.status}
                                        </span>
                                    </td>
                                    <td className="mono" style={{ color: 'var(--text-3)' }}>{formatDate(j.createdAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table></div>
                )}
            </div>
        </div>
    );
}