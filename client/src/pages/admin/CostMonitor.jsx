// import React, { useState, useEffect, useCallback } from 'react';
// import { apiFetch } from '../../api/client';
// import { useToast } from '../../context/ToastContext';
// import { Shimmer } from '../../components/Shimmer';

// const REFRESH_MS = 60000;

// function inr(n) {
//     if (n == null) return '—';
//     return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
// }
// function usd(n, dp = 4) {
//     if (n == null) return '—';
//     return `$${n.toFixed(dp)}`;
// }

// export function CostMonitor() {
//     const showToast = useToast();
//     const [data, setData] = useState(null);
//     const [error, setError] = useState('');
//     const [editModel, setEditModel] = useState(null);
//     const [saving, setSaving] = useState(false);

//     const load = useCallback(() => {
//         apiFetch('/admin/cost-monitor')
//             .then((res) => { setData(res); setError(''); })
//             .catch((err) => setError(err.message));
//     }, []);

//     useEffect(() => {
//         load();
//         const id = setInterval(load, REFRESH_MS);
//         return () => clearInterval(id);
//     }, [load]);

//     const startEdit = () => setEditModel({ ...data.model });
//     const cancelEdit = () => setEditModel(null);
//     const saveModel = async () => {
//         setSaving(true);
//         try {
//             await apiFetch('/admin/cost-monitor', { method: 'PUT', body: JSON.stringify({ model: editModel }) });
//             showToast('Cost baseline updated', 'ok');
//             setEditModel(null);
//             load();
//         } catch (err) {
//             showToast(err.message || 'Could not save', 'err');
//         } finally {
//             setSaving(false);
//         }
//     };

//     if (error) {
//         return (
//             <div>
//                 <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Cost Monitor</h1>
//                 <div className="card" style={{ color: 'var(--err)' }}>{error}</div>
//             </div>
//         );
//     }

//     if (!data) return <Shimmer height="500px" />;

//     const rate = data.usdToInr;
//     const reelInr = rate ? data.costPerReport.reelUsd * rate : null;
//     const profileInr = rate ? data.costPerReport.profileUsd * rate : null;

//     const labelStyle = {
//         fontSize: 'var(--fs-xs)',
//         textTransform: 'uppercase',
//         letterSpacing: '0.06em',
//         color: 'var(--text-3)',
//         fontWeight: 600,
//     };
//     const cardStyle = {
//         background: 'var(--surface)',
//         border: '1px solid var(--border)',
//         borderRadius: 'var(--r-lg)',
//         padding: 'var(--s5)',
//     };

//     return (
//         <div style={{ maxWidth: 960 }}>
//             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s2)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
//                 <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Cost Monitor</h1>
//                 <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
//                     Refreshes every 60s · {rate ? `1 USD = ₹${rate.toFixed(2)}` : 'INR rate unavailable'}
//                 </span>
//             </div>
//             <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s6)', maxWidth: '60ch' }}>
//                 Real per-report Apify cost vs. what you charge. Baselines come from verified test runs —
//                 "live avg" is computed from your actual runs this billing cycle.
//             </p>

//             {/* Headline cost cards */}
//             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
//                 <div style={cardStyle}>
//                     <div style={labelStyle}>Cost / 1,000 reels</div>
//                     <div style={{ fontFamily: 'var(--font-data)', fontSize: '28px', fontWeight: 700, marginTop: 6 }}>
//                         {rate ? inr(data.per1kReelsUsd * rate) : usd(data.per1kReelsUsd, 2)}
//                     </div>
//                     <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
//                         {usd(data.costPerReport.reelUsd)} / reel
//                     </div>
//                 </div>
//                 <div style={cardStyle}>
//                     <div style={labelStyle}>Cost / 1,000 profiles</div>
//                     <div style={{ fontFamily: 'var(--font-data)', fontSize: '28px', fontWeight: 700, marginTop: 6 }}>
//                         {rate ? inr(data.per1kProfilesUsd * rate) : usd(data.per1kProfilesUsd, 2)}
//                     </div>
//                     <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
//                         {usd(data.costPerReport.profileUsd)} / profile
//                     </div>
//                 </div>
//                 <div style={cardStyle}>
//                     <div style={labelStyle}>Per profile report (INR)</div>
//                     <div style={{ fontFamily: 'var(--font-data)', fontSize: '28px', fontWeight: 700, marginTop: 6 }}>
//                         {inr(profileInr)}
//                     </div>
//                     <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
//                         {data.model.profilePostsPerReport} posts + 1 follower lookup
//                     </div>
//                 </div>
//                 <div style={cardStyle}>
//                     <div style={labelStyle}>Per reel report (INR)</div>
//                     <div style={{ fontFamily: 'var(--font-data)', fontSize: '28px', fontWeight: 700, marginTop: 6 }}>
//                         {inr(reelInr)}
//                     </div>
//                     <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>
//                         1 actor call per reel
//                     </div>
//                 </div>
//             </div>

