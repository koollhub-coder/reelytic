import React, { useState } from 'react';
import { apiFetch } from '../api/client';
import { MailIcon, ArrowUpRightIcon, CheckIcon } from './Icon';

/*
  Real, working capture -- POSTs to /api/newsletter/subscribe (see
  server/routes/newsletter.routes.js) and stores the address. Nothing emails
  this list yet, but the form itself is not decorative: a footer signup that
  silently does nothing on submit is worse than not having one, especially
  on a page prospective investors or clients will actually try.
*/
export function NewsletterSignup() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | loading | done
  const [error, setError] = useState('');

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    // noValidate below (plus this check) keeps this in the app's own themed
    // error text instead of the browser's unstyled native validation popup
    // -- same reasoning as the auth forms.
    if (!EMAIL_RE.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setState('loading');
    try {
      await apiFetch('/newsletter/subscribe', { method: 'POST', body: JSON.stringify({ email }) });
      setState('done');
    } catch (err) {
      setError(err.message || 'Could not subscribe. Try again.');
      setState('idle');
    }
  };

  return (
    <div className="landing-newsletter">
      <div className="landing-newsletter-icon"><MailIcon size={18} /></div>
      <div className="landing-newsletter-title">Stay in the loop</div>
      <div className="landing-newsletter-desc">Tips, product updates, and insights — straight to your inbox.</div>
      {state === 'done' ? (
        <div className="landing-newsletter-success"><CheckIcon size={14} />Subscribed. Thanks for joining.</div>
      ) : (
        <form onSubmit={submit} className="landing-newsletter-form" noValidate>
          <input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="landing-newsletter-input"
            aria-label="Email address"
          />
          <button type="submit" className="landing-newsletter-submit" disabled={state === 'loading'} aria-label="Subscribe">
            <ArrowUpRightIcon size={16} style={{ transform: 'rotate(45deg)' }} />
          </button>
        </form>
      )}
      {error && <div className="landing-newsletter-error">{error}</div>}
    </div>
  );
}
