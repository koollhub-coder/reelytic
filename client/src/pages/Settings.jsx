import React, { useState, useEffect, useRef } from 'react';
import { PasswordInput } from '../components/PasswordInput';
import { Select } from '../components/Select';
import { ProBadge, PREMIUM_FEATURES } from '../components/Premium';
import { WelcomeTour } from '../components/WelcomeTour';
import { Tooltip } from '../components/Tooltip';
import {
  PencilIcon, ReplayIcon, ShieldIcon, TourIcon, PaletteIcon, ProfileIcon,
  FileIcon, DownloadIcon, ShareIcon, SuccessIcon, WarningIcon, ClockIcon,
  TrendingUpIcon, TrendingDownIcon, EyeIcon,
} from '../components/Icon';
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
    if (file.size >MAX_LOGO_BYTES) {
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

  const displayName = user?.username;
  const initial = (displayName || '?').charAt(0).toUpperCase();

  return (
    <div style={{ maxWidth: '1400px' }}>
      {/* Compact header: title/subtitle left, workspace identity right --
          not a profile hero. Same flexWrap-drops-to-its-own-line reasoning
          as before: the identity cluster moves under the title on a narrow
          viewport instead of forcing the row wider than the page. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700 }}>Workspace Settings</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>Manage your account, security and branded report preferences.</p>
        </div>
        {/* flexWrap here too, not just on the outer row -- the outer wrap
            alone only moved this whole avatar+name+chips cluster onto its
            own line; as the sole item on that line a flex item's width
            defaults to its own unwrapped content width (avatar + name +
            email + two chips, ~423px) rather than the space actually
            available, so it grew straight past a phone's viewport with
            nothing left to wrap inside it. maxWidth:100% is what actually
            constrains it back down to that available width so flexWrap has
            something to do. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap', maxWidth: '100%', flexShrink: 0 }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-hover))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 'var(--fs-md)', fontWeight: 700, fontFamily: 'var(--font-display)',
          }}>
            {initial}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>{displayName}</span>
              {user?.role === 'admin' && <span className="chip" style={{ fontSize: '10px', fontWeight: 700 }}>ADMIN</span>}
            </div>
            <div style={{ color: 'var(--text-3)', fontSize: 'var(--fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
              {user?.email || user?.username}
            </div>
          </div>
          <span className="chip accent" style={{ textTransform: 'capitalize', padding: '5px 12px', fontWeight: 600, flexShrink: 0 }}>{user?.plan || 'free'} Plan</span>
          <span className="chip ok" style={{ padding: '5px 12px', fontWeight: 600, flexShrink: 0 }}>
            {user?.plan === 'unlimited' ? '∞' : (user?.credits ?? 0).toLocaleString()} credits
          </span>
        </div>
      </div>

      {/* Account / Security / Guided Tour: one row, consistent height. Real
          3-up grid rather than auto-fit's 2-then-1 wrap, so all three stay
          scannable together down to tablet width before stacking. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--s4)', marginBottom: 'var(--s4)' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: '2px' }}>
            <ProfileIcon size={16} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>Account</h3>
          </div>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s3)' }}>View and manage your account details.</p>
          {/* Bordered label/value rows, not a grid that collapses to two
              stacked left-aligned lines on a phone. This layout is the same
              shape on every viewport -- label left, value right, a hairline
              between rows -- which is what removes the "does this even have
              a design" look a plain stacked list gets on mobile. */}
          <div className="rl-info-list">
            {editingUsername ? (
              <div style={{ padding: 'var(--s3) 0' }}>
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
              <div className="rl-info-row">
                <span className="rl-info-label">Username</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', minWidth: 0 }}>
                  <span className="mono rl-info-value" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.username}</span>
                  <Tooltip content="Edit username">
                    <button
                      type="button"
                      onClick={startEditUsername}
                      aria-label="Edit username"
                      style={{
                        // A rounded square, not a circle. A 26px circle around a
                        // 14px glyph reads as an avatar or a status dot; every
                        // toolbar-style edit affordance in this class of product
                        // is a soft-cornered square, and it stops the control
                        // competing with the username beside it.
                        width: '28px', height: '28px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                        color: 'var(--text-3)', cursor: 'pointer', lineHeight: 0, flexShrink: 0, padding: 0,
                        transition: 'background var(--t-fast), color var(--t-fast), border-color var(--t-fast)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-3)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                    >
                      <PencilIcon size={14} />
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}
            <div className="rl-info-row">
              <span className="rl-info-label">Email</span>
              <span className="rl-info-value" style={{ fontFamily: 'var(--font-data)', overflowWrap: 'anywhere' }}>{user?.email || user?.username}</span>
            </div>
            <div className="rl-info-row">
              <span className="rl-info-label">Plan</span>
              <span className="rl-info-value" style={{ textTransform: 'capitalize' }}>{user?.plan || 'free'}</span>
            </div>
            <div className="rl-info-row">
              <span className="rl-info-label">Credits</span>
              <span className="rl-info-value mono">{user?.plan === 'unlimited' ? 'Unlimited' : (user?.credits ?? 0).toLocaleString()}</span>
            </div>
            {user?.role === 'admin' && (
              <div className="rl-info-row">
                <span className="rl-info-label">Role</span>
                <span className="rl-info-value" style={{ textTransform: 'uppercase' }}>{user?.role}</span>
              </div>
            )}
          </div>
        </div>

        {/* Security: same form, same handler, same PasswordInput component
            (visibility toggle/strength meter/validation all live there,
            untouched) -- just given a section icon/description to match
            Account and Guided Tour's header shape. */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: '2px' }}>
            <ShieldIcon size={16} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>Security</h3>
          </div>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s3)' }}>Update your password and keep your account secure.</p>
          <form onSubmit={handlePasswordChange}>
            <div className="input-group">
              <label className="input-label">Current password</label>
              <PasswordInput value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">New password</label>
              <PasswordInput value={newPassword} onChange={e => setNewPassword(e.target.value)} showStrength={true} autoComplete="new-password" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>

        {/* Guided Tour: same setShowTour(true) -> WelcomeTour trigger as
            before, just given its own card instead of living as a footnote
            under Account. The numbered flow is decorative (three existing
            icons + dashed connector lines); "Start the tour" is still the
            only thing that actually does anything here. */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: '2px' }}>
            <TourIcon size={16} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)', fontWeight: 700 }}>Guided Tour</h3>
          </div>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s3)' }}>Learn how reports, exports, client sharing and branding work.</p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--s2) var(--s1)', marginBottom: 'var(--s3)' }}>
            {[
              { Icon: FileIcon, label: 'Create' },
              { Icon: DownloadIcon, label: 'Export' },
              { Icon: ShareIcon, label: 'Share' },
            ].map((step, i, arr) => (
              <React.Fragment key={step.label}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <div style={{
                    width: '34px', height: '34px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 700, fontSize: 'var(--fs-xs)',
                    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent)', position: 'relative',
                  }}>
                    <step.Icon size={15} />
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{step.label}</span>
                </div>
                {i < arr.length - 1 && (
                  <div aria-hidden="true" style={{ flex: 1, height: 0, borderTop: '2px dotted color-mix(in srgb, var(--accent) 45%, transparent)', margin: '0 6px', marginBottom: '16px' }} />
                )}
              </React.Fragment>
            ))}
          </div>

          <ul style={{ listStyle: 'none', margin: '0 0 var(--s3) 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {['Six quick steps', 'Sample data & safe to explore', 'No credits charged', 'Your existing reports stay unchanged'].map((line) => (
              <li key={line} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--fs-xs)', color: 'var(--text-2)' }}>
                <SuccessIcon size={13} style={{ color: 'var(--ok)', flexShrink: 0 }} />{line}
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => setShowTour(true)}
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 'auto', gap: 'var(--s2)' }}
          >
            <ReplayIcon size={15} />Start the tour
          </button>
        </div>
      </div>

      {showTour && <WelcomeTour onDone={() => setShowTour(false)} username={user?.username} />}

      {/* Report Branding: full-width, primary section (per its outsized
          effect on client-facing reports) -- no longer competing for grid
          space with the three cards above it. */}
      <div className="card" data-tour="branding-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginBottom: '2px' }}>
          <PaletteIcon size={17} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Report Branding</h3>
        </div>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
            Your logo and color appear on branded client reports. Set this once, every report uses it after.
          </p>

          {/* Locked state shows the real editor underneath, dimmed and
              inert, with the upgrade card sitting over it. Seeing the thing
              you'd be buying is the whole point -- an explanatory paragraph
              in place of the form teaches nobody what branding actually
              does. inert-by-CSS only, so the server gate (settings.routes.js)
              is still the thing that actually enforces this. */}
          <div style={{ position: 'relative' }}>
          {!user?.features?.reportBranding && (
            <>
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute', inset: 0, zIndex: 2, borderRadius: 'var(--r-md)',
                  background: 'linear-gradient(180deg, color-mix(in srgb, var(--surface) 55%, transparent), var(--surface) 60%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              />
              <div style={{
                position: 'absolute', inset: 0, zIndex: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--s4)',
              }}>
                <div style={{
                  textAlign: 'center', maxWidth: '380px',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--r-lg)',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
                  padding: 'var(--s6) var(--s5)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--s3)' }}>
                    <ProBadge />
                  </div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
                    {PREMIUM_FEATURES.reportBranding.title}
                  </div>
                  <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, marginBottom: 'var(--s5)' }}>
                    {PREMIUM_FEATURES.reportBranding.description}
                  </div>
                  <a href="/pricing" className="btn btn-primary" style={{ width: '100%' }}>See plans</a>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 'var(--s3)' }}>
                    You're on <span style={{ textTransform: 'capitalize' }}>{user?.plan || 'free'}</span>. Included on Pro and Agency.
                  </div>
                </div>
              </div>
            </>
          )}
          <div
            aria-hidden={!user?.features?.reportBranding}
            style={!user?.features?.reportBranding
              ? { pointerEvents: 'none', userSelect: 'none', filter: 'saturate(0.5)', opacity: 0.9 }
              : undefined}
          >
          {(
          /* Two explicit columns with the preview spanning both.

             It used to be a plain auto-fit grid with the preview stacked on
             top of the left column, which left the right column two fields
             short and opened a large dead area at the bottom right of the
             card. Spanning the preview also happens to be more honest: what
             it previews is a report header, and that runs the full width of
             the real report. */
          <div className="rl-branding-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--s5) var(--s6)', alignItems: 'start' }}>
          {/* LEFT: configuration. DOM order (config before preview) is what
              makes mobile stack config-first without any extra CSS. */}
          <div>
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

            <div className="input-group" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
              <label className="input-label">Logo</label>
              {/* Real drop-zone-shaped upload area (was just a button) --
                  clearer target, same file input/handler underneath. */}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                style={{ display: 'none' }}
                onChange={(e) => handleLogoFile(e.target.files[0])}
              />
              {branding.logoDataUri ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', padding: 'var(--s3)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', backgroundColor: 'var(--surface-2)' }}>
                  <div style={{ backgroundColor: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 'var(--r-sm)', padding: '4px 8px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <img src={branding.logoDataUri} alt="" style={{ height: '28px', maxWidth: '100px', objectFit: 'contain', display: 'block' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--s3)', fontSize: 'var(--fs-sm)' }}>
                    <button type="button" className="rl-text-link" onClick={() => logoInputRef.current?.click()}>Change</button>
                    <button type="button" className="rl-text-link" style={{ color: 'var(--err)' }} onClick={() => setBranding((b) => ({ ...b, logoDataUri: null }))}>Remove</button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', width: '100%',
                    padding: 'var(--s4)', border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-md)',
                    background: 'var(--surface-2)', color: 'var(--text-2)', cursor: 'pointer',
                  }}
                >
                  <DownloadIcon size={18} style={{ transform: 'rotate(180deg)', color: 'var(--text-3)' }} />
                  <span style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>Upload logo</span>
                  <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>PNG, JPG or SVG · Max 2MB</span>
                </button>
              )}
              {logoError && <div className="input-error">{logoError}</div>}
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
                style={{ width: '100%' }}
              />
            </div>

            <button type="button" className="btn btn-primary" style={{ marginTop: 'var(--s3)' }} disabled={brandingSaving || !user?.features?.reportBranding} onClick={handleBrandingSave}>
              {brandingSaving ? 'Saving...' : 'Save branding'}
            </button>
          </div>

          {/* RIGHT: live preview -- a light surface inside the dark settings
              page on purpose, so it reads as "this is what your client
              sees" rather than more settings-page chrome. Reflects unsaved
              changes as you make them (draft-before-commit, same as any
              theme editor); Save is the separate, deliberate step that
              actually persists it. The summary/highlights/table numbers
              below are static representative content -- this page has no
              real report loaded to preview against, and the instruction was
              explicit not to invent a new calculation or API call just to
              fill this in. */}
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            <div style={{ padding: '6px var(--s3)', fontSize: 'var(--fs-xs)', color: 'var(--text-3)', backgroundColor: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
              Live preview
            </div>
            <div style={{ backgroundColor: '#F7F6F3', color: '#1A1C20', padding: 'var(--s4)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--s3)', paddingBottom: 'var(--s3)', marginBottom: 'var(--s3)', borderBottom: `3px solid ${branding.accentColor}`,
                flexDirection: branding.logoPosition === 'right' ? 'row-reverse' : 'row',
                justifyContent: branding.logoPosition === 'center' ? 'center' : (branding.logoPosition === 'right' ? 'flex-end' : 'flex-start'),
              }}>
                {branding.logoDataUri ? (
                  <div style={{ backgroundColor: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '3px 8px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <img src={branding.logoDataUri} alt="" style={{ height: '22px', maxWidth: '90px', objectFit: 'contain', display: 'block' }} />
                  </div>
                ) : (
                  <div style={{ width: '26px', height: '26px', borderRadius: '6px', backgroundColor: branding.accentColor, flexShrink: 0 }} />
                )}
                {branding.showAgencyName && (
                  <div style={{ fontWeight: 700, fontSize: '15px', color: branding.accentColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {branding.agencyName || 'Your agency name'}
                  </div>
                )}
                <div style={{ marginLeft: branding.logoPosition === 'right' ? 0 : 'auto', marginRight: branding.logoPosition === 'right' ? 'auto' : 0, textAlign: branding.logoPosition === 'right' ? 'left' : 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: '13px' }}>Reel Report</div>
                  <div style={{ fontSize: '10px', color: '#8B8F98' }}>Generated {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                </div>
              </div>

              <div className="rl-preview-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: 'var(--s3)' }}>
                {[
                  { value: '200', label: 'Processed', Icon: FileIcon, color: '#5D6169' },
                  { value: '137', sub: '68.5%', label: 'Succeeded', Icon: SuccessIcon, color: '#1F9D6B' },
                  { value: '63', sub: '31.5%', label: 'Failed', Icon: WarningIcon, color: '#D33131' },
                  { value: '16m 47s', label: 'Total time', Icon: ClockIcon, color: '#5D6169' },
                ].map((tile) => (
                  <div key={tile.label} style={{ border: '1px solid #E4E1DA', borderRadius: '6px', padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: tile.color }}>{tile.value}</span>
                      {tile.sub && <span style={{ fontSize: '10px', color: tile.color }}>{tile.sub}</span>}
                    </div>
                    <div style={{ fontSize: '9px', color: '#8B8F98' }}>{tile.label}</div>
                  </div>
                ))}
              </div>

              {branding.showHighlights && (
                <div className="rl-preview-highlights-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: 'var(--s3)' }}>
                  <div style={{ border: '1px solid #E4E1DA', borderRadius: '6px', padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: '#8B8F98', textTransform: 'uppercase' }}><TrendingUpIcon size={10} style={{ color: '#1F9D6B' }} />Top performer</div>
                    <div style={{ fontWeight: 700, fontSize: '11px' }}>@creatorname</div>
                    <div style={{ fontSize: '10px', color: '#1F9D6B' }}>12.5M Views · 3.42% ER</div>
                  </div>
                  <div style={{ border: '1px solid #E4E1DA', borderRadius: '6px', padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: '#8B8F98', textTransform: 'uppercase' }}><TrendingDownIcon size={10} style={{ color: '#D33131' }} />Lowest performer</div>
                    <div style={{ fontWeight: 700, fontSize: '11px' }}>@creatorname</div>
                    <div style={{ fontSize: '10px', color: '#D33131' }}>210K Views · 0.4% ER</div>
                  </div>
                  <div style={{ border: '1px solid #E4E1DA', borderRadius: '6px', padding: '6px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '9px', color: '#8B8F98', textTransform: 'uppercase' }}><EyeIcon size={10} style={{ color: branding.accentColor }} />Avg. engagement rate</div>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: branding.accentColor }}>2.05%</div>
                  </div>
                </div>
              )}

              <div style={{ border: '1px solid #E4E1DA', borderRadius: '6px', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F1EFEA' }}>
                      {['Username', 'Views', 'Likes', 'Comments', 'Shares', 'ER %'].map((h) => (
                        <th key={h} style={{ textAlign: h === 'Username' ? 'left' : 'right', padding: '5px 8px', color: '#5D6169', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['@user_one', '1.2M', '45.1K', '1.2K', '2.3K', '3.76%'],
                      ['@user_two', '980K', '33.5K', '982', '1.8K', '3.42%'],
                      ['@user_three', '870K', '28.7K', '876', '1.5K', '3.21%'],
                    ].map((row) => (
                      <tr key={row[0]} style={{ borderTop: '1px solid #E4E1DA' }}>
                        {row.map((cell, i) => (
                          <td key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '5px 8px', fontWeight: i === 0 ? 600 : 400 }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          </div>
          </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
