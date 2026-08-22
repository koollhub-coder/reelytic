import React, { useRef, useState } from 'react';
import { PencilIcon } from './Icon';

/*
  Every campaign needs a distinguishable mark next to its name in a list --
  without one, "Puma", "Nike" and "Q3 Push" are just three rows of text that
  all look the same at a glance. Real image upload is a separate feature (its
  own storage/endpoint); this covers the always-available fallback: a
  deterministic initial + color derived from the campaign's own name, so two
  different campaigns reliably render two different colors and the same
  campaign always renders the same one, with no extra data required.

  Accepts an optional `avatarUrl` now so campaigns already carrying a real
  uploaded image (once that lands) render it here with zero call-site changes.
*/

// Fixed palette of the app's own existing tone tokens -- not new colors, the
// same five hues already used for chips/status everywhere else.
const TONES = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--info)', 'var(--err)'];
const SOFTS = ['var(--accent-soft)', 'var(--ok-soft)', 'var(--warn-soft)', 'var(--info-soft)', 'var(--err-soft)'];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function initialsFor(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function CampaignAvatar({ name, avatarUrl, size = 36 }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  const idx = hashString(name || '') % TONES.length;
  return (
    <div
      aria-hidden="true"
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: SOFTS[idx], color: TONES[idx],
        fontFamily: 'var(--font-display)', fontWeight: 700,
        fontSize: `${Math.round(size * 0.4)}px`,
      }}
    >
      {initialsFor(name)}
    </div>
  );
}

// Matches the server's server/routes/campaigns.routes.js validateAvatarDataUri
// exactly (same caps, same allowed types) -- checked here first so a bad file
// gives instant feedback instead of a round trip, same pattern Settings.jsx
// already uses for the report-branding logo upload.
const MAX_AVATAR_BYTES = 512 * 1024;
const ALLOWED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/*
  Click-to-upload version, Instagram-profile-picture style: the circle itself
  is the button. Reads the file into a data URI client-side and hands it to
  onChange -- the caller decides what to do with it (stash in local state
  for a not-yet-created campaign, or PATCH immediately for an existing one).
  Falls back to the same initials avatar until something is chosen.
*/
export function CampaignAvatarPicker({ name, avatarUrl, onChange, size = 44, disabled }) {
  const inputRef = useRef(null);
  const [error, setError] = useState('');

  const handleFile = (file) => {
    if (!file) return;
    setError('');
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setError('Use a PNG, JPG, or WEBP file.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError('Image is too large -- under 512KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result);
    reader.onerror = () => setError("Couldn't read that file, try again");
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => !disabled && inputRef.current && inputRef.current.click()}
        title={disabled ? undefined : 'Change avatar'}
        style={{
          position: 'relative', width: size, height: size, borderRadius: '50%', padding: 0, border: 'none',
          cursor: disabled ? 'default' : 'pointer', background: 'none', flexShrink: 0,
        }}
      >
        <CampaignAvatar name={name} avatarUrl={avatarUrl} size={size} />
        {!disabled && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', bottom: 0, right: 0, width: Math.round(size * 0.4), height: Math.round(size * 0.4),
              borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--accent)', color: '#fff', border: '2px solid var(--surface)',
            }}
          >
            <PencilIcon size={Math.round(size * 0.22)} />
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_AVATAR_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => { handleFile(e.target.files && e.target.files[0]); e.target.value = ''; }}
      />
      {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--err)', marginTop: '4px', maxWidth: '160px' }}>{error}</div>}
    </div>
  );
}
