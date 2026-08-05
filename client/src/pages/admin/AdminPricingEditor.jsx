import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Shimmer } from '../../components/Shimmer';

function emptyPlan() {
    return {
        id: `plan_${Date.now()}`,
        name: 'New Plan',
        monthly: 0,
        credits: 0,
        blurb: '',
        features: [''],
        popular: false,
    };
}

function MarginBadge({ pct }) {
    if (pct == null) return null;
    const color = pct >= 40 ? 'var(--ok)' : pct >= 20 ? 'var(--warn)' : 'var(--err)';
    const bg = pct >= 40 ? 'var(--ok-soft)' : pct >= 20 ? 'var(--warn-soft)' : 'var(--err-soft)';
    const label = pct >= 40 ? 'Healthy' : pct >= 20 ? 'Thin' : 'Danger';
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: bg, color, borderRadius: 'var(--r-full)',
            padding: '3px 10px', fontSize: 'var(--fs-xs)', fontWeight: 700,
        }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
            {pct}% · {label}
        </span>
    );
}

function PlanCard({ plan, index, onChange, onRemove, marginPct, isOnly }) {
    const [collapsed, setCollapsed] = useState(false);
    const update = (field, value) => onChange({ ...plan, [field]: value });
    const updateFeature = (i, value) => {
        const next = [...plan.features];
        next[i] = value;
        update('features', next);
    };
    const addFeature = () => update('features', [...(plan.features || []), '']);
    const removeFeature = (i) => update('features', plan.features.filter((_, idx) => idx !== i));

    return (
        <div style={{
            background: 'var(--surface)',
            border: `1.5px solid ${plan.popular ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 'var(--r-lg)',
            overflow: 'hidden',
            boxShadow: plan.popular ? '0 0 0 3px var(--accent-soft)' : 'var(--shadow)',
            transition: 'box-shadow 200ms ease, border-color 200ms ease',
        }}>
            {/* Card header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--s3)',
                padding: 'var(--s3) var(--s4)',
                background: plan.popular ? 'var(--accent-soft)' : 'var(--surface-2)',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer', userSelect: 'none',
            }} onClick={() => setCollapsed(!collapsed)}>
                <span style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: plan.popular ? 'var(--accent)' : 'var(--border-strong)', color: plan.popular ? '#fff' : 'var(--text)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 'var(--fs-xs)', fontWeight: 700,
                }}>{index + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-md)', display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                        {plan.name || 'Untitled'}
                        {plan.popular && (
                            <span style={{ background: 'var(--accent)', color: '#fff', borderRadius: 'var(--r-full)', padding: '1px 8px', fontSize: 'var(--fs-xs)', fontWeight: 700 }}>
                                Popular
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 1 }}>
                        {plan.monthly ? `₹${plan.monthly.toLocaleString('en-IN')}/mo` : 'No price set'} · {plan.credits ? `${plan.credits.toLocaleString()} credits` : 'No credits set'}
                    </div>
                </div>
                <MarginBadge pct={marginPct} />
                <span style={{ color: 'var(--text-3)', fontSize: 12, marginLeft: 'var(--s1)', transition: 'transform 200ms', display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
                    ▼
                </span>
            </div>

            {!collapsed && (
                <div style={{ padding: 'var(--s5)' }}>
                    {/* Row 1: Name + Price + Credits */}
                    <div className="rl-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 'var(--s3)', marginBottom: 'var(--s4)' }}>
                        <div>
                            <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Plan name</label>
                            <input
                                className="input-field"
                                style={{ width: '100%', fontWeight: 600, fontSize: 'var(--fs-md)' }}
                                value={plan.name}
                                onChange={(e) => update('name', e.target.value)}
                                placeholder="e.g. Pro"
                            />
                        </div>
                        <div>
                            <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Price (₹/month)</label>
                            <input
                                type="number"
                                className="input-field"
                                style={{ width: '100%', fontFamily: 'var(--font-data)', fontWeight: 700 }}
                                value={plan.monthly}
                                onChange={(e) => update('monthly', Number(e.target.value) || 0)}
                            />
                        </div>
                        <div>
                            <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Credits/month</label>
                            <input
                                type="number"
                                className="input-field"
                                style={{ width: '100%', fontFamily: 'var(--font-data)', fontWeight: 700 }}
                                value={plan.credits}
                                onChange={(e) => update('credits', Number(e.target.value) || 0)}
                            />
                        </div>
                    </div>

                    {/* Tagline */}
                    <div style={{ marginBottom: 'var(--s4)' }}>
                        <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>Tagline <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(shown under plan name on pricing page)</span></label>
                        <input
                            className="input-field"
                            style={{ width: '100%' }}
                            value={plan.blurb}
                            onChange={(e) => update('blurb', e.target.value)}
                            placeholder="e.g. For agencies running multiple clients at once."
                        />
                    </div>

                    {/* Feature bullets */}
                    <div style={{ marginBottom: 'var(--s4)' }}>
                        <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: 8 }}>Feature bullets</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {(plan.features || []).map((f, i) => (
                                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <span style={{ color: 'var(--ok)', fontSize: 16, flexShrink: 0 }}>✓</span>
                                    <input
                                        className="input-field"
                                        style={{ flex: 1 }}
                                        value={f}
                                        onChange={(e) => updateFeature(i, e.target.value)}
                                        placeholder="e.g. 2,000 credits / month"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => removeFeature(i)}
                                        style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18, padding: '0 4px', lineHeight: 1 }}
                                        aria-label="Remove"
                                    >×</button>
                                </div>
                            ))}
                            <button type="button" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} onClick={addFeature}>
                                + Add bullet
                            </button>
                        </div>
                    </div>

                    {/* Footer row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 'var(--s3)', borderTop: '1px solid var(--border)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                            <div
                                onClick={() => update('popular', !plan.popular)}
                                style={{
                                    width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
                                    background: plan.popular ? 'var(--accent)' : 'var(--border-strong)',
                                    position: 'relative', transition: 'background 200ms',
                                }}
                            >
                                <div style={{
                                    width: 18, height: 18, borderRadius: '50%', background: '#fff',
                                    position: 'absolute', top: 2,
                                    left: plan.popular ? 20 : 2,
                                    transition: 'left 200ms',
                                    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                                }} />
                            </div>
                            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
                                {plan.popular ? 'Showing "Most popular" badge' : 'Mark as most popular'}
                            </span>
                        </label>
                        <button
                            type="button"
                            onClick={onRemove}
                            disabled={isOnly}
                            style={{ background: 'none', border: 'none', color: isOnly ? 'var(--text-3)' : 'var(--err)', cursor: isOnly ? 'not-allowed' : 'pointer', fontSize: 'var(--fs-sm)', fontWeight: 500 }}
                        >
                            {isOnly ? 'Need at least 1 plan' : 'Delete plan'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function AdminPricingEditor() {
    const showToast = useToast();
    const [plans, setPlans] = useState(null);
    const [margins, setMargins] = useState({});
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    const load = () => {
        apiFetch('/admin/pricing-plans')
            .then((res) => { setPlans(res.plans || []); setDirty(false); })
            .catch(() => setPlans([]));
        apiFetch('/admin/cost-monitor')
            .then((res) => {
                const m = {};
                (res.planMargins || []).forEach((p) => { m[p.id] = p.worstCaseMarginPct; });
                setMargins(m);
            })
            .catch(() => { });
    };

    useEffect(() => { load(); }, []);

    const updatePlan = (index, updated) => {
        const next = [...plans];
        next[index] = updated;
        setPlans(next);
        setDirty(true);
    };
    const removePlan = (index) => { setPlans(plans.filter((_, i) => i !== index)); setDirty(true); };
    const addPlan = () => { setPlans([...plans, emptyPlan()]); setDirty(true); };

    const resetToDefaults = async () => {
        try {
            await apiFetch('/admin/pricing-plans', { method: 'PUT', body: JSON.stringify({ plans: [] }) });
            showToast('Reset to recommended defaults', 'ok');
        } catch (e) { /* fall through */ }
        load();
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await apiFetch('/admin/pricing-plans', { method: 'PUT', body: JSON.stringify({ plans }) });
            showToast('Pricing saved - live on /pricing now', 'ok');
            setDirty(false);
            load();
        } catch (err) {
            showToast(err.message || 'Could not save', 'err');
        } finally {
            setSaving(false);
        }
    };

    if (!plans) return <Shimmer height="500px" />;

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s6)' }}>
                <div>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 4 }}>Pricing Editor</h1>
                    <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>
                        {plans.length} {plans.length === 1 ? 'plan' : 'plans'} · Changes go live on /pricing the moment you save
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-ghost" onClick={resetToDefaults}>Reset defaults</button>
                    <button type="button" className="btn btn-secondary" onClick={addPlan}>+ Add plan</button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        disabled={saving || !dirty}
                        onClick={handleSave}
                        style={{ minWidth: 120 }}
                    >
                        {saving ? <span className="btn-spinner" /> : dirty ? 'Save changes' : 'Saved'}
                    </button>
                </div>
            </div>

            {/* Unsaved warning */}
            {dirty && (
                <div style={{ background: 'var(--warn-soft)', border: '1px solid var(--warn)', borderRadius: 'var(--r-md)', padding: 'var(--s3) var(--s4)', marginBottom: 'var(--s4)', fontSize: 'var(--fs-sm)', color: 'var(--warn)', display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                    <span>●</span> Unsaved changes - your /pricing page still shows the old prices until you save
                </div>
            )}

            {/* Plan cards */}
            <div className="rl-stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 'var(--s4)', alignItems: 'start' }}>
                {plans.map((plan, i) => (
                    <PlanCard
                        key={plan.id || i}
                        index={i}
                        plan={plan}
                        marginPct={margins[plan.id]}
                        isOnly={plans.length === 1}
                        onChange={(p) => updatePlan(i, p)}
                        onRemove={() => removePlan(i)}
                    />
                ))}
            </div>

            {/* Bottom action bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--s5)', paddingTop: 'var(--s5)', borderTop: '1px solid var(--border)' }}>
                <button type="button" className="btn btn-secondary" onClick={addPlan}>+ Add plan</button>
                <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving || !dirty}
                    onClick={handleSave}
                    style={{ minWidth: 140 }}
                >
                    {saving ? <span className="btn-spinner" /> : dirty ? 'Save changes' : 'All saved'}
                </button>
            </div>
        </div>
    );
}