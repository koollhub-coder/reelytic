import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { Shimmer } from '../components/Shimmer';
import { Logo } from '../components/Logo';

const ANNUAL_DISCOUNT = 0.9; // -10%, mirrors Apify's own annual convention

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

function useReveal() {
    const ref = useRef(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
            { threshold: 0.15 }
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, []);
    return [ref, visible];
}

function PriceTag({ amount }) {
    const display = useCountUp(amount);
    return <span className="mono">{'₹'}{display.toLocaleString('en-IN')}</span>;
}

function PlanCard({ plan, annual, index, onChoose }) {
    const [ref, visible] = useReveal();
    const price = annual ? Math.round(plan.monthly * ANNUAL_DISCOUNT) : plan.monthly;

    return (
        <div
            ref={ref}
            className="pricing-card"
            style={{
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(16px)',
                transitionDelay: `${index * 90}ms`,
            }}
        >
            {plan.popular && <div className="pricing-badge">Most popular</div>}
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
                    Billed {'₹'}{(price * 12).toLocaleString('en-IN')} / year — save 10%
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
                onClick={() => onChoose(plan, annual)}
            >
                Choose {plan.name}
            </button>
        </div>
    );
}

export function Pricing() {
    const navigate = useNavigate();
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

    if (!plans) {
        return (
            <div style={{ maxWidth: 1080, margin: '0 auto', padding: 'var(--s6) var(--s4)' }}>
                <Shimmer height="200px" />
            </div>
        );
    }

    return (
        <div>
            <nav style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--s4) var(--s6)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
                    <Logo />
                </div>
                <button type="button" className="btn btn-primary" onClick={() => navigate('/login')}>
                    Log in
                </button>
            </nav>

            <div style={{ maxWidth: 1080, margin: '0 auto', padding: 'var(--s6) var(--s4)' }}>
                <style>{`
        .pricing-card {
          position: relative;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--r-lg);
          padding: var(--s6) var(--s5) var(--s5);
          transition: opacity 500ms ease, transform 500ms ease, box-shadow 200ms ease, border-color 200ms ease;
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
        .trial-banner {
          background: var(--accent-soft);
          border-radius: var(--r-lg);
          padding: var(--s4) var(--s5);
          text-align: center;
          margin-bottom: var(--s6);
          animation: trialPulse 3s ease-in-out infinite;
        }
        @keyframes trialPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(226, 62, 87, 0.15); }
          50% { box-shadow: 0 0 0 8px rgba(226, 62, 87, 0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pricing-card, .trial-banner { animation: none !important; transition: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

                <div style={{ textAlign: 'center', marginBottom: 'var(--s6)' }}>
                    <div className="eyebrow" style={{ color: 'var(--accent)', fontFamily: 'var(--font-data)', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 'var(--fs-xs)', marginBottom: 8 }}>
                        Pricing
                    </div>
                    <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 8 }}>
                        Simple credits. No surprise bills.
                    </h1>
                    <p style={{ color: 'var(--text-2)', maxWidth: 480, margin: '0 auto' }}>
                        One credit pool for reel and profile reports — use it however your month actually looks.
                    </p>
                </div>

                <div className="trial-banner">
                    <strong>New here?</strong> Start with <strong>10 free reel reports + 5 free profile reports</strong> — no card required.
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s6)' }}>
                    <div className="billing-toggle">
                        <button type="button" className={!annual ? 'is-active' : ''} onClick={() => setAnnual(false)}>Monthly</button>
                        <button type="button" className={annual ? 'is-active' : ''} onClick={() => setAnnual(true)}>Annual - 10%</button>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s5)', marginBottom: 'var(--s7)' }}>
                    {plans.map((plan, i) => (
                        <PlanCard key={plan.id} plan={plan} annual={annual} index={i} onChoose={handleChoose} />
                    ))}
                </div>

                <div className="card" style={{ textAlign: 'center', marginBottom: 'var(--s6)' }}>
                    <p style={{ marginBottom: 4 }}><strong>Need more than 10,000 credits a month?</strong></p>
                    <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>Talk to us about an Agency+ plan built around your actual volume.</p>
                </div>

                <div style={{ maxWidth: 640, margin: '0 auto' }}>
                    <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)', textAlign: 'center' }}>
                        Questions
                    </h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
                        <div>
                            <p style={{ fontWeight: 600, marginBottom: 4 }}>What's a credit?</p>
                            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>1 reel report = 1 credit. 1 profile report = about 5 credits, since it pulls data across several of a creator's recent reels.</p>
                        </div>
                        <div>
                            <p style={{ fontWeight: 600, marginBottom: 4 }}>What happens if I run out mid-month?</p>
                            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>You can top up instantly or wait for your credits to reset next cycle — unused credits don't roll over, same as most usage-based platforms.</p>
                        </div>
                        <div>
                            <p style={{ fontWeight: 600, marginBottom: 4 }}>Can I change plans later?</p>
                            <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>Yes, upgrade or downgrade anytime from Settings. Changes apply from your next billing cycle.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}