//             {/* Per-actor breakdown */}
//             <div style={{ ...cardStyle, marginBottom: 'var(--s6)' }}>
//                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s4)' }}>
//                     <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Per-actor rates</h3>
//                     {!editModel && (
//                         <button type="button" className="btn btn-secondary" onClick={startEdit}>Edit baselines</button>
//                     )}
//                 </div>
//                 <table className="data-table">
//                     <thead>
//                         <tr>
//                             <th>Actor</th>
//                             <th>Unit</th>
//                             <th className="numeric">Baseline</th>
//                             <th className="numeric">Live avg (this cycle)</th>
//                         </tr>
//                     </thead>
//                     <tbody>
//                         {data.actors.map((a) => {
//                             const drift = a.liveAvgUsd != null && a.baselineUsd > 0
//                                 ? ((a.liveAvgUsd - a.baselineUsd) / a.baselineUsd) * 100
//                                 : null;
//                             return (
//                                 <tr key={a.id}>
//                                     <td>
//                                         <span style={{ fontWeight: 600 }}>{a.label}</span>
//                                         <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', fontFamily: 'var(--font-data)', marginTop: 2 }}>{a.id}</div>
//                                     </td>
//                                     <td style={{ color: 'var(--text-2)' }}>{a.unit}</td>
//                                     <td className="numeric mono">{usd(a.baselineUsd)}</td>
//                                     <td className="numeric mono">
//                                         {a.liveAvgUsd != null
//                                             ? usd(a.liveAvgUsd)
//                                             : <span style={{ color: 'var(--text-3)' }}>no runs yet</span>}
//                                         {drift != null && Math.abs(drift) >= 15 && (
//                                             <span style={{ marginLeft: 6, color: drift > 0 ? 'var(--err)' : 'var(--ok)', fontSize: 'var(--fs-xs)' }}>
//                                                 {drift > 0 ? '▲' : '▼'} {Math.abs(drift).toFixed(0)}%
//                                             </span>
//                                         )}
//                                     </td>
//                                 </tr>
//                             );
//                         })}
//                     </tbody>
//                 </table>

//                 {editModel && (
//                     <div style={{ marginTop: 'var(--s4)', padding: 'var(--s4)', background: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>
//                         <div style={{ ...labelStyle, marginBottom: 'var(--s3)' }}>Edit baseline costs</div>
//                         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--s3)' }}>
//                             {[
//                                 ['usdPerReel', 'Cost per reel (USD)'],
//                                 ['usdPerProfilePost', 'Cost per post scrape (USD)'],
//                                 ['profilePostsPerReport', 'Posts per profile report'],
//                                 ['usdPerFollowerLookup', 'Follower lookup cost (USD)'],
//                                 ['creditsPerReel', 'Credits per reel report'],
//                                 ['creditsPerProfile', 'Credits per profile report'],
//                             ].map(([key, label]) => (
//                                 <div key={key}>
//                                     <label style={{ ...labelStyle, marginBottom: 4, display: 'block' }}>{label}</label>
//                                     <input
//                                         type="number"
//                                         step="0.0001"
//                                         className="input"
//                                         style={{ width: '100%' }}
//                                         value={editModel[key]}
//                                         onChange={(e) => setEditModel({ ...editModel, [key]: Number(e.target.value) || 0 })}
//                                     />
//                                 </div>
//                             ))}
//                         </div>
//                         <div style={{ display: 'flex', gap: 'var(--s3)', marginTop: 'var(--s4)' }}>
//                             <button type="button" className="btn btn-primary" disabled={saving} onClick={saveModel}>
//                                 {saving ? <span className="btn-spinner" /> : 'Save baselines'}
//                             </button>
//                             <button type="button" className="btn btn-ghost" onClick={cancelEdit}>Cancel</button>
//                         </div>
//                     </div>
//                 )}
//             </div>

