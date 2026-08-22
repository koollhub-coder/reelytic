import React, { useState, useRef, useEffect } from 'react';
import { CampaignAvatar } from './CampaignAvatar';

/*
  A text field that both searches existing campaigns and creates a new one
  inline when nothing matches -- the standard "creatable combobox" pattern,
  not a separate dropdown-plus-modal. Tagging a campaign at upload time is
  meant to be a one-second decision, not a detour, so typing straight into
  the field and either picking a match or confirming a new name is the
  whole interaction.
*/
export function CampaignCombobox({ campaigns, value, onSelect, onCreate, placeholder = 'No campaign', style }) {
  const selected = campaigns.find((c) => c.id === value);
  const [query, setQuery] = useState(selected ? selected.name : '');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const rootRef = useRef(null);

  // Keeps the field's text in sync if the selection changes from outside
  // (Discard resets it back to none) -- guarded by !open so it never
  // clobbers something the user is actively typing.
  useEffect(() => {
    if (!open) setQuery(selected ? selected.name : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const revert = () => setQuery(selected ? selected.name : '');
    const handleClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) { setOpen(false); revert(); }
    };
    const handleKey = (e) => { if (e.key === 'Escape') { setOpen(false); revert(); } };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, selected]);

  const q = query.trim().toLowerCase();
  const filtered = q ? campaigns.filter((c) => c.name.toLowerCase().includes(q)) : campaigns;
  const exactMatch = campaigns.some((c) => c.name.toLowerCase() === q);
  const canCreate = q.length > 0 && !exactMatch;

  const pick = (c) => { onSelect(c.id); setQuery(c.name); setOpen(false); };
  const clear = () => { onSelect(''); setQuery(''); setOpen(false); };

  const handleCreate = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      const created = await onCreate(query.trim());
      if (created) { onSelect(created.id); setQuery(created.name); setOpen(false); }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div ref={rootRef} style={{ position: 'relative', ...style }}>
      <input
        type="text"
        className="input-field"
        style={{ width: '100%' }}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (canCreate) handleCreate();
          else if (filtered.length === 1) pick(filtered[0]);
        }}
        placeholder={placeholder}
        maxLength={80}
      />
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
            backgroundColor: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 'var(--r-sm)',
            boxShadow: 'var(--shadow-lg)', padding: '4px', maxHeight: '220px', overflowY: 'auto',
          }}
        >
          {query.trim() && (
            <div
              onClick={clear}
              style={{ padding: '8px 10px', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              No campaign
            </div>
          )}
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => pick(c)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '6px 10px', borderRadius: 'var(--r-sm)', cursor: 'pointer', fontSize: 'var(--fs-sm)',
                backgroundColor: c.id === value ? 'var(--accent-soft)' : 'transparent',
                color: c.id === value ? 'var(--accent)' : 'var(--text)',
                fontWeight: c.id === value ? 600 : 400,
              }}
              onMouseEnter={(e) => { if (c.id !== value) e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { if (c.id !== value) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <CampaignAvatar name={c.name} avatarUrl={c.avatarUrl} size={20} />
              {c.name}
            </div>
          ))}
          {filtered.length === 0 && !canCreate && (
            <div style={{ padding: '8px 10px', fontSize: 'var(--fs-sm)', color: 'var(--text-3)' }}>No campaigns yet</div>
          )}
          {canCreate && (
            <div
              onClick={handleCreate}
              style={{
                padding: '8px 10px', borderRadius: 'var(--r-sm)', cursor: creating ? 'default' : 'pointer',
                fontSize: 'var(--fs-sm)', color: 'var(--accent)', fontWeight: 600,
                borderTop: filtered.length > 0 ? '1px solid var(--border)' : 'none', marginTop: filtered.length > 0 ? '4px' : 0,
              }}
              onMouseEnter={(e) => { if (!creating) e.currentTarget.style.backgroundColor = 'var(--accent-soft)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {creating ? 'Creating...' : `+ Create "${query.trim()}"`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
