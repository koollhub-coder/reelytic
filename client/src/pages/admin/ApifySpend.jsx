import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api/client';
import { StatCard } from '../../components/StatCard';
import { Shimmer } from '../../components/Shimmer';

const REFRESH_MS = 30000;

function fmt(usd, currency, rate) {
    if (currency === 'INR' && rate) {
        return `₹${(usd * rate).toFixed(2)}`;
    }
    return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

export function ApifySpend() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [currency, setCurrency] = useState('USD');

    const load = useCallback(() => {
        apiFetch('/admin/apify-usage')
            .then((res) => { setData(res); setError(''); })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, REFRESH_MS);
        return () => clearInterval(id);
    }, [load]);

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
                <Shimmer height="120px" />
                <Shimmer height="300px" />
            </div>
        );
    }

    if (error) {
        return (
            <div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Apify Spend</h1>
                <div className="card" style={{ color: 'var(--err)' }}>{error}</div>
            </div>
        );
    }

    const daily = (data.daily || []).slice(-14);
    const maxUsd = Math.max(...daily.map((d) => d.usd), 0.0001);
    const daysElapsed = daily.length || 1;
    const dailyAvgUsd = data.totalUsd / daysElapsed;
    const rate = data.usdToInr;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s6)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Apify Spend</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                        <button
                            type="button"
                            onClick={() => setCurrency('USD')}
                            style={{ padding: '4px 12px', border: 'none', background: currency === 'USD' ? 'var(--accent)' : 'transparent', color: currency === 'USD' ? '#fff' : 'var(--text)', cursor: 'pointer' }}
                        >
                            USD
                        </button>
                        <button
                            type="button"
                            onClick={() => setCurrency('INR')}
                            disabled={!rate}
                            title={!rate ? 'Live rate unavailable right now' : ''}
                            style={{ padding: '4px 12px', border: 'none', background: currency === 'INR' ? 'var(--accent)' : 'transparent', color: currency === 'INR' ? '#fff' : 'var(--text)', cursor: rate ? 'pointer' : 'not-allowed', opacity: rate ? 1 : 0.5 }}
                        >
                            INR
                        </button>
                    </div>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>Auto-refreshes every 30s</span>
                </div>
            </div>

            {currency === 'INR' && rate && (
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
                    Converted at 1 USD = ₹{rate.toFixed(2)} (ECB reference rate, updates hourly)
                </p>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
                <StatCard label="This billing cycle" value={fmt(data.totalUsd, currency, rate)} accent={true} />
                <StatCard
                    label="Remaining balance"
                    value={data.remainingBalanceUsd !== null ? fmt(data.remainingBalanceUsd, currency, rate) : 'N/A'}
                />
                <StatCard label="Daily average" value={fmt(dailyAvgUsd, currency, rate)} />
                <StatCard
                    label="Cycle"
                    value={`${new Date(data.cycleStart).toLocaleDateString()} - ${new Date(data.cycleEnd).toLocaleDateString()}`}
                />
            </div>

            <div className="card" style={{ marginBottom: 'var(--s6)' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)' }}>
                    Cost by actor (this cycle)
                </h3>
                {(!data.byActor || data.byActor.length === 0) ? (
                    <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>No actor runs recorded yet this cycle.</div>
                ) : (
                    <div className="rl-table-scroll"><table className="data-table">
                        <thead>
                            <tr><th>Actor</th><th>Runs</th><th>Cost</th></tr>
                        </thead>
                        <tbody>
                            {data.byActor.map((a) => (
                                <tr key={a.actId}>
                                    <td className="mono">{a.name}</td>
                                    <td>{a.runs}</td>
                                    <td className="mono">{fmt(a.usd, currency, rate)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table></div>
                )}
            </div>

            <div className="card">
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)' }}>
                    Daily spend (last 14 days)
                </h3>
                {daily.length === 0 ? (
                    <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>No usage recorded yet this cycle.</div>
                ) : (
                    <div className="rl-chart-track" style={{ width: '100%', height: '220px', display: 'flex', alignItems: 'flex-end', gap: '12px', paddingBottom: '24px', borderBottom: '1px solid var(--border)' }}>
                        {daily.map((d, i) => {
                            const heightPct = (d.usd / maxUsd) * 160;
                            return (
                                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }} title={`${d.date}: ${fmt(d.usd, currency, rate)}`}>
                                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '10px', color: 'var(--text-3)', marginBottom: '4px' }}>{fmt(d.usd, currency, rate)}</div>
                                    <div style={{ width: '100%', maxWidth: '36px', height: `${Math.max(heightPct, 4)}px`, backgroundColor: 'var(--accent)', borderRadius: '4px 4px 0 0', transition: 'height 300ms ease' }} />
                                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '9px', color: 'var(--text-3)', transform: 'rotate(-45deg)', whiteSpace: 'nowrap', marginTop: '12px' }}>{d.date.slice(5)}</div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}