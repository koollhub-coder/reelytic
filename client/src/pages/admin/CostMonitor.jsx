import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { BrandLoader } from '../../components/BrandLoader';
import { PipelineModeBanner } from '../../components/PipelineModeBanner';

const REFRESH_MS = 60000;

function inr(n) {
    if (n == null) return '-';
    return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
function usd(n, dp = 4) {
    if (n == null) return '-';
    return `$${n.toFixed(dp)}`;
}

export function CostMonitor() {
    const showToast = useToast();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [editModel, setEditModel] = useState(null);
    const [saving, setSaving] = useState(false);
    const [currency, setCurrency] = useState('INR');

    const load = useCallback(() => {
        apiFetch('/admin/cost-monitor')
            .then((res) => { setData(res); setError(''); })
            .catch((err) => setError(err.message));
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, REFRESH_MS);
        return () => clearInterval(id);
    }, [load]);

    const startEdit = () => setEditModel({ ...data.model });
    const cancelEdit = () => setEditModel(null);
    const saveModel = async () => {
        setSaving(true);
        try {
            await apiFetch('/admin/cost-monitor', { method: 'PUT', body: JSON.stringify({ model: editModel }) });
            showToast('Cost baseline updated', 'ok');
            setEditModel(null);
            load();
        } catch (err) {
            showToast(err.message || 'Could not save', 'err');
        } finally {
            setSaving(false);
        }
    };

    if (error) {
        return (
            <div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Cost Monitor</h1>
                <div className="card" style={{ color: 'var(--err)' }}>{error}</div>
            </div>
        );
    }

    if (!data) return <BrandLoader message="Loading cost data..." />;

    const rate = data.usdToInr;

    // A single toggle drives every money figure on this page, USD-native
    // baselines and INR-native plan prices alike, so the admin only ever
    // reads one currency at a time instead of two mixed together.
    const fromUsd = (n, dp = 4) => (currency === 'INR' && rate ? inr(n * rate) : usd(n, dp));
    const fromInr = (n) => (currency === 'USD' && rate ? usd(n / rate, 2) : inr(n));

    const labelStyle = { fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', fontWeight: 600 };
    const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--s5)' };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s2)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Cost Monitor</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                        <button
                            type="button"
                            onClick={() => setCurrency('INR')}
                            style={{ padding: '4px 12px', border: 'none', background: currency === 'INR' ? 'var(--accent)' : 'transparent', color: currency === 'INR' ? '#fff' : 'var(--text)', cursor: 'pointer' }}
                        >
                            INR
                        </button>
                        <button
                            type="button"
                            onClick={() => setCurrency('USD')}
                            disabled={!rate}
                            title={!rate ? 'Live rate unavailable right now' : ''}
                            style={{ padding: '4px 12px', border: 'none', background: currency === 'USD' ? 'var(--accent)' : 'transparent', color: currency === 'USD' ? '#fff' : 'var(--text)', cursor: rate ? 'pointer' : 'not-allowed', opacity: rate ? 1 : 0.5 }}
                        >
                            USD
                        </button>
                    </div>
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>Refreshes every 60s · {rate ? `1 USD = ₹${rate.toFixed(2)}` : 'INR rate unavailable'}</span>
                </div>
            </div>
            <PipelineModeBanner mode={data.profilePipelineMode} info={data.profilePipelineInfo} />
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s6)', maxWidth: '60ch' }}>
                Real per-report cost vs. what you charge. Baselines come from verified test runs; "live avg" is computed from your actual runs this billing cycle. Profile numbers below reflect whichever scan method is currently active.
            </p>

            {/* Headline cost cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
                <div style={cardStyle}>
                    <div style={labelStyle}>Cost / 1,000 reels</div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '28px', fontWeight: 700, marginTop: 6 }}>
                        {fromUsd(data.per1kReelsUsd, 2)}
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>{fromUsd(data.costPerReport.reelUsd)} / reel</div>
                </div>
                <div style={cardStyle}>
                    <div style={labelStyle}>Cost / 1,000 profiles</div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '28px', fontWeight: 700, marginTop: 6 }}>
                        {fromUsd(data.per1kProfilesUsd, 2)}
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>{fromUsd(data.costPerReport.profileUsd)} / profile</div>
                </div>
                <div style={cardStyle}>
                    <div style={labelStyle}>Per profile report</div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '28px', fontWeight: 700, marginTop: 6 }}>{fromUsd(data.costPerReport.profileUsd, 2)}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
                        {data.profilePipelineMode === 'v2'
                            ? `${data.model.profilePostsFetchedV2} posts fetched, followers bundled`
                            : `${data.model.profilePostsPerReport} posts + 1 follower lookup`}
                    </div>
                </div>
            </div>

            {/* Per-step breakdown */}
            <div style={{ ...cardStyle, marginBottom: 'var(--s6)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s4)' }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Per-step rates</h3>
                    {!editModel && <button type="button" className="btn btn-secondary" onClick={startEdit}>Edit baselines</button>}
                </div>
                <div className="rl-table-scroll"><table className="data-table">
                    <thead>
                        <tr>
                            <th>Scan step</th>
                            <th>Unit</th>
                            <th className="numeric">Baseline</th>
                            <th className="numeric">Live avg (this cycle)</th>
                            <th>Worked out from</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.actors.map((a) => {
                            const drift = a.liveAvgUsd != null && a.baselineUsd > 0
                                ? ((a.liveAvgUsd - a.baselineUsd) / a.baselineUsd) * 100
                                : null;
                            return (
                                <tr key={a.id}>
                                    <td style={{ fontWeight: 600 }}>{a.label}</td>
                                    <td style={{ color: 'var(--text-2)' }}>{a.unit}</td>
                                    <td className="numeric mono">{fromUsd(a.baselineUsd)}</td>
                                    <td className="numeric mono">
                                        {a.liveAvgUsd != null
                                            ? fromUsd(a.liveAvgUsd)
                                            : (
                                                <span style={{ color: 'var(--text-3)' }}>
                                                    {a.unavailableReason === 'coverage' ? 'not measurable'
                                                        : a.unavailableReason === 'no-units' ? 'no items to divide by'
                                                            : 'no runs yet'}
                                                </span>
                                            )}
                                        {drift != null && Math.abs(drift) >= 15 && (
                                            <span style={{ marginLeft: 6, color: drift > 0 ? 'var(--err)' : 'var(--ok)', fontSize: 'var(--fs-xs)' }}>
                                                {drift > 0 ? '▲' : '▼'} {Math.abs(drift).toFixed(0)}%
                                            </span>
                                        )}
                                    </td>
                                    {/* Showing the working. A live rate is only trustworthy if
                                        you can see what it was divided by, and this is exactly
                                        where the old per-run/per-item mismatch hid. */}
                                    <td style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                                        {a.liveAvgUsd != null
                                            ? `${fromUsd(a.liveSpendUsd, 2)} over ${a.liveUnits.toLocaleString()} ${a.unit.replace('per ', '')}${a.liveUnits === 1 ? '' : 's'}`
                                            : '-'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table></div>
                {data.liveCoverage != null && data.liveCoverage < 0.6 && (
                    <div style={{ marginTop: 'var(--s3)', padding: 'var(--s3) var(--s4)', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)', lineHeight: 1.6 }}>
                        <strong style={{ color: 'var(--text)' }}>Live per-step rates are not measurable this cycle.</strong>{' '}
                        Apify only lists {fromUsd(data.liveObservedUsd, 2)} of runs against a real cycle bill of{' '}
                        {fromUsd(data.cycleTotalUsd, 2)} ({Math.round(data.liveCoverage * 100)}% visible), because pay-per-result
                        calls do not all appear as individual runs. A rate worked out from that slice would not reflect what you
                        are actually paying, so it is withheld rather than shown. The baselines beside it are real measured rates
                        and are what every cost figure in the product uses. Per-client spend on Usage &amp; Spend is unaffected.
                    </div>
                )}
                {editModel && (
                    <div style={{ marginTop: 'var(--s4)', padding: 'var(--s4)', background: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>
                        <div style={{ ...labelStyle, marginBottom: 'var(--s3)' }}>Edit baseline costs (USD)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--s3)' }}>
                            {[
                                ['usdPerReel', 'Reel scrape (basic actor)'],
                                ['usdPerReelAnalytics', 'Reel analytics (batched, active)'],
                                ['usdPerProfilePost', 'Profile post scrape (Standard)'],
                                ['profilePostsPerReport', 'Posts per profile report (Standard)'],
                                ['usdPerFollowerLookup', 'Follower lookup (Standard)'],
                                ['usdPerProfileReelResult', 'Profile reels scraper (Express, per result)'],
                                ['profilePostsFetchedV2', 'Posts fetched per profile (Express)'],
                                ['creditsPerReel', 'Credits per reel'],
                                ['creditsPerProfile', 'Credits per profile'],
                            ].map(([key, label]) => (
                                <div key={key}>
                                    <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>{label}</label>
                                    <input
                                        type="number"
                                        step="0.0001"
                                        className="input-field"
                                        style={{ width: '100%' }}
                                        value={editModel[key]}
                                        onChange={(e) => setEditModel({ ...editModel, [key]: Number(e.target.value) || 0 })}
                                    />
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--s3)', marginTop: 'var(--s4)' }}>
                            <button type="button" className="btn btn-primary" disabled={saving} onClick={saveModel}>
                                {saving ? <span className="btn-spinner" /> : 'Save baselines'}
                            </button>
                            <button type="button" className="btn btn-ghost" onClick={cancelEdit}>Cancel</button>
                        </div>
                    </div>
                )}
            </div>

            {/* Per-plan margins */}
            <div style={cardStyle}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>Per-plan margins</h3>
                <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
                    Best case = user spends all credits on reels. Worst case = all on profiles (costs more). A plan is healthy if even the worst case clears 40% margin.
                </p>
                <div className="rl-table-scroll"><table className="data-table">
                    <thead>
                        <tr>
                            <th>Plan</th>
                            <th className="numeric">Price</th>
                            <th className="numeric">Worst-case cost</th>
                            <th className="numeric">Worst-case margin</th>
                            <th className="numeric">Best-case margin</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.planMargins.map((p) => (
                            <tr key={p.id}>
                                <td style={{ fontWeight: 600 }}>{p.name}</td>
                                <td className="numeric mono">{fromInr(p.priceInr)}</td>
                                <td className="numeric mono">{fromInr(p.worstCaseCostInr)}</td>
                                <td className="numeric mono" style={{ fontWeight: 700, color: p.worstCaseMarginPct >= 40 ? 'var(--ok)' : p.worstCaseMarginPct >= 0 ? 'var(--warn)' : 'var(--err)' }}>
                                    {p.worstCaseMarginPct != null ? `${p.worstCaseMarginPct}%` : '-'}
                                </td>
                                <td className="numeric mono" style={{ color: 'var(--text-2)' }}>{p.bestCaseMarginPct != null ? `${p.bestCaseMarginPct}%` : '-'}</td>
                                <td>
                                    {p.worstCaseMarginPct == null ? (
                                        <span className="chip">-</span>
                                    ) : p.worstCaseMarginPct >= 40 ? (
                                        <span className="chip ok">Healthy</span>
                                    ) : p.worstCaseMarginPct >= 0 ? (
                                        <span className="chip warn">Thin</span>
                                    ) : (
                                        <span className="chip err">Losing money</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table></div>
            </div>
        </div>
    );
}
