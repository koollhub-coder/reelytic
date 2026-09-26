import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../api/client';
import { StatCard } from '../../components/StatCard';
import { BrandLoader } from '../../components/BrandLoader';
import { PipelineModeBanner } from '../../components/PipelineModeBanner';
import { Modal } from '../../components/Modal';
import { formatDate, formatDateTime, formatAge } from '../../utils/date';
import { scanMethodLabel, scanMethodHelp, costSourceLabel, costSourceHelp } from '../../utils/labels';
import { CreditAuditModal } from '../../components/CreditAuditModal';
import { Tooltip } from '../../components/Tooltip';
import { DataTable } from '../../components/DataTable';
import { PlatformCreditsPanel } from '../../components/PlatformCreditsPanel';

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

    const [drilldownUser, setDrilldownUser] = useState(null);
    const [drilldownItems, setDrilldownItems] = useState(null);
    const [drilldownLoading, setDrilldownLoading] = useState(false);
    const [drilldownError, setDrilldownError] = useState('');
    const [drilldownSearch, setDrilldownSearch] = useState('');
    const [drilldownCachedCount, setDrilldownCachedCount] = useState(0);
    const [auditUser, setAuditUser] = useState(null);
    const [showTechnical, setShowTechnical] = useState(false);

    const openDrilldown = (username) => {
        setDrilldownUser(username);
        setDrilldownItems(null);
        setDrilldownError('');
        setDrilldownSearch('');
        setDrilldownCachedCount(0);
        setDrilldownLoading(true);
        apiFetch(`/admin/usage/by-user/${encodeURIComponent(username)}`)
            .then((res) => { setDrilldownItems(res.items || []); setDrilldownCachedCount(res.cachedCount || 0); })
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
    // The opposite case: our rate card billing more per item than Apify
    // actually charged. Previously clamped to zero and therefore invisible.
    const overAttributedUsd = data.overAttributedUsd || 0;
    const showOverAttributed = overAttributedUsd > 0.001;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--s2)', flexWrap: 'wrap', gap: 'var(--s3)' }}>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Usage & Spend</h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                        <Tooltip content={!rate ? 'Live rate unavailable right now' : undefined}>
                        <button
                            type="button"
                            onClick={() => setCurrency('INR')}
                            disabled={!rate}
                            style={{ padding: '4px 12px', border: 'none', background: currency === 'INR' ? 'var(--accent)' : 'transparent', color: currency === 'INR' ? '#fff' : 'var(--text)', cursor: rate ? 'pointer' : 'not-allowed', opacity: rate ? 1 : 0.5 }}
                        >
                            INR
                        </button>
                        </Tooltip>
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

            <PlatformCreditsPanel currency={currency} rate={rate} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s6)' }}>
                <StatCard label="This billing cycle" value={fmt(data.totalUsd, currency, rate)} accent={true} />
                <StatCard
                    label="Remaining balance"
                    value={data.remainingBalanceUsd !== null ? fmt(data.remainingBalanceUsd, currency, rate) : 'N/A'}
                />
                <StatCard label="Daily average" value={fmt(dailyAvgUsd, currency, rate)} />
                <StatCard
                    label="Cycle"
                    value={`${formatDate(data.cycleStart)} - ${formatDate(data.cycleEnd)}`}
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
                    <DataTable
                        id="admin-spend-by-client"
                        bare
                        rows={byUser}
                        getRowId={(row) => row.username}
                        onRowClick={(row) => openDrilldown(row.username)}
                        rowTitle="Click to see every item and what it cost"
                        defaultSort={{ key: 'total', dir: 'desc' }}
                        columns={[
                            { key: 'username', label: 'Client', type: 'text', accessor: (row) => row.username, render: (row) => (
                                <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
                                    {row.username}
                                    {row.username === 'admin' && <span className="chip" style={{ marginLeft: '8px', padding: '2px 8px', fontSize: '10px' }}>Internal</span>}
                                </span>
                            ) },
                            { key: 'profileCount', label: 'Profile reports', type: 'number', align: 'right', mono: true, accessor: (row) => row.profileCount || 0, render: (row) => row.profileCount || '-' },
                            { key: 'profileUsd', label: 'Profile spend', type: 'number', align: 'right', mono: true, accessor: (row) => row.profileUsd || 0, render: (row) => (row.profileCount ? fmt(row.profileUsd, currency, rate) : '-') },
                            { key: 'reelCount', label: 'Reel reports', type: 'number', align: 'right', mono: true, accessor: (row) => row.reelCount || 0, render: (row) => row.reelCount || '-' },
                            { key: 'reelUsd', label: 'Reel spend', type: 'number', align: 'right', mono: true, accessor: (row) => row.reelUsd || 0, render: (row) => (row.reelCount ? fmt(row.reelUsd, currency, rate) : '-') },
                            { key: 'total', label: 'Total', type: 'number', align: 'right', mono: true, accessor: (row) => row.totalUsd || 0, render: (row) => <strong>{fmt(row.totalUsd, currency, rate)}</strong> },
                            { key: 'audit', label: '', sortable: false, filterable: false, align: 'right', render: (row) => (
                                <Tooltip content="Opening balance, credits charged and closing balance for every report this client has run">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        style={{ height: '28px', fontSize: 'var(--fs-xs)', padding: '0 var(--s3)', whiteSpace: 'nowrap' }}
                                        onClick={(e) => { e.stopPropagation(); setAuditUser(row.username); }}
                                    >
                                        Credit audit
                                    </button>
                                </Tooltip>
                            ) },
                        ]}
                    />
                )}
                {showOverAttributed && (
                    <div style={{ marginTop: 'var(--s4)', padding: 'var(--s3) var(--s4)', background: 'var(--surface-2)', border: '1px solid var(--warn, var(--accent))', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)', lineHeight: 1.65 }}>
                        <strong style={{ color: 'var(--text)' }}>
                            These per-client figures add up to more than Apify actually billed.
                        </strong>{' '}
                        The table totals {fmt(data.attributedUsd, currency, rate)}, but the real bill for this cycle is{' '}
                        {fmt(data.totalUsd, currency, rate)}
                        {data.attributionRatio ? ` (${data.attributionRatio.toFixed(1)}x)` : ''}.
                        Per-item costs are priced from our rate card, not read back per request, because Apify bills the account
                        in bulk. When the rate card sits above what bulk usage really costs, every client looks dearer to serve
                        than they are. Treat the client figures as an upper bound and the cycle total as the truth until the
                        rate card is re-measured.
                    </div>
                )}
                {showUnattributed && (
                    <div style={{ marginTop: 'var(--s4)', padding: 'var(--s3) var(--s4)', background: 'var(--surface-2)', borderRadius: 'var(--r-md)', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
                        <strong>Unattributed usage this cycle: {fmt(unattributedUsd, currency, rate)}.</strong>{' '}This is real spend on your account
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
                            <DataTable
                                id="admin-spend-by-actor"
                                bare
                                rows={data.byActor}
                                getRowId={(a) => a.label}
                                columns={[
                                    { key: 'label', label: 'What it paid for', type: 'text', accessor: (a) => a.label },
                                    { key: 'runs', label: 'Requests made', type: 'number', align: 'right', mono: true, accessor: (a) => a.runs },
                                    { key: 'usd', label: 'Cost', type: 'number', align: 'right', mono: true, accessor: (a) => a.usd, render: (a) => fmt(a.usd, currency, rate) },
                                ]}
                            />
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
                                <Tooltip key={i} content={`${d.date}: ${fmt(d.usd, currency, rate)}`}>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '10px', color: 'var(--text-3)', marginBottom: '4px' }}>{fmt(d.usd, currency, rate)}</div>
                                    <div style={{ width: '100%', maxWidth: '36px', height: `${Math.max(heightPct, 4)}px`, backgroundColor: 'var(--accent)', borderRadius: '4px 4px 0 0', transition: 'height 300ms ease' }} />
                                    <div style={{ fontFamily: 'var(--font-data)', fontSize: '9px', color: 'var(--text-3)', transform: 'rotate(-45deg)', whiteSpace: 'nowrap', marginTop: '12px' }}>{d.date.slice(5)}</div>
                                </div>
                                </Tooltip>
                            );
                        })}
                    </div>
                )}
            </div>

            <CreditAuditModal
                username={auditUser}
                isOpen={!!auditUser}
                onClose={() => setAuditUser(null)}
                currency={currency}
                rate={rate}
                fmtMoney={fmt}
            />

            <Modal isOpen={!!drilldownUser} onClose={() => setDrilldownUser(null)} title={drilldownUser ? `${drilldownUser}: every item this cycle` : ''} width="940px">
                {drilldownLoading ? (
                    <BrandLoader variant="inline" message="Loading items..." />
                ) : drilldownError ? (
                    <div style={{ color: 'var(--err)' }}>{drilldownError}</div>
                ) : !drilldownItems || drilldownItems.length === 0 ? (
                    <div style={{ color: 'var(--text-3)', textAlign: 'center', padding: 'var(--s5)' }}>No items recorded for this client this cycle.</div>
                ) : (
                    <>
                        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s3)', lineHeight: 1.6 }}>
                            {drilldownItems.length} item{drilldownItems.length === 1 ? '' : 's'} this cycle.
                            {' '}A <strong style={{ color: 'var(--text-2)' }}>Free</strong> item cost nothing because we already held that
                            data and made no new lookup, and the age beside it tells you how current those figures were.
                            {' '}<strong style={{ color: 'var(--text-2)' }}>Express scan</strong> is the cheaper single-lookup method,
                            {' '}<strong style={{ color: 'var(--text-2)' }}>Standard scan</strong> is the older two-lookup one.
                            {drilldownCachedCount > 0 && (
                                <>
                                    {' '}<span style={{ color: 'var(--ok)' }}>
                                        {drilldownCachedCount} of these were reused at no cost.
                                    </span>
                                </>
                            )}
                        </p>
                        <DataTable
                            id="admin-spend-items"
                            bare
                            rows={drilldownItems}
                            getRowId={(it) => `${it.url}|${it.at}|${it.type}`}
                            defaultSort={{ key: 'at', dir: 'desc' }}
                            searchText={(it) => `${it.resolvedUsername || ''} ${it.url}`}
                            search={drilldownSearch}
                            toolbar={<input type="text" className="input-field" style={{ height: 34, width: 260 }} placeholder="Search link or handle" value={drilldownSearch} onChange={(e) => setDrilldownSearch(e.target.value)} />}
                            columns={[
                                { key: 'link', label: 'Link', type: 'text', accessor: (it) => it.resolvedUsername || it.url, render: (it) => (
                                    <a className="rl-clip" style={{ color: 'var(--accent)', maxWidth: 260 }} title={it.url} href={it.url} target="_blank" rel="noreferrer">{it.resolvedUsername ? `@${it.resolvedUsername}` : it.url}</a>
                                ) },
                                { key: 'type', label: 'Type', type: 'select', accessor: (it) => it.type, optionLabel: (v) => String(v).charAt(0).toUpperCase() + String(v).slice(1), render: (it) => <span style={{ textTransform: 'capitalize' }}>{it.type}</span> },
                                { key: 'mode', label: 'Scan method', type: 'select', accessor: (it) => scanMethodLabel(it.pipelineMode), render: (it) => (
                                    <Tooltip content={scanMethodHelp(it.pipelineMode)}>
                                        <span className="chip" style={{ padding: '2px 8px', fontSize: '10px', whiteSpace: 'nowrap' }}>{scanMethodLabel(it.pipelineMode)}</span>
                                    </Tooltip>
                                ) },
                                { key: 'cost', label: 'Cost', type: 'number', align: 'right', mono: true, accessor: (it) => (it.cached ? 0 : it.costUsd), render: (it) => <span style={it.cached ? { color: 'var(--ok)' } : null}>{it.cached ? 'Free' : fmt(it.costUsd, currency, rate)}</span> },
                                { key: 'source', label: 'Where this came from', type: 'select', accessor: (it) => costSourceLabel(it.costSource, ''), render: (it) => (
                                    <span title={costSourceHelp(it.costSource)} style={{ fontSize: 'var(--fs-xs)', color: it.cached ? 'var(--ok)' : 'var(--text-2)' }}>{costSourceLabel(it.costSource, '')}</span>
                                ) },
                                { key: 'age', label: 'Data age', type: 'select', accessor: (it) => (it.cached ? 'Reused' : 'Fresh'), render: (it) => (
                                    <span className="mono" style={{ fontSize: 'var(--fs-xs)', color: it.cached ? 'var(--text-2)' : 'var(--text-3)' }} title={it.cached && it.cachedAt ? `Originally scraped ${formatDateTime(it.cachedAt)}` : 'Scraped fresh for this report'}>
                                        {it.cached ? (it.cachedAt ? formatAge(it.cachedAt) : 'age not recorded') : 'Fresh'}
                                    </span>
                                ) },
                                { key: 'at', label: 'When', type: 'date', mono: true, accessor: (it) => it.at, render: (it) => <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}>{formatDateTime(it.at)}</span> },
                            ]}
                        />
                    </>
                )}
            </Modal>
        </div>
    );
}
