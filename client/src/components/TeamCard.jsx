import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { useToast } from '../context/ToastContext';
import { ProBadge, PREMIUM_FEATURES } from './Premium';
import { UserPlusIcon, UsersIcon, TrashIcon, ClockIcon } from './Icon';
import { Tooltip } from './Tooltip';

/*
  Team management, embedded in Workspace Settings. Same locked-overlay
  pattern as the Report Branding card just above it on that page (see
  Settings.jsx): the real card renders underneath, dimmed and inert, with an
  upgrade card sitting over it, so a free account sees what they'd be
  buying instead of an explanatory paragraph in its place. inert-by-CSS
  only -- team.routes.js is what actually enforces the gate.

  A team member (as opposed to the account owner) sees a much smaller,
  read-only version: who owns the workspace, how many seats are in use,
  nothing they could act on. Managing the team is an owner-only action,
  same as billing.
*/

function SeatRow({ seat, onRemove, removing }) {
  return (
    <div className="rl-info-row">
      <span className="rl-info-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {seat.name || seat.username}
        {seat.isOwner && <span className="chip" style={{ fontSize: '9px', fontWeight: 700 }}>OWNER</span>}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', minWidth: 0 }}>
        <span className="mono rl-info-value" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {seat.email || seat.username}
        </span>
        {!seat.isOwner && (
          <Tooltip content="Remove from team">
            <button
              type="button"
              onClick={() => onRemove(seat.username)}
              disabled={removing === seat.username}
              aria-label={`Remove ${seat.username}`}
              style={{
                width: '26px', height: '26px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                color: 'var(--text-3)', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--err)'; e.currentTarget.style.borderColor = 'var(--err)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <TrashIcon size={13} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export function TeamCard({ user }) {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const locked = !user?.features?.teamSeats;

  const load = () => {
    apiFetch('/team')
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    setInviting(true);
    try {
      await apiFetch('/team/invite', { method: 'POST', body: JSON.stringify({ email }) });
      addToast('Invite sent', 'ok');
      setInviteEmail('');
      load();
    } catch (err) {
      addToast(err.message || "Couldn't send that invite, try again", 'err');
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (username) => {
    setRemoving(username);
    try {
      await apiFetch(`/team/${username}`, { method: 'DELETE' });
      addToast('Removed from team', 'ok');
      load();
    } catch (err) {
      addToast(err.message || "Couldn't remove them, try again", 'err');
    } finally {
      setRemoving(null);
    }
  };

  const handleCancelInvite = async (token) => {
    setCancelling(token);
    try {
      await apiFetch(`/team/invite/${token}`, { method: 'DELETE' });
      addToast('Invite cancelled', 'ok');
      load();
    } catch (err) {
      addToast(err.message || "Couldn't cancel that invite, try again", 'err');
    } finally {
      setCancelling(null);
    }
  };

  // A member sees a compact, read-only summary -- no invite form, no
  // remove buttons. Team management is the owner's job, the same way
  // billing is (see BillingPlans.jsx / billing.routes.js requireAccountOwner).
  if (user?.isTeamMember) {
    return (
      <div className="card" data-tour="team-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: '2px' }}>
          <UsersIcon size={17} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Team</h3>
        </div>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s3)' }}>
          {loading ? 'Loading...' : (
            <>You're part of <strong style={{ color: 'var(--text)' }}>{data?.ownerName || 'a'}</strong>'s workspace, sharing their reports, campaigns and credits.{data ? ` ${data.seatCount} of ${data.maxSeats} seats in use.` : ''}</>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="card" data-tour="team-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: '2px' }}>
        <UsersIcon size={17} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Team</h3>
      </div>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
        Invite teammates to share this workspace. Everyone sees the same reports, campaigns and credits; only you manage billing.
      </p>

      <div style={{ position: 'relative' }}>
        {locked && (
          <>
            <div
              aria-hidden="true"
              style={{
                position: 'absolute', inset: 0, zIndex: 2, borderRadius: 'var(--r-md)',
                background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface) 55%, transparent), var(--surface) 60%)',
              }}
            />
            <div style={{ position: 'absolute', inset: 0, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--s4)' }}>
              <div style={{
                textAlign: 'center', maxWidth: '380px',
                backgroundColor: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-lg)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.18)', padding: 'var(--s6) var(--s5)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s3)' }}>
                  <ProBadge />
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
                  {PREMIUM_FEATURES.teamSeats.title}
                </div>
                <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
                  {PREMIUM_FEATURES.teamSeats.description}
                </div>
                <a href="/pricing" className="btn btn-primary" style={{ width: '100%' }}>See plans</a>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 'var(--s3)' }}>
                  You're on <span style={{ textTransform: 'capitalize' }}>{user?.plan || 'free'}</span>. Included on Starter, Pro and Agency.
                </div>
              </div>
            </div>
          </>
        )}

        <div aria-hidden={locked} style={locked ? { pointerEvents: 'none', userSelect: 'none', filter: 'saturate(0.5)', opacity: 0.9 } : undefined}>
          {loading ? (
            <div style={{ padding: 'var(--s5) 0', textAlign: 'center', color: 'var(--text-3)', fontSize: 'var(--fs-sm)' }}>Loading team...</div>
          ) : (
            <>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s2)' }}>
                {data ? `${data.seatCount} of ${data.maxSeats} seats used` : ''}
              </div>
              <div className="rl-info-list" style={{ marginBottom: 'var(--s4)' }}>
                {(data?.seats || []).map((seat) => (
                  <SeatRow key={seat.username} seat={seat} onRemove={handleRemove} removing={removing} />
                ))}
              </div>

              {data?.pendingInvites?.length > 0 && (
                <div style={{ marginBottom: 'var(--s4)' }}>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--s2)' }}>
                    Pending invites
                  </div>
                  {data.pendingInvites.map((inv) => (
                    <div key={inv.token} className="rl-info-row">
                      <span className="rl-info-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-2)' }}>
                        <ClockIcon size={13} style={{ color: 'var(--text-3)' }} />
                        {inv.email}
                      </span>
                      <button
                        type="button"
                        className="rl-text-link"
                        style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)' }}
                        disabled={cancelling === inv.token}
                        onClick={() => handleCancelInvite(inv.token)}
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleInvite} style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                <input
                  type="email"
                  className="input-field"
                  style={{ flex: '1 1 200px', minWidth: 0 }}
                  placeholder="teammate@youragency.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={data && data.seatCount >= data.maxSeats}
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flexShrink: 0, gap: 'var(--s2)' }}
                  disabled={inviting || !inviteEmail.trim() || (data && data.seatCount >= data.maxSeats)}
                >
                  <UserPlusIcon size={15} />{inviting ? 'Sending...' : 'Invite'}
                </button>
              </form>
              {data && data.seatCount >= data.maxSeats && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 'var(--s2)' }}>
                  You're using every seat on your plan. Remove someone or upgrade to invite another.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
