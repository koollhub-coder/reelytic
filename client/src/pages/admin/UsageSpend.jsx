import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api/client';
import { StatCard } from '../../components/StatCard';
import { BrandLoader } from '../../components/BrandLoader';
import { PipelineModeBanner } from '../../components/PipelineModeBanner';
import { Modal } from '../../components/Modal';

const REFRESH_MS = 30000;

function fmt(usd, currency, rate) {
    if (currency === 'INR' && rate) {
        const inr = usd * rate;
        return `₹${inr.toFixed(inr < 1 ? 4 : 2)}`;
    }
    return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
}

export function UsageSpend() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // Clients are Indian -- INR is the number every stakeholder here actually
    // thinks in, so it's the default, not an opt-in toggle.
    const [currency, setCurrency] = useState('INR');

    const DRILLDOWN_PAGE_SIZE = 50;
    const [drilldownUser, setDrilldownUser] = useState(null);
    const [drilldownItems, setDrilldownItems] = useState(null);
    const [drilldownLoading, setDrilldownLoading] = useState(false);
    const [drilldownError, setDrilldownError] = useState('');
    const [drilldownPage, setDrilldownPage] = useState(1);
    const [showTechnical, setShowTechnical] = useState(false);

    const openDrilldown = (username) => {
        setDrilldownUser(username);
        setDrilldownItems(null);
        setDrilldownError('');
        setDrilldownPage(1);
        setDrilldownLoading(true);
        apiFetch(`/admin/usage/by-user/${encodeURIComponent(username)}`)
            .then((res) => setDrilldownItems(res.items || []))
            .catch((err) => setDrilldownError(err.message || "Couldn't load this client's items"))
            .finally(() => setDrilldownLoading(false));
    };

    const load = useCallback(() => {
        apiFetch('/admin/usage')
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
            <BrandLoader message="Loading usage data..." />
        );
    }

    if (error) {
        return (
            <div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Usage & Spend</h1>
                <div className="card" style={{ color: 'var(--err)' }}>{error}</div>
            </div>
        );
    }

    const daily = (data.daily || []).slice(-14);
    const maxUsd = Math.max(...daily.map((d) => d.usd), 0.0001);
    const daysElapsed = daily.length || 1;
    const dailyAvgUsd = data.totalUsd / daysElapsed;
    const rate = data.usdToInr;
    const byUser = data.byUser || [];
    const unattributedUsd = data.unattributedUsd || 0;
    const showUnattributed = unattributedUsd > 0.001;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s2)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Usage & Spend</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                        <button
                            type="button"
                            onClick={() => setCurrency('INR')}
                            disabled={!rate}
                            title={!rate ? 'Live rate unavailable right now' : ''}
                            style={{ padding: '4px 12px', border: 'none', background: currency === 'INR' ? 'var(--accent)' : 'transparent', color: currency === 'INR' ? '#fff' : 'var(--text)', cursor: rate ? 'pointer' : 'not-allowed', opacity: rate ? 1 : 0.5 }}
                        >
                            INR
                        </button>
                        <button
                            type="button"
                            onClick={() => setCurrency('USD')}
                            style={{ padding: '4px 12px', border: 'none', background: currency === 'USD' ? 'var(--accent)' : 'transparent', color: currency === 'USD' ? '#fff' : 'var(--text)', cursor: 'pointer' }}
                        >
                            USD
                        </button>
                    </div>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>Refreshes every 30 seconds</span>
                </div>
            </div>

            <PipelineModeBanner mode={data.profilePipelineMode} info={data.profilePipelineInfo} />

            {currency === 'INR' && rate && (
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
                    Converted at 1 USD = ₹{rate.toFixed(2)}, updated hourly.
                </p>
            )}
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
                Live spend across your whole account for the current billing cycle. Past runs keep the totals they were recorded with, even after a scan method switch.
            </p>

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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s2)', flexWrap: 'wrap', gap: 'var(--s2)' }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
                        Spend by client
                    </h3>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>This billing cycle</span>
                </div>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s4)', maxWidth: '75ch' }}>
                    Who ran what, and what it cost, with no math needed. Figures are computed per successful report item at the exact
                    rate whichever scan method was active for it at the time. Cache hits and failed items are always ₹0.
                </p>
                {byUser.length === 0 ? (
                    <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>No client activity recorded yet this cycle.</div>
                ) : (
                    <div className="rl-table-scroll"><table className="data-table">
                        <thead>
                            <tr>
                                <th>Client</th>
                                <th className="numeric">Profile reports</th>
                                <th className="numeric">Profile spend</th>
                                <th className="numeric">Reel reports</th>
                                <th className="numeric">Reel spend</th>
                                <th className="numeric">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {byUser.map((row) => (
                                <tr
                                    key={row.username}
                                    onClick={() => openDrilldown(row.username)}
                                    style={{ cursor: 'pointer' }}
                                    title="Click to see every item and what it cost"
                                >
                                    <td style={{ fontWeight: 600, color: 'var(--accent)' }}>
                                        {row.username}
                                        {row.username === 'admin' && (
                                            <span className="chip" style={{ marginLeft: '8px', padding: '2px 8px', fontSize: '10px' }}>Internal</span>
                                        )}
                                    </td>
                                    <td className="numeric mono">{row.profileCount || '-'}</td>
                                    <td className="numeric mono">{row.profileCount ? fmt(row.profileUsd, currency, rate) : '-'}</td>
                                    <td className="numeric mono">{row.reelCount || '-'}</td>
                                    <td className="numeric mono">{row.reelCount ? fmt(row.reelUsd, currency, rate) : '-'}</td>
                                    <td className="numeric mono" style={{ fontWeight: 700 }}>{fmt(row.totalUsd, currency, rate)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table></div>
                )}
                {showUnattributed && (
                    <div style={{ marginTop: 'var(--s4)', padding: 'var(--s3) var(--s4)', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
                        <strong>Unattributed usage this cycle: {fmt(unattributedUsd, currency, rate)}.</strong> This is real spend on your account
                        that didn't come from a client's report: internal testing, direct API checks, or anything run outside the normal
                        report flow. It's the gap between the client table above and the account-wide total.
                    </div>
                )}
            </div>

            <div className="card" style={{ marginBottom: 'var(--s6)' }}>
                <div
                    onClick={() => setShowTechnical((v) => !v)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                >
                    <div>
                        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
                            Technical cost breakdown
                        </h3>
                        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: '2px' }}>
                            For debugging spend, not for client reporting. "Spend by client" above already answers who cost what.
                        </p>
                    </div>
                    <span style={{ fontSize: '13px', color: 'var(--text-3)' }}>{showTechnical ? 'Hide ▾' : 'Show ▸'}</span>
                </div>
                {showTechnical && (
                    <div style={{ marginTop: 'var(--s4)' }}>
                        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', marginBottom: 'var(--s4)', maxWidth: '75ch' }}>
                            Every report calls out to a scraping service behind the scenes, in one or more requests ("runs") depending on
                            how many links are in the batch. This table totals the real cost of those requests for the whole account this
                            billing cycle, grouped by which part of a report they paid for. <strong>Not</strong> broken down by client
                            (that's the table above) or by individual report. It also includes the "Unattributed" spend explained above, so
                            these totals will run higher than the sum of every client's number.
                        </p>
                        {(!data.byActor || data.byActor.length === 0) ? (
                            <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s6)' }}>No scan activity recorded yet this cycle.</div>
                        ) : (
                            <div className="rl-table-scroll"><table className="data-table">
                                <thead>
                                    <tr><th>What it paid for</th><th className="numeric">Requests made</th><th className="numeric">Cost</th></tr>
                                </thead>
                                <tbody>
                                    {data.byActor.map((a, i) => (
                                        <tr key={i}>
                                            <td>{a.label}</td>
                                            <td className="numeric mono">{a.runs}</td>
                                            <td className="numeric mono">{fmt(a.usd, currency, rate)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table></div>
                        )}
                    </div>
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

            <Modal isOpen={!!drilldownUser} onClose={() => setDrilldownUser(null)} title={drilldownUser ? `${drilldownUser}: every item this cycle` : ''} width="720px">
                {drilldownLoading ? (
                    <BrandLoader variant="inline" message="Loading items..." />
                ) : drilldownError ? (
                    <div style={{ color: 'var(--err)' }}>{drilldownError}</div>
                ) : !drilldownItems || drilldownItems.length === 0 ? (
                    <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s5)' }}>No items recorded for this client this cycle.</div>
                ) : (
                    <>
                        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s3)' }}>
                            {drilldownItems.length} item{drilldownItems.length === 1 ? '' : 's'} · reel items marked "measured" carry a real, per-run
                            Apify cost captured at scrape time; everything else is the measured rate for whichever method was active.
                        </p>
                        <div className="rl-table-scroll"><table className="data-table">
                            <thead>
                                <tr>
                                    <th>Link</th>
                                    <th>Type</th>
                                    <th>Method</th>
                                    <th className="numeric">Cost</th>
                                    <th>When</th>
                                </tr>
                            </thead>
                            <tbody>
                                {drilldownItems.slice((drilldownPage - 1) * DRILLDOWN_PAGE_SIZE, drilldownPage * DRILLDOWN_PAGE_SIZE).map((it, i) => (
                                    <tr key={i}>
                                        <td style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            <a href={it.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{it.resolvedUsername ? `@${it.resolvedUsername}` : it.url}</a>
                                        </td>
                                        <td style={{ textTransform: 'capitalize' }}>{it.type}</td>
                                        <td>
                                            <span className="chip" style={{ padding: '2px 8px', fontSize: '10px' }}>
                                                {it.pipelineMode || 'legacy'}{it.recordedLive ? ' · measured' : ' · estimated'}
                                            </span>
                                        </td>
                                        <td className="numeric mono">{fmt(it.costUsd, currency, rate)}</td>
                                        <td className="mono" style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>{new Date(it.at).toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table></div>
                        {drilldownItems.length > DRILLDOWN_PAGE_SIZE && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--s3)' }}>
                                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
                                    Showing {(drilldownPage - 1) * DRILLDOWN_PAGE_SIZE + 1}-{Math.min(drilldownPage * DRILLDOWN_PAGE_SIZE, drilldownItems.length)} of {drilldownItems.length}
                                </span>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-secondary" disabled={drilldownPage <= 1} onClick={() => setDrilldownPage((p) => p - 1)}>Previous</button>
                                    <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-data)' }}>
                                        Page {drilldownPage} of {Math.ceil(drilldownItems.length / DRILLDOWN_PAGE_SIZE)}
                                    </span>
                                    <button className="btn btn-secondary" disabled={drilldownPage >= Math.ceil(drilldownItems.length / DRILLDOWN_PAGE_SIZE)} onClick={() => setDrilldownPage((p) => p + 1)}>Next</button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </Modal>
        </div>
    );
}
