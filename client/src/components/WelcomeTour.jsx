import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { startDemoGuide } from './DemoGuide';

/*
  First-login onboarding.

  This used to be six slides of prose that described the product and then
  dropped the user on an empty upload screen. The pattern every good SaaS
  onboarding has converged on instead is: put something real in front of
  them immediately, and let them touch it. An empty product teaches nothing,
  and a carousel is read once and forgotten.

  So this is short (three panels, not six) and ends by opening an actual
  finished report seeded with sample data. From there the Getting Started
  checklist takes over and walks them through sharing it, exporting it, and
  running their own.

  The sample report unlocks the paid features so a free-tier account can see
  what they do, but only on that one sandboxed report -- the boundary is
  enforced server-side, see server/services/demo.service.js. Nothing here
  grants a real entitlement.
*/

const STEPS = [
  {
    icon: '',
    heading: 'Welcome to Reelytic',
    body: 'You give us a sheet of Instagram links. You get back a report your client will accept. Let us show you with a finished example, it takes about a minute.',
  },
  {
    icon: '',
    heading: 'Your sheet, your columns',
    body: 'Upload the spreadsheet you already keep. Your own columns stay exactly where you put them, and the views, likes, comments and engagement rate get filled in alongside them.',
  },
  {
    icon: '',
    heading: 'Have a look at a real one',
    body: 'We have made you a sample report using example creators. Nothing was charged and no data was pulled, it is there purely so you can click around a finished report before running your own.',
    final: true,
  },
];

export function WelcomeTour({ onDone, username }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = STEPS[step];

  /*
    Opens (or re-creates) the sample and hands off to the guided tour.

    Retries once because this failed for a user on a transient server blip
    and left them staring at an error with no way forward, which is the worst
    possible first impression. The sample endpoint is idempotent, so a second
    attempt is free and cannot produce a duplicate.
  */
  const openSample = async () => {
    setBusy(true);
    setError('');
    const attempt = () => apiFetch('/jobs/demo', { method: 'POST' });
    try {
      let res;
      try {
        res = await attempt();
      } catch (first) {
        await new Promise((r) => setTimeout(r, 900));
        res = await attempt();
      }
      // Mark the first checklist item done before navigating, so the
      // checklist is already one step in when they land.
      try { localStorage.setItem('rl-onboarding-sample-seen', '1'); } catch (e) { /* private mode */ }
      // Hand off to the in-context walkthrough: the modal's job ends here.
      startDemoGuide(res.jobId, username);
      onDone();
      navigate(`/reels?job=${res.jobId}`);
    } catch (err) {
      // Never trap someone in onboarding because a sample failed to build.
      setError('Could not open the sample just now. Try again, or explore on your own.');
      setBusy(false);
    }
  };

  return (
    <div
      className="rl-modal-overlay"
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 'var(--s4)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Reelytic"
    >
      <div className="card rl-modal-sheet" style={{ width: '480px', maxWidth: '100%', padding: 'var(--s7) var(--s6) var(--s6)', textAlign: 'center' }}>
        <div className="rl-modal-handle" style={{ display: 'none' }} aria-hidden="true" />
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s3)' }}>
          {current.heading}
        </h2>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)', lineHeight: 1.6, marginBottom: 'var(--s6)' }}>
          {current.body}
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: 'var(--s6)' }}>
          {STEPS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === step ? '24px' : '8px', height: '8px', borderRadius: '4px',
                backgroundColor: i === step ? 'var(--accent)' : 'var(--border-strong)',
                transition: 'all 200ms ease',
              }}
            />
          ))}
        </div>

        {error && (
          <p style={{ color: 'var(--err)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s3)' }}>{error}</p>
        )}

        {current.final ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', height: '40px' }}
              onClick={openSample}
              disabled={busy}
            >
              {busy ? 'Opening your sample...' : 'Show me the sample report'}
            </button>
            <button type="button" className="btn btn-ghost" style={{ width: '100%', height: '40px' }} onClick={onDone}>
              Skip, I'll explore on my own
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              onClick={onDone}
              style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}
            >
              Skip
            </button>
            <div style={{ display: 'flex', gap: '8px' }}>
              {step > 0 && (
                <button type="button" className="btn btn-secondary" style={{ height: '36px', padding: '0 var(--s4)' }} onClick={() => setStep((s) => s - 1)}>
                  Back
                </button>
              )}
              <button type="button" className="btn btn-primary" style={{ height: '36px', padding: '0 var(--s5)' }} onClick={() => setStep((s) => s + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
