import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { apiFetch } from '../api/client';
import { useToast } from '../context/ToastContext';
import { formatDate as fmtDate, formatDateTime as fmtDateTime } from '../utils/date';

/*
  The share-link control panel: create a link, choose how long it stays
  active, see whether the client actually opened it, turn it off.

  The expiry model follows what Notion, Dropbox, Loom and SharePoint all
  converged on: a short list of presets covering the common cases, an
  explicit "Never" for people who want a permanent link, a custom date for
  everything else, and -- the part that matters most -- always showing the
  resolved date in plain language rather than leaving the user to work out
  what "7 days" lands on. "Expires 17 Aug 2026" is checkable at a glance;
  "7 days" is a promise the user has to trust.

  Default is 30 days rather than Never. A campaign report has a natural
  shelf life, and the whole reason expiry exists is that links get shared
  once and then forgotten about. Never stays one click away for anyone who
  genuinely wants it.
*/

const PRESETS = [
  { id: '24h', label: '24 hours', hours: 24 },
  { id: '7d', label: '7 days', hours: 24 * 7 },
  { id: '30d', label: '30 days', hours: 24 * 30 },
  { id: 'custom', label: 'Custom' },
  { id: 'never', label: 'Never', hours: null },
];

const DEFAULT_PRESET = '30d';

// Local wrappers keep this file's existing null-on-empty contract, which the
// callers below rely on to decide whether to render the line at all. The
// house format itself lives in utils/date.js.
function formatDateTime(value) {
  return value ? fmtDateTime(value) : null;
}

function formatDate(value) {
  return value ? fmtDate(value) : null;
}

