import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../api/client';
import { BrandLoader } from '../../components/BrandLoader';
import { useToast } from '../../context/ToastContext';
import { renderLegalMarkdown } from '../../utils/legalMarkdown';

const TABS = [
  { type: 'terms', label: 'Terms of Service' },
  { type: 'privacy', label: 'Privacy Policy' },
];

export function LegalEditor() {
  const { addToast } = useToast();
  const [active, setActive] = useState('terms');
  const [docs, setDocs] = useState({});
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all(TABS.map((t) => apiFetch(`/admin/legal/${t.type}`)))
      .then((results) => {
        if (!alive) return;
        const map = {};
        TABS.forEach((t, i) => { map[t.type] = results[i]; });
        setDocs(map);
        setDraft(map.terms?.content || '');
      })
      .catch((err) => alive && setError(err.message || "Couldn't load legal content."))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const switchTab = (type) => {
    setActive(type);
    setDraft(docs[type]?.content || '');
  };

  const handleSave = async () => {
    if (!draft.trim()) {
      addToast('Content cannot be empty.', 'err');
      return;
    }
    setSaving(true);
    try {
      const updated = await apiFetch(`/admin/legal/${active}`, {
        method: 'PUT',
        body: JSON.stringify({ content: draft }),
      });
      setDocs((prev) => ({ ...prev, [active]: updated }));
      addToast(`${TABS.find((t) => t.type === active)?.label} saved. Live on the public page now.`, 'ok');
    } catch (err) {
      addToast(err.message || "Couldn't save, try again", 'err');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <BrandLoader message="Loading legal content..." />;

  if (error) {
    return (
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Legal Pages</h1>
        <div className="card" style={{ color: 'var(--err)' }}>{error}</div>
      </div>
    );
  }

  const currentDoc = docs[active];
  const dirty = draft !== (currentDoc?.content || '');

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>Legal Pages</h1>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s6)' }}>
        Edits publish immediately to <a href={`/${active}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>/{active}</a> and
        are versioned automatically. Use blank lines between paragraphs, a line starting with <code className="mono">## </code> for a section heading,
        and lines starting with <code className="mono">- </code> for a bullet list -- no other formatting is supported, by design, so this can never
        become an HTML-injection path.
      </p>

      <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s5)', borderBottom: '1px solid var(--border)' }}>
        {TABS.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => switchTab(t.type)}
            style={{
              padding: 'var(--s3) var(--s4)',
              fontSize: 'var(--fs-sm)',
              fontWeight: 600,
              background: 'none',
              border: 'none',
              borderBottom: active === t.type ? '2px solid var(--accent)' : '2px solid transparent',
              color: active === t.type ? 'var(--accent)' : 'var(--text-2)',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginBottom: 'var(--s3)' }}>
        {currentDoc?.updatedAt
          ? `Version ${currentDoc.version} · last updated ${new Date(currentDoc.updatedAt).toLocaleString()} by ${currentDoc.updatedBy}`
          : 'Version 1 · showing the built-in default, never edited yet'}
      </div>

      <div className="rl-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s5)' }}>
        <div>
          <textarea
            className="input-field mono"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: '100%', height: '520px', resize: 'vertical', fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}
            spellCheck={false}
          />
          <button
            className="btn btn-primary"
            style={{ marginTop: 'var(--s3)' }}
            onClick={handleSave}
            disabled={saving || !dirty}
          >
            {saving ? 'Saving...' : dirty ? 'Save & publish' : 'Saved'}
          </button>
        </div>
        <div className="card" style={{ maxHeight: '560px', overflowY: 'auto' }}>
          {renderLegalMarkdown(draft)}
        </div>
      </div>
    </div>
  );
}
