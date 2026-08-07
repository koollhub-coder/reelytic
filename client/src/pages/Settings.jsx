import React, { useState, useEffect, useRef } from 'react';
import { PasswordInput } from '../components/PasswordInput';
import { Select } from '../components/Select';
import { ProBadge } from '../components/ProBadge';
import { WelcomeTour } from '../components/WelcomeTour';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const MAX_LOGO_BYTES = 1024 * 1024;
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const DEFAULT_ACCENT = '#E23E57';

export function Settings() {
  const { user, refreshUser } = useAuth();
  const { addToast } = useToast();
  const [showTour, setShowTour] = useState(false);

  const [branding, setBranding] = useState({ logoDataUri: null, accentColor: DEFAULT_ACCENT, agencyName: '', logoPosition: 'left', showAgencyName: true, showHighlights: true });
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [logoError, setLogoError] = useState('');
  const logoInputRef = useRef(null);

  useEffect(() => {
    apiFetch('/settings/report-branding')
      .then((res) => {
        const b = res.branding || {};
        setBranding({
          logoDataUri: b.logoDataUri || null,
          accentColor: b.accentColor || DEFAULT_ACCENT,
          agencyName: b.agencyName || '',
          logoPosition: b.logoPosition || 'left',
          showAgencyName: b.showAgencyName !== false,
          showHighlights: b.showHighlights !== false,
        });
      })
      .catch(() => {});
  }, []);

  // Read the file into a data URI client-side and check size/type BEFORE it
  // ever reaches the server -- the same caps the server enforces, checked
  // here first so a bad file gives instant feedback instead of a round trip.
  const handleLogoFile = (file) => {
    if (!file) return;
    setLogoError('');
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setLogoError('Logo must be a PNG, JPG, WEBP, or SVG file.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('Logo file is too large. Use an image under 1MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setBranding((b) => ({ ...b, logoDataUri: reader.result }));
    reader.onerror = () => setLogoError("Couldn't read that file, try again");
    reader.readAsDataURL(file);
  };

  const handleBrandingSave = async () => {
    setBrandingSaving(true);
    try {
      await apiFetch('/settings/report-branding', { method: 'PATCH', body: JSON.stringify(branding) });
      addToast('Report branding saved', 'ok');
    } catch (err) {
      addToast(err.message || "Couldn't save branding, try again", 'err');
    } finally {
      setBrandingSaving(false);
    }
  };

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);

  const startEditUsername = () => {
    setUsernameInput(user?.username || '');
    setEditingUsername(true);
  };

  const handleUsernameSave = async () => {
    const next = usernameInput.trim().toLowerCase();
    if (!next || next === user?.username) {
      setEditingUsername(false);
      return;
    }
    setUsernameLoading(true);
    try {
      await apiFetch('/auth/username', { method: 'PATCH', body: JSON.stringify({ username: next }) });
      await refreshUser();
      addToast('Username updated', 'ok');
      setEditingUsername(false);
    } catch (err) {
      addToast(err.message || "Couldn't update your username, try again", 'err');
    } finally {
      setUsernameLoading(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      addToast('Password updated', 'ok');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      addToast(err.message || "Couldn't update your password, try again", 'err');
    } finally {
      setLoading(false);
    }
  };

  const displayName = user?.name || user?.username;
  const initial = (displayName || '?').charAt(0).toUpperCase();

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s6)' }}>Workspace Settings</h1>

      {/* Profile header. flexWrap lets the chip group drop to its own line
          when the avatar + name/email block don't leave room for it, instead
          of forcing the row wider than the viewport. The name div previously
          had no overflow/truncation of its own -- minWidth:0 on its
          container let it shrink narrower than its text, but with nothing
          clipping the text itself it just painted straight through whatever
          sat to its right (the plan/credits chips) on a long username. */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s5)', rowGap: 'var(--s3)', marginBottom: 'var(--s5)', padding: 'var(--s6)' }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: '26px', fontWeight: 700, fontFamily: 'var(--font-display)',
          flexShrink: 0,
        }}>
          {initial}
        </div>
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</div>
          <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email || user?.username}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s3)', flexShrink: 0 }}>
          <span className="chip accent" style={{ textTransform: 'capitalize', padding: '6px 14px', fontWeight: 600 }}>{user?.plan || 'free'} plan</span>
          <span className="chip ok" style={{ padding: '6px 14px', fontWeight: 600 }}>
            {user?.plan === 'unlimited' ? '∞' : (user?.credits ?? 0).toLocaleString()} credits
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--s5)' }}>
        <div className="card">
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Account</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 'var(--s3)', fontSize: 'var(--fs-base)', rowGap: 'var(--s4)' }}>
            {editingUsername ? (
              // Spans the full card width instead of sitting in the narrow
              // 1fr value column -- that column can be well under 200px on
              // a 340px card, not enough room for input + Save + Cancel
              // together without cramming or overflowing.
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="username-edit" className="input-label" style={{ display: 'block', marginBottom: '6px' }}>Username</label>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    id="username-edit"
                    type="text"
                    className="input-field"
                    style={{ height: '32px', fontSize: 'var(--fs-sm)', flex: '1 1 160px', minWidth: 0 }}
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleUsernameSave()}
                    autoFocus
                    maxLength={32}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ height: '32px', fontSize: 'var(--fs-xs)', padding: '0 10px', flexShrink: 0 }}
                    disabled={usernameLoading}
                    onClick={handleUsernameSave}
                  >
                    {usernameLoading ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ height: '32px', fontSize: 'var(--fs-xs)', padding: '0 10px', flexShrink: 0 }}
                    onClick={() => setEditingUsername(false)}
                    disabled={usernameLoading}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
              <span style={{ color: 'var(--text-2)' }}>Username</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                <span className="mono" style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.username}</span>
                <button
                  type="button"
                  onClick={startEditUsername}
                  title="Edit username"
                  aria-label="Edit username"
                  style={{
                    width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--surface-2)', border: '1px solid var(--border-strong)', borderRadius: '50%',
                    color: 'var(--text-2)', cursor: 'pointer', fontSize: '13px', lineHeight: 1, flexShrink: 0,
                    transition: 'background var(--t-fast), color var(--t-fast)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-soft)'; e.currentTarget.style.color = 'var(--accent)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-2)'; }}
                >
                  ✎
                </button>
              </div>
              </>
            )}
            <span style={{ color: 'var(--text-2)' }}>Email</span>
            <span style={{ fontFamily: 'var(--font-data)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email || user?.username}</span>
            <span style={{ color: 'var(--text-2)' }}>Plan</span>
            <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{user?.plan || 'free'}</span>
            <span style={{ color: 'var(--text-2)' }}>Credits</span>
            <span className="mono" style={{ fontWeight: 700 }}>{user?.plan === 'unlimited' ? 'Unlimited' : (user?.credits ?? 0).toLocaleString()}</span>
            {user?.role === 'admin' && (
              <>
                <span style={{ color: 'var(--text-2)' }}>Role</span>
                <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{user?.role}</span>
              </>
            )}
            <div style={{ gridColumn: '1 / -1', marginTop: 'var(--s3)', paddingTop: 'var(--s4)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--s3)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>Welcome tour</div>
                <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)', marginTop: 2 }}>A quick orientation to Reel Reports, Profile Reports, and where everything lives.</div>
              </div>
              <button
                type="button"
                onClick={() => setShowTour(true)}
                className="btn btn-secondary"
                style={{ height: '34px', fontSize: 'var(--fs-xs)', padding: '0 var(--s4)', flexShrink: 0 }}
              >
                Replay
              </button>
            </div>
          </div>
        </div>

        {showTour && <WelcomeTour onDone={() => setShowTour(false)} />}

        <div className="card">
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s1)' }}>Change Password</h3>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>Use a strong password you don't use anywhere else.</p>
          <form onSubmit={handlePasswordChange}>
            <div className="input-group">
              <label className="input-label">Current password</label>
              <PasswordInput value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">New password</label>
              <PasswordInput value={newPassword} onChange={e => setNewPassword(e.target.value)} showStrength={true} autoComplete="new-password" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>

        {/* Spans the full grid width instead of falling into a lone second
            row next to an empty cell (auto-fit wraps 3 cards into a 2-column
            grid on most viewports, leaving Account + Change Password on row
            1 and this card alone on row 2). Full width also gives the form
            room for a real two-column layout below instead of every field
            stacked single-file in a ~340px column. */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s1)' }}>Report branding</h3>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
            Your logo and color appear on branded client reports. Set this once, every report uses it after.
          </p>

          {!user?.features?.reportBranding ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s4)', background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--surface)), var(--surface))', border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))', borderRadius: 'var(--r-md)', padding: 'var(--s5)' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 600 }}>Custom logo, colors, and layout</span>
                  <ProBadge />
                </div>
                <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>Available on Pro and Agency. Yours is currently on <span style={{ textTransform: 'capitalize' }}>{user?.plan || 'free'}</span>.</div>
              </div>
              <a href="/pricing" className="btn btn-primary">View plans</a>
            </div>
          ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s6)' }}>
          <div>
          {/* Live preview -- reflects unsaved changes as you make them, same
              draft-before-commit pattern as any theme/branding editor: you
              see the effect immediately, saving is a separate, deliberate
              step so nothing changes on a stray click. */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', backgroundColor: 'var(--surface-2)', padding: 'var(--s4)', marginBottom: 'var(--s5)' }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--s3)' }}>Preview</div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 'var(--s3)', paddingBottom: 'var(--s3)', borderBottom: `3px solid ${branding.accentColor}`,
              flexDirection: branding.logoPosition === 'right' ? 'row-reverse' : 'row',
              justifyContent: branding.logoPosition === 'center' ? 'center' : (branding.logoPosition === 'right' ? 'flex-end' : 'flex-start'),
            }}>
              {branding.logoDataUri ? (
                <div style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 'var(--r-sm)', padding: '3px 8px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                  <img src={branding.logoDataUri} alt="" style={{ height: '24px', maxWidth: '110px', objectFit: 'contain', display: 'block' }} />
                </div>
              ) : (
                <div style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: branding.accentColor, flexShrink: 0 }} />
              )}
              {branding.showAgencyName && (
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {branding.agencyName || 'Your agency name'}
                </div>
              )}
            </div>
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="branding-agency-name">Agency name</label>
            <input
              id="branding-agency-name"
              type="text"
              className="input-field"
              style={{ width: '100%' }}
              value={branding.agencyName}
              onChange={(e) => setBranding((b) => ({ ...b, agencyName: e.target.value }))}
              placeholder="e.g. Northstar Media"
              maxLength={60}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Logo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                style={{ display: 'none' }}
                onChange={(e) => handleLogoFile(e.target.files[0])}
              />
              <button type="button" className="btn btn-secondary" onClick={() => logoInputRef.current?.click()}>
                {branding.logoDataUri ? 'Change logo' : 'Upload logo'}
              </button>
              {branding.logoDataUri && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setBranding((b) => ({ ...b, logoDataUri: null }))}
                >
                  Remove
                </button>
              )}
            </div>
            {logoError && <div className="input-error">{logoError}</div>}
          </div>
          </div>

          <div>
          <div className="input-group">
            <label className="input-label" htmlFor="branding-accent">Accent color</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
              <input
                id="branding-accent"
                type="color"
                value={branding.accentColor}
                onChange={(e) => setBranding((b) => ({ ...b, accentColor: e.target.value }))}
                style={{ width: '40px', height: '36px', padding: '2px', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)', cursor: 'pointer', background: 'none' }}
              />
              <span className="mono" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>{branding.accentColor}</span>
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">Logo position</label>
            <Select
              value={branding.logoPosition}
              onChange={(v) => setBranding((b) => ({ ...b, logoPosition: v }))}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Centered' },
                { value: 'right', label: 'Right' },
              ]}
              style={{ maxWidth: '220px' }}
            />
          </div>

          <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={branding.showAgencyName}
                onChange={(e) => setBranding((b) => ({ ...b, showAgencyName: e.target.checked }))}
              />
              Show agency name on reports
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={branding.showHighlights}
                onChange={(e) => setBranding((b) => ({ ...b, showHighlights: e.target.checked }))}
              />
              Show top/lowest performer highlights
            </label>
          </div>
          </div>
          </div>
          )}

          {user?.features?.reportBranding && (
            <button type="button" className="btn btn-primary" style={{ marginTop: 'var(--s5)' }} disabled={brandingSaving} onClick={handleBrandingSave}>
              {brandingSaving ? 'Saving...' : 'Save branding'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
