import { Mail } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Modal } from '../components/Modal';
import { useToast } from '../context/ToastContext';

/*
  Checkout, with online payment switched off.

  Razorpay is not configured yet, so rather than hand someone a payment form
  that cannot take a payment, this routes them to a person. The previous
  build showed a fake Razorpay card form in test mode: it looked like a real
  checkout, asked for a card number, and was wired to a simulated success
  that granted nothing. Anyone who reached it either thought they had paid,
  or concluded the product was broken. A dead-end that says who to contact is
  strictly better than a working-looking form that leads nowhere.

  Everything needed for the real gateway is still here and still correct.
  When the keys land, flip PAYMENTS_ENABLED to true.
*/
const PAYMENTS_ENABLED = false;

const BILLING_EMAIL = 'reelyticalert@gmail.com';
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
    const { addToast } = useToast();
    const order = location.state;

    const [status, setStatus] = useState('idle'); // idle | processing | contact | success
    const [error, setError] = useState('');

    useEffect(() => {
        if (!order) navigate('/pricing', { replace: true });
    }, [order, navigate]);

    if (!order) return null;

    // Grant the plan's credits on the backend, refresh balance, then show success.
    // Only reachable through a real, completed Razorpay payment.
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

    const handlePay = async () => {
        setError('');

        // No gateway configured: go straight to the contact route. Deliberately
        // does not call /billing/create-order first, since there is nothing an
        // order id could be used for and a pointless round trip only adds a
        // spinner and a way to fail.
        if (!PAYMENTS_ENABLED) {
            setStatus('contact');
            return;
        }

        setStatus('processing');
        let createdOrder;
        try {
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

        // Payments are on but the gateway still can't be reached. Say so
        // plainly and offer the same human fallback rather than pretending.
        if (!scriptLoaded || !hasRealKey) {
            setStatus('contact');
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

    const mailtoHref = `mailto:${BILLING_EMAIL}`
        + `?subject=${encodeURIComponent(`Reelytic: activate ${order.plan} plan (${order.billing})`)}`
        + `&body=${encodeURIComponent(
            `Hi Reelytic team,\n\nI'd like to activate the ${order.plan} plan.\n\n`
            + `Plan: ${order.plan}\nBilling: ${order.billing}\n`
            + `Credits per month: ${order.credits.toLocaleString('en-IN')}\n`
            + `Amount: Rs ${order.price.toLocaleString('en-IN')}\n\nThanks.`
        )}`;

    const handleCopyEmail = async () => {
        await navigator.clipboard.writeText(BILLING_EMAIL);
        addToast('Email address copied', 'ok');
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

                {/* Labelled for what it actually does. "Pay with Razorpay" on a
                    button that opens a contact dialog is a small lie the user
                    finds out about one click later. */}
                <button type="button" className="btn btn-primary btn-block" disabled={status === 'processing'} onClick={handlePay}>
                    {status === 'processing'
                        ? <span className="btn-spinner" />
                        : (PAYMENTS_ENABLED ? 'Pay with Razorpay' : 'Continue to activate')}
                </button>
                <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => navigate('/billing')}>
                    Choose a different plan
                </button>

                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textAlign: 'center', marginTop: 'var(--s4)' }}>
                    {PAYMENTS_ENABLED
                        ? 'Payments are processed securely by Razorpay. Reelytic never sees your card details.'
                        : 'Plans are activated by our team. No card details are collected here.'}
                </p>
            </div>

            {/* Uses the app's own Modal, so it inherits the theme, the escape
                key, and the mobile bottom-sheet treatment. The old dialog was
                hand-rolled with a hardcoded white panel and inputs on a
                `.input` class that does not exist in the stylesheet, which is
                why it rendered as unstyled boxes on a light card. */}
            <Modal isOpen={status === 'contact'} onClose={() => setStatus('idle')} title="Activate your plan" width="440px">
                <div style={{
                    width: '44px', height: '44px', borderRadius: 'var(--r-md)',
                    backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                    color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 'var(--s4)',
                }}>
                    <Mail size={20} strokeWidth={1.75} aria-hidden="true" />
                </div>

                <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.65, marginBottom: 'var(--s4)' }}>
                    Online payment is not switched on yet. Send us a message and we will activate
                    the <strong style={{ color: 'var(--text)' }}>{order.plan}</strong> plan on your
                    account and confirm by reply.
                </p>

                <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--s2)',
                    backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-md)', padding: '6px 6px 6px var(--s3)',
                    marginBottom: 'var(--s4)',
                }}>
                    <span className="mono" style={{
                        flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {BILLING_EMAIL}
                    </span>
                    <button type="button" className="btn btn-secondary" onClick={handleCopyEmail} style={{ flexShrink: 0, height: '30px', padding: '0 var(--s3)' }}>
                        Copy
                    </button>
                </div>

                <div style={{
                    fontSize: 'var(--fs-xs)', color: 'var(--text-3)',
                    borderTop: '1px solid var(--border)', paddingTop: 'var(--s3)', marginBottom: 'var(--s5)',
                    lineHeight: 1.7,
                }}>
                    Include your plan and billing period so we can set it up in one pass:
                    <div style={{ color: 'var(--text-2)', marginTop: '4px' }}>
                        {order.plan} plan, {order.billing}, {order.credits.toLocaleString('en-IN')} credits per month.
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-ghost" onClick={() => setStatus('idle')}>Close</button>
                    {/* A real button, not an underlined mailto link. Opens the
                        user's mail app with the plan details already filled in. */}
                    <a className="btn btn-primary" href={mailtoHref} style={{ textDecoration: 'none' }}>
                        Open email app
                    </a>
                </div>
            </Modal>
        </div>
    );
}
