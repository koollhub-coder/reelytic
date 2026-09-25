import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Tooltip } from './Tooltip';
import { apiFetch } from '../api/client';
import { useToast } from '../context/ToastContext';
import { formatDate as fmtDate } from '../utils/date';

/*
  The client portal control panel: one persistent link per campaign, unlike
  ShareDialog.jsx which mints a link per report with an optional expiry.
  There is no expiry here on purpose -- the whole point is a link a client
  keeps open and revisits as more reports land in the campaign, so "Turn off"
  is the only lifecycle control this needs.
*/

function formatDate(value) {
  return value ? fmtDate(value) : null;
}

export function PortalDialog({ isOpen, onClose, campaignId, campaignName }) {
  const { addToast } = useToast();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  // Read-only fetch on open, same reasoning as ShareDialog: looking at the
  // settings must not itself turn the portal on.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    apiFetch(`/campaigns/${campaignId}/portal`)
      .then((res) => { if (!cancelled) setState(res); })
      .catch(() => { if (!cancelled) setState({ portalToken: null }); });
    return () => { cancelled = true; };
  }, [isOpen, campaignId]);

  const portalUrl = state && state.portalToken
    ? `${window.location.origin}/portal/${state.portalToken}`
    : '';
  const hasLink = !!(state && state.portalToken);

  const createLink = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`/campaigns/${campaignId}/portal`, { method: 'POST' });
      setState(res);
      await navigator.clipboard.writeText(`${window.location.origin}/portal/${res.portalToken}`);
      addToast('Client portal link created and copied. It updates automatically as you add reports.', 'ok');
    } catch (err) {
      addToast(err.message || "Couldn't create the portal link", 'err');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(portalUrl);
    addToast('Link copied', 'ok');
  };

  const handleRevoke = async () => {
    setBusy(true);
    try {
      await apiFetch(`/campaigns/${campaignId}/portal/revoke`, { method: 'POST' });
      setState({ portalToken: null, portalViews: 0, portalLastViewedAt: null });
      addToast('Client portal turned off. Anyone holding the link now sees an inactive-link message.', 'ok');
      onClose();
    } catch (err) {
      addToast(err.message || "Couldn't turn off the portal", 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Client portal: ${campaignName}`} width="520px">
      {!state ? (
        <div style={{ padding: 'var(--s6) 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-sm)' }}>
          Loading portal settings...
        </div>
      ) : (
        <div>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
            One link that shows every report in this campaign, rolled up into a single view. No login needed on their end, and it updates automatically every time you add a new report here.
          </p>

          {hasLink && (
            <div style={{ marginBottom: 'var(--s5)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--s2)',
                backgroundColor: 'var(--surface-2)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', padding: '6px 6px 6px var(--s3)',
              }}>
                <Tooltip content={portalUrl}>
                  <span
                    className="mono"
                    style={{
                      flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-2)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {portalUrl}
                  </span>
                </Tooltip>
                <button type="button" className="btn btn-secondary" onClick={handleCopy} style={{ flexShrink: 0, height: '30px', padding: '0 var(--s3)' }}>
                  Copy
                </button>
              </div>
            </div>
          )}

          {hasLink && (
            <div style={{
              borderTop: '1px solid var(--border)', paddingTop: 'var(--s4)', marginBottom: 'var(--s5)',
              fontSize: 'var(--fs-sm)', color: 'var(--text-2)',
            }}>
              {state.portalViews > 0 ? (
                <>
                  Opened <strong style={{ color: 'var(--text)' }}>{state.portalViews}</strong>
                  {state.portalViews === 1 ? ' time' : ' times'}
                  {state.portalLastViewedAt ? `, last on ${formatDate(state.portalLastViewedAt)}` : ''}
                </>
              ) : (
                <span style={{ color: 'var(--text-3)' }}>Not opened yet.</span>
              )}
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: '4px' }}>
                Counts how many times the link was opened, not who opened it.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {hasLink && (
              <button type="button" className="btn btn-ghost" onClick={handleRevoke} disabled={busy} style={{ marginRight: 'auto' }}>
                Turn off portal
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
            {!hasLink && (
              <button type="button" className="btn btn-primary" onClick={createLink} disabled={busy}>
                {busy ? 'Creating...' : 'Create link and copy'}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
