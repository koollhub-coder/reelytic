import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function loadRazorpayScript() {
    return new Promise((resolve) => {
        if (window.Razorpay) return resolve(true);
        const script = document.createElement('script');
        script.src = RAZORPAY_SCRIPT_SRC;
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
}

export function Checkout() {
    const location = useLocation();
    const navigate = useNavigate();
    const { refreshUser } = useAuth();
    const order = location.state;

    // Grant the plan's credits on the backend, refresh balance, then show success.
    const grantAndSucceed = async () => {
        try {
            await apiFetch('/billing/confirm', {
                method: 'POST',
                body: JSON.stringify({ planId: order.planId }),
            });
            await refreshUser();
        } catch (e) {
            // Even if the grant call hiccups, don't trap the user on a spinner.
        }
        setStatus('success');
    };

    const [status, setStatus] = useState('idle'); // idle | processing | dummy-modal | success
    const [error, setError] = useState('');

    useEffect(() => {
        if (!order) navigate('/pricing', { replace: true });
    }, [order, navigate]);

    if (!order) return null;

    const handlePay = async () => {
        setError('');
        setStatus('processing');

        let createdOrder;
        try {
            // Real backend call: today this returns a mock order (see server/routes/billing.routes.js).
            // Once real Razorpay keys are in .env, this same call starts returning a real order id.
            createdOrder = await apiFetch('/billing/create-order', {
                method: 'POST',
                body: JSON.stringify({ planId: order.planId, amount: order.price, billing: order.billing }),
            });
        } catch (err) {
            setError(err.message || 'Could not start checkout. Try again.');
            setStatus('idle');
            return;
        }

        const scriptLoaded = await loadRazorpayScript();
        const hasRealKey = createdOrder.keyId && !createdOrder.keyId.includes('YOUR_KEY');

        if (!scriptLoaded || !hasRealKey) {
            // Dummy mode: no real Razorpay key configured yet. Show the in-app
            // simulator instead of a broken/rejected real checkout.
            setStatus('dummy-modal');
            return;
        }

        const options = {
            key: createdOrder.keyId,
            amount: createdOrder.amount, // paise
            currency: 'INR',
            name: 'Reelytic',
            description: `${order.plan} plan, ${order.billing}`,
            order_id: createdOrder.id,
            handler: function () {
                grantAndSucceed();
            },
            prefill: {},
            theme: { color: '#E23E57' },
            modal: {
                ondismiss: function () {
                    setStatus('idle');
                },
            },
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', function () {
            setError('Payment failed. No charge was made, try again.');
            setStatus('idle');
        });
        rzp.open();
    };

    const handleDummyConfirm = () => {
        setStatus('processing');
        grantAndSucceed();
    };

    if (status === 'success') {
        return (
            <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', padding: 'var(--s4)' }}>
                <div style={{ fontSize: 48, marginBottom: 'var(--s3)' }}>{'✓'}</div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 8 }}>
                    You're on the {order.plan} plan
                </h1>
                <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s5)' }}>
                    {order.credits.toLocaleString('en-IN')} credits will be added to your account.
                </p>
                <p style={{ color: 'var(--warn)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s5)' }}>
                    Dev note: this was a simulated payment. No real charge occurred, and credits aren't actually applied to your account yet. That wiring comes with the real payment gateway keys.
                </p>
                <button type="button" className="btn btn-primary" onClick={() => navigate('/reels')}>
                    Back to Reelytic
                </button>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: 440, margin: '60px auto', padding: 'var(--s4)' }}>
            <div className="card">
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)' }}>
                    Confirm your plan
                </h1>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-2)' }}>Plan</span>
                    <strong>{order.plan}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-2)' }}>Billing</span>
                    <strong style={{ textTransform: 'capitalize' }}>{order.billing}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-2)' }}>Credits / month</span>
                    <strong className="mono">{order.credits.toLocaleString('en-IN')}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0 var(--s4)' }}>
                    <span style={{ fontWeight: 600 }}>Total due today</span>
                    <strong className="mono" style={{ fontSize: 'var(--fs-lg)' }}>
                        {'₹'}{order.price.toLocaleString('en-IN')}
                    </strong>
                </div>

                {error && (
                    <p style={{ color: 'var(--err)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s3)' }}>{error}</p>
                )}

                <button type="button" className="btn btn-primary btn-block" disabled={status === 'processing'} onClick={handlePay}>
                    {status === 'processing' ? <span className="btn-spinner" /> : 'Pay with Razorpay'}
                </button>
                <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => navigate('/pricing')}>
                    Choose a different plan
                </button>

                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textAlign: 'center', marginTop: 'var(--s4)' }}>
                    Payments are processed securely by Razorpay. Reelytic never sees your card details.
                </p>
            </div>

            {status === 'dummy-modal' && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(16,18,22,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 900 }}
                    onMouseDown={(e) => { if (e.target === e.currentTarget) setStatus('idle'); }}
                >
                    <div style={{ background: '#fff', color: '#1a1c20', borderRadius: 12, width: 360, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 6, background: '#3395FF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14 }}>R</div>
                            <strong>Razorpay</strong>
                            <span style={{ marginLeft: 'auto', fontSize: 11, background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 999 }}>TEST MODE</span>
                        </div>
                        <p style={{ fontSize: 13, color: '#5D6169', marginBottom: 16 }}>
                            Reelytic: {order.plan} plan ({order.billing})
                        </p>
                        <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 20 }}>
                            {'₹'}{order.price.toLocaleString('en-IN')}
                        </div>
                        <input className="input" placeholder="Card number" defaultValue="4111 1111 1111 1111" style={{ width: '100%', marginBottom: 8, color: '#1a1c20' }} disabled />
                        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                            <input className="input" placeholder="MM/YY" defaultValue="12/29" style={{ flex: 1, color: '#1a1c20' }} disabled />
                            <input className="input" placeholder="CVV" defaultValue="123" style={{ flex: 1, color: '#1a1c20' }} disabled />
                        </div>
                        <button type="button" className="btn btn-primary btn-block" onClick={handleDummyConfirm}>
                            Pay {'₹'}{order.price.toLocaleString('en-IN')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => setStatus('idle')}>
                            Cancel
                        </button>
                        <p style={{ fontSize: 11, color: '#8B8F98', textAlign: 'center', marginTop: 12 }}>
                            Simulated checkout, no real payment key configured yet.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}