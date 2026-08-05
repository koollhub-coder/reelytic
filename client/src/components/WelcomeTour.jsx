import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// First-login orientation for a new client. Purely a UI walkthrough of
// existing, already-shipped features -- no new capability, no vendor/actor
// name, no cost figure, same client-safe language as the rest of the app.
// Shown once (see WelcomeTour usage in Shell.jsx, gated on user.hasSeenTour),
// but replayable any time from Settings.
const STEPS = [
  {
    icon: '👋',
    heading: 'Welcome to Reelytic',
    body: 'A quick look at what you can do here, about a minute, then you\'re free to explore on your own.',
  },
  {
    icon: '🎬',
    heading: 'Reel Reports',
    body: 'Paste a list of reel links and get views, likes, comments, and engagement rate for each one, side by side, ready to export.',
  },
  {
    icon: '👤',
    heading: 'Profile Reports',
    body: 'Point it at a creator\'s profile and get a stable read on their typical performance. Outliers, pinned posts, and sponsored content are automatically excluded, so the number reflects real, organic reach.',
  },
  {
    icon: '⏱️',
    heading: 'Every report, always available',
    body: 'Every report you run is saved to your History and stays there even after you log out. Group related reports into a campaign to compare performance across a whole roster of creators.',
  },
  {
    icon: 'ℹ️',
    heading: 'Nothing hidden',
    body: 'Every number comes from a plain formula, not a black box. "How Is This Calculated" walks through exactly how, with a worked example you can check yourself.',
  },
  {
    icon: '🚀',
    heading: 'You\'re ready',
    body: 'Start with your first report, or explore on your own. You can always come back to this tour later from Settings.',
    final: true,
  },
];

export function WelcomeTour({ onDone }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleStart = () => {
    onDone();
    navigate('/reels');
  };

  return (
    <div className="rl-modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 'var(--s4)' }}>
      <div className="card rl-modal-sheet" style={{ width: '480px', maxWidth: '100%', padding: 'var(--s7) var(--s6) var(--s6)', textAlign: 'center' }}>
        <div className="rl-modal-handle" style={{ display: 'none' }} aria-hidden="true" />
        <div style={{ fontSize: '44px', marginBottom: 'var(--s4)' }}>{current.icon}</div>
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

        {current.final ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button type="button" className="btn btn-primary" style={{ width: '100%', height: '40px' }} onClick={handleStart}>
              Start my first report
            </button>
            <button type="button" className="btn btn-ghost" style={{ width: '100%', height: '40px' }} onClick={onDone}>
              Explore on my own
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