// The value an <input type="datetime-local"> expects, in LOCAL time. Using
// toISOString here would silently shift the shown time by the user's UTC
// offset, so the field would disagree with the date printed beneath it.
function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/*
  Chain-link glyph, the near-universal "copy/share link" affordance (Notion,
  Figma, Dropbox, Linear all use it). Exported so the button that opens this
  dialog can carry the same mark, which is what makes the control readable at
  a glance instead of being a wall of words.
*/
export function LinkIcon({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 3l-1.5 1.5M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21l1.5-1.5"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function defaultCustomValue() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return toLocalInputValue(d);
}

export function ShareDialog({ isOpen, onClose, jobId, onStateChange }) {
  const { addToast } = useToast();
  const [state, setState] = useState(null);
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [customValue, setCustomValue] = useState(defaultCustomValue);
  const [busy, setBusy] = useState(false);

  // Read-only fetch: opening this dialog to look at the settings must not
  // mint a link the agency never asked for.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    apiFetch(`/jobs/${jobId}/share`)
      .then((res) => {
        if (cancelled) return;
        setState(res);
        if (res.shareToken) {
          setPreset(res.shareExpiresAt ? 'custom' : 'never');
          if (res.shareExpiresAt) setCustomValue(toLocalInputValue(new Date(res.shareExpiresAt)));
        }
      })
      .catch(() => { if (!cancelled) setState({ shareToken: null }); });
    return () => { cancelled = true; };
  }, [isOpen, jobId]);

  const shareUrl = state && state.shareToken
    ? `${window.location.origin}/share/${state.shareToken}`
    : '';

  // Custom dates are converted to an hour count because the server owns the
  // arithmetic (see resolveShareExpiry in jobs.routes.js). A raw timestamp
  // from the browser is the viewer's clock, not the server's.
  const selectedHours = () => {
    if (preset === 'never') return null;
    if (preset !== 'custom') return PRESETS.find((p) => p.id === preset).hours;
    const target = new Date(customValue).getTime();
    if (!Number.isFinite(target)) return undefined;
    const hours = (target - Date.now()) / 3600000;
    return hours > 0 ? hours : undefined;
  };

  const previewExpiry = () => {
    const hours = selectedHours();
    if (hours === null) return 'This link stays active until you turn it off.';
    if (hours === undefined) return null;
    return `Expires ${formatDateTime(new Date(Date.now() + hours * 3600000))}`;
  };

  const applyState = (res) => {
    setState(res);
    if (onStateChange) onStateChange(res);
  };

  const save = async ({ copyAfter }) => {
    const hours = selectedHours();
    if (hours === undefined) {
      addToast('Pick a date in the future for this link to expire.', 'err');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/jobs/${jobId}/share`, {
        method: 'POST',
        body: JSON.stringify({ expiresInHours: hours }),
      });
      applyState(res);
      if (copyAfter) {
        await navigator.clipboard.writeText(`${window.location.origin}/share/${res.shareToken}`);
        addToast('Shareable link copied. Anyone with it can view this report, no login needed.', 'ok');
      } else {
        addToast('Link settings saved.', 'ok');
      }
      /*
        Close on success.

        Creating the link and saving settings are both terminal actions: the
        work is finished and the toast already confirms it. Leaving the dialog
        open made the user dismiss it themselves every single time, which is
        one pointless click on the happy path. The status line behind the
        dialog carries the same state, so nothing is lost by closing.
      */
      onClose();
    } catch (err) {
      addToast(err.message || "Couldn't update the link", 'err');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    addToast('Link copied', 'ok');
  };

  const handleRevoke = async () => {
    setBusy(true);
    try {
      await apiFetch(`/jobs/${jobId}/share/revoke`, { method: 'POST' });
      applyState({ shareToken: null, shareExpiresAt: null, shareViews: 0, shareLastViewedAt: null });
      setPreset(DEFAULT_PRESET);
      addToast('Shareable link turned off. Anyone holding it now sees an inactive-link message.', 'ok');
      // Also terminal: there is no link left to manage.
      onClose();
    } catch (err) {
      addToast(err.message || "Couldn't turn off the link", 'err');
    } finally {
      setBusy(false);
    }
  };

  const hasLink = !!(state && state.shareToken);
  const expired = !!(state && state.shareExpiresAt && new Date(state.shareExpiresAt).getTime() <= Date.now());

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Share this report" width="520px">
      {!state ? (
        <div style={{ padding: 'var(--s6) 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-sm)' }}>
          Loading link settings...
        </div>
      ) : (
        <div>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
            Anyone with this link can open the report in a browser. They do not need a Reelytic account.
          </p>

          {hasLink && (
            <div style={{ marginBottom: 'var(--s5)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--s2)',
                backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', padding: '6px 6px 6px var(--s3)',
              }}>
                <span
                  className="mono"
                  title={shareUrl}
                  style={{
                    flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-2)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                >
                  {shareUrl}
                </span>
                <button type="button" className="btn btn-secondary" onClick={handleCopy} style={{ flexShrink: 0, height: '30px', padding: '0 var(--s3)' }}>
                  Copy
                </button>
              </div>
              {expired && (
                <div style={{ marginTop: 'var(--s2)', fontSize: 'var(--fs-xs)', color: 'var(--err)' }}>
                  This link has expired. Pick a new window below and save to make it work again.
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--s3)' }}>
            Link expiry
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)', marginBottom: 'var(--s3)' }}>
            {PRESETS.map((p) => {
              const active = preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  style={{
                    height: '34px', padding: '0 var(--s4)',
                    fontSize: 'var(--fs-sm)', fontWeight: active ? 700 : 500,
                    borderRadius: 'var(--r-full)', cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    backgroundColor: active ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text-2)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {preset === 'custom' && (
            <input
              type="datetime-local"
              className="input-field"
              value={customValue}
              min={toLocalInputValue(new Date())}
              onChange={(e) => setCustomValue(e.target.value)}
              style={{ marginBottom: 'var(--s3)' }}
            />
          )}

          {/* The resolved date, always. A preset the user cannot check is a
              promise they have to take on trust. */}
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginBottom: 'var(--s5)', minHeight: '20px' }}>
            {previewExpiry() || (
              <span style={{ color: 'var(--err)' }}>Pick a date in the future.</span>
            )}
          </div>

          {hasLink && (
            <div style={{
              borderTop: '1px solid var(--border)', paddingTop: 'var(--s4)', marginBottom: 'var(--s5)',
              fontSize: 'var(--fs-sm)', color: 'var(--text-2)',
            }}>
              {state.shareViews > 0 ? (
                <>
                  Opened <strong style={{ color: 'var(--text)' }}>{state.shareViews}</strong>
                  {state.shareViews === 1 ? ' time' : ' times'}
                  {state.shareLastViewedAt ? `, last on ${formatDate(state.shareLastViewedAt)}` : ''}
                </>
              ) : (
                <span style={{ color: 'var(--text-3)' }}>Not opened yet.</span>
              )}
              {/* Said plainly, because an agency will reasonably wonder. */}
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: '4px' }}>
                Counts how many times the link was opened, not who opened it.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {hasLink && (
              <button type="button" className="btn btn-ghost" onClick={handleRevoke} disabled={busy} style={{ marginRight: 'auto' }}>
                Turn off link
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
            <button type="button" className="btn btn-primary" onClick={() => save({ copyAfter: !hasLink })} disabled={busy}>
              {busy ? 'Saving...' : hasLink ? 'Save changes' : 'Create link and copy'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
