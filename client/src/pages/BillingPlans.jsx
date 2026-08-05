import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { Shimmer } from '../components/Shimmer';
import { useAuth } from '../context/AuthContext';

const ANNUAL_DISCOUNT = 0.9; // -10% for annual billing

function useCountUp(value) {
    const [display, setDisplay] = useState(value);
    const prev = useRef(value);
    useEffect(() => {
        const from = prev.current;
        const to = value;
        if (from === to) return;
        const duration = 350;
        const start = performance.now();
        let raf;
        function tick(now) {
            const t = Math.min(1, (now - start) / duration);
            setDisplay(Math.round(from + (to - from) * t));
            if (t < 1) raf = requestAnimationFrame(tick);
            else prev.current = to;
        }
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [value]);
    return display;
}

function PriceTag({ amount }) {
    const display = useCountUp(amount);
    return <span className="mono">{'₹'}{display.toLocaleString('en-IN')}</span>;
}

function PlanCard({ plan, annual, onChoose, currentPlanId }) {
    const price = annual ? Math.round(plan.monthly * ANNUAL_DISCOUNT) : plan.monthly;
    const isCurrent = plan.id === currentPlanId;

    return (
        <div className="pricing-card" style={{ opacity: 1, transform: 'none' }}>
            {plan.popular && !isCurrent && <div className="pricing-badge">Most popular</div>}
            {isCurrent && <div className="pricing-badge" style={{ background: 'var(--ok)' }}>Your plan</div>}
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 4 }}>{plan.name}</h3>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)', minHeight: 40 }}>{plan.blurb}</p>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 'var(--s1)' }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '34px', fontWeight: 700 }}>
                    <PriceTag amount={price} />
                </span>
                <span style={{ color: 'var(--text-3)', fontSize: 'var(--fs-sm)' }}>/ month</span>
            </div>
            {annual && (
                <p style={{ color: 'var(--ok)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s4)' }}>
                    Billed {'₹'}{(price * 12).toLocaleString('en-IN')} / year, save 10%
                </p>
            )}
            {!annual && <div style={{ marginBottom: 'var(--s4)' }} />}

            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 var(--s5) 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {plan.features.map((f) => (
                    <li key={f} style={{ display: 'flex', gap: 8, fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>
                        <span style={{ color: 'var(--ok)' }}>{'✓'}</span>
                        <span>{f}</span>
                    </li>
                ))}
            </ul>

            <button
                type="button"
                className={`btn ${plan.popular ? 'btn-primary' : 'btn-secondary'} btn-block`}
                disabled={isCurrent}
                onClick={() => onChoose(plan, annual)}
            >
                {isCurrent ? 'Current plan' : `Choose ${plan.name}`}
            </button>
        </div>
    );
}

// In-app plan browser -- rendered inside the Shell (sidebar stays visible),
// unlike the public marketing Pricing.jsx page which has its own separate
// nav and is meant for logged-out visitors. Reaching "Pricing & Plans" from
// the sidebar used to route to that standalone page instead, which dropped
// the whole app shell for what looked like a different site -- jarring mid-
// workspace. Picking a plan still hands off to the existing /checkout flow
// (also inside the Shell), so the sidebar never disappears at any point in
// browsing-to-checkout.
export function BillingPlans() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [annual, setAnnual] = useState(false);
    const [plans, setPlans] = useState(null);

    useEffect(() => {
        apiFetch('/pricing/plans')
            .then((res) => setPlans(res.plans))
            .catch(() => setPlans([]));
    }, []);

    const handleChoose = (plan, isAnnual) => {
        const price = isAnnual ? Math.round(plan.monthly * ANNUAL_DISCOUNT) : plan.monthly;
        navigate('/checkout', { state: { plan: plan.name, planId: plan.id, credits: plan.credits, price, billing: isAnnual ? 'annual' : 'monthly' } });
    };

    return (
        <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 4 }}>Pricing & Plans</h1>
            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s6)' }}>
                One credit pool for reel and profile reports. Upgrade or top up anytime.
            </p>

            <style>{`
        .pricing-card {
          position: relative;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          padding: var(--s6) var(--s5) var(--s5);
          transition: box-shadow 200ms ease, border-color 200ms ease;
        }
        .pricing-card:hover {
          box-shadow: var(--shadow-lg);
          border-color: var(--accent);
        }
        .pricing-badge {
          position: absolute;
          top: -12px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--accent);
          color: #fff;
          font-size: var(--fs-xs);
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 4px 14px;
          border-radius: var(--r-full);
        }
        .billing-toggle {
          display: inline-flex;
          border: 1px solid var(--border);
          border-radius: var(--r-full);
          padding: 3px;
          background: var(--surface-2);
        }
        .billing-toggle button {
          border: none;
          background: transparent;
          padding: 8px 20px;
          border-radius: var(--r-full);
          font-size: var(--fs-sm);
          font-weight: 600;
          color: var(--text-2);
          cursor: pointer;
          transition: background 200ms ease, color 200ms ease;
        }
        .billing-toggle button.is-active {
          background: var(--accent);
          color: #fff;
        }
      `}</style>

            {!plans ? (
                <Shimmer height="400px" />
            ) : (
                <>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s6)' }}>
                        <div className="billing-toggle">
                            <button type="button" className={!annual ? 'is-active' : ''} onClick={() => setAnnual(false)}>Monthly</button>
                            <button type="button" className={annual ? 'is-active' : ''} onClick={() => setAnnual(true)}>Annual - 10%</button>
                        </div>
                    </div>

                    <div className="rl-stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s5)', marginBottom: 'var(--s6)' }}>
                        {plans.map((plan) => (
                            <PlanCard key={plan.id} plan={plan} annual={annual} onChoose={handleChoose} currentPlanId={user?.plan} />
                        ))}
                    </div>

                    <div className="card" style={{ textAlign: 'center' }}>
                        <p style={{ marginBottom: 4 }}><strong>Need more than 10,000 credits a month?</strong></p>
                        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>Talk to us about an Agency+ plan built around your actual volume.</p>
                    </div>
                </>
            )}
        </div>
    );
}