//             {/* Per-plan margins */}
//             <div style={cardStyle}>
//                 <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
//                     Per-plan margins
//                 </h3>
//                 <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
//                     Best case = all credits spent on reels. Worst case = all on profiles (costs more per credit).
//                     A healthy plan clears 40% margin even in the worst case.
//                 </p>
//                 <table className="data-table">
//                     <thead>
//                         <tr>
//                             <th>Plan</th>
//                             <th className="numeric">Price</th>
//                             <th className="numeric">Credits</th>
//                             <th className="numeric">Worst-case cost</th>
//                             <th className="numeric">Worst margin</th>
//                             <th className="numeric">Best margin</th>
//                             <th>Status</th>
//                         </tr>
//                     </thead>
//                     <tbody>
//                         {data.planMargins.map((p) => (
//                             <tr key={p.id}>
//                                 <td style={{ fontWeight: 600 }}>{p.name}</td>
//                                 <td className="numeric mono">{inr(p.priceInr)}</td>
//                                 <td className="numeric mono">{p.credits?.toLocaleString()}</td>
//                                 <td className="numeric mono">{inr(p.worstCaseCostInr)}</td>
//                                 <td className="numeric mono" style={{
//                                     fontWeight: 700,
//                                     color: p.worstCaseMarginPct >= 40
//                                         ? 'var(--ok)'
//                                         : p.worstCaseMarginPct >= 0
//                                             ? 'var(--warn)'
//                                             : 'var(--err)',
//                                 }}>
//                                     {p.worstCaseMarginPct != null ? `${p.worstCaseMarginPct}%` : '—'}
//                                 </td>
//                                 <td className="numeric mono" style={{ color: 'var(--text-2)' }}>
//                                     {p.bestCaseMarginPct != null ? `${p.bestCaseMarginPct}%` : '—'}
//                                 </td>
//                                 <td>
//                                     {p.worstCaseMarginPct == null ? (
//                                         <span className="chip neutral">—</span>
//                                     ) : p.worstCaseMarginPct >= 40 ? (
//                                         <span className="chip ok">Healthy</span>
//                                     ) : p.worstCaseMarginPct >= 0 ? (
//                                         <span className="chip warn">Thin</span>
//                                     ) : (
//                                         <span className="chip err">Losing money</span>
//                                     )}
//                                 </td>
//                             </tr>
//                         ))}
//                     </tbody>
//                 </table>
//             </div>
//         </div>
//     );
// }
import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Shimmer } from '../../components/Shimmer';

const REFRESH_MS = 60000;

function inr(n) {
    if (n == null) return '—';
    return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}
function usd(n, dp = 4) {
    if (n == null) return '—';
    return `$${n.toFixed(dp)}`;
}

export function CostMonitor() {
    const showToast = useToast();
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [editModel, setEditModel] = useState(null);
    const [saving, setSaving] = useState(false);

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

    if (!data) return <Shimmer height="500px" />;

    const rate = data.usdToInr;
    const reelInr = rate ? data.costPerReport.reelUsd * rate : null;
    const profileInr = rate ? data.costPerReport.profileUsd * rate : null;

    const labelStyle = { fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', fontWeight: 600 };
    const cardStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 'var(--s5)' };

    return (
        <div style={{ maxWidth: 1200 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s2)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Cost Monitor</h1>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>Refreshes every 60s · {rate ? `1 USD = ₹${rate.toFixed(2)}` : 'INR rate unavailable'}</span>
            </div>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s6)', maxWidth: '60ch' }}>
                Real per-report Apify cost vs. what you charge. Baselines come from verified test runs; "live avg" is computed from your actual runs this billing cycle.
            </p>

            {/* Headline cost cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
                <div style={cardStyle}>
                    <div style={labelStyle}>Cost / 1,000 reels</div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '28px', fontWeight: 700, marginTop: 6 }}>
                        {rate ? inr(data.per1kReelsUsd * rate) : usd(data.per1kReelsUsd, 2)}
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>{usd(data.costPerReport.reelUsd)} / reel</div>
                </div>
                <div style={cardStyle}>
                    <div style={labelStyle}>Cost / 1,000 profiles</div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '28px', fontWeight: 700, marginTop: 6 }}>
                        {rate ? inr(data.per1kProfilesUsd * rate) : usd(data.per1kProfilesUsd, 2)}
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>{usd(data.costPerReport.profileUsd)} / profile</div>
                </div>
                <div style={cardStyle}>
                    <div style={labelStyle}>Per profile report</div>
                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '28px', fontWeight: 700, marginTop: 6 }}>{inr(profileInr)}</div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>{data.model.profilePostsPerReport} posts + 1 follower lookup</div>
                </div>
            </div>

            {/* Per-actor breakdown */}
            <div style={{ ...cardStyle, marginBottom: 'var(--s6)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s4)' }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Per-actor rates</h3>
                    {!editModel && <button type="button" className="btn btn-secondary" onClick={startEdit}>Edit baselines</button>}
                </div>
                <div className="rl-table-scroll"><table className="data-table">
                    <thead>
                        <tr>
                            <th>Actor</th>
                            <th>Unit</th>
                            <th className="numeric">Baseline</th>
                            <th className="numeric">Live avg (this cycle)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.actors.map((a) => {
                            const drift = a.liveAvgUsd != null && a.baselineUsd > 0
                                ? ((a.liveAvgUsd - a.baselineUsd) / a.baselineUsd) * 100
                                : null;
                            return (
                                <tr key={a.id}>
                                    <td style={{ fontWeight: 600 }}>{a.label}<div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', fontFamily: 'var(--font-data)' }}>{a.id}</div></td>
                                    <td style={{ color: 'var(--text-2)' }}>{a.unit}</td>
                                    <td className="numeric mono">{usd(a.baselineUsd)}</td>
                                    <td className="numeric mono">
                                        {a.liveAvgUsd != null ? usd(a.liveAvgUsd) : <span style={{ color: 'var(--text-3)' }}>no runs yet</span>}
                                        {drift != null && Math.abs(drift) >= 15 && (
                                            <span style={{ marginLeft: 6, color: drift > 0 ? 'var(--err)' : 'var(--ok)', fontSize: 'var(--fs-xs)' }}>
                                                {drift > 0 ? '▲' : '▼'} {Math.abs(drift).toFixed(0)}%
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table></div>
                {editModel && (
                    <div style={{ marginTop: 'var(--s4)', padding: 'var(--s4)', background: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>
                        <div style={{ ...labelStyle, marginBottom: 'var(--s3)' }}>Edit baseline costs (USD)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--s3)' }}>
                            {[
                                ['usdPerReel', 'Reel scrape'],
                                ['usdPerProfilePost', 'Profile post scrape'],
                                ['profilePostsPerReport', 'Posts per profile report'],
                                ['usdPerFollowerLookup', 'Follower lookup'],
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
                                <td className="numeric mono">{inr(p.priceInr)}</td>
                                <td className="numeric mono">{inr(p.worstCaseCostInr)}</td>
                                <td className="numeric mono" style={{ fontWeight: 700, color: p.worstCaseMarginPct >= 40 ? 'var(--ok)' : p.worstCaseMarginPct >= 0 ? 'var(--warn)' : 'var(--err)' }}>
                                    {p.worstCaseMarginPct != null ? `${p.worstCaseMarginPct}%` : '—'}
                                </td>
                                <td className="numeric mono" style={{ color: 'var(--text-2)' }}>{p.bestCaseMarginPct != null ? `${p.bestCaseMarginPct}%` : '—'}</td>
                                <td>
                                    {p.worstCaseMarginPct == null ? (
                                        <span className="chip">—</span>
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