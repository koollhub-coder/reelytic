import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api/client';
import { Logo } from '../components/Logo';
import { BrandLoader } from '../components/BrandLoader';
import { renderLegalMarkdown } from '../utils/legalMarkdown';
import { useDocumentMeta } from '../hooks/useDocumentMeta';

const TITLES = { terms: 'Terms of Service', privacy: 'Privacy Policy' };
const DESCRIPTIONS = {
  terms: "The terms that govern using Reelytic's Instagram Reel and profile reporting tool.",
  privacy: 'How Reelytic collects, uses, and protects your information.',
};

export function Legal({ type }) {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  useDocumentMeta({
    title: TITLES[type] || 'Legal',
    description: DESCRIPTIONS[type],
    path: `/${type}`,
  });

  useEffect(() => {
    let alive = true;
    setDoc(null);
    setError('');
    apiFetch(`/legal/${type}`)
      .then((d) => { if (alive) setDoc(d); })
      .catch((err) => { if (alive) setError(err.message || 'Could not load this page.'); });
    return () => { alive = false; };
  }, [type]);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg)' }}>
        <p style={{ color: 'var(--text-2)' }}>{error}</p>
      </div>
    );
  }
  if (!doc) return <BrandLoader variant="full" message="Loading..." />;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <header style={{ borderBottom: '1px solid var(--border)', padding: 'var(--s5) var(--s6)' }}>
        <Logo />
      </header>
      <div style={{ maxWidth: '760px', margin: '0 auto', padding: 'var(--s8) var(--s6)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
          {TITLES[type] || 'Legal'}
        </h1>
        <p style={{ color: 'var(--text-3)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s7)' }}>
          {doc.updatedAt
            ? `Last updated ${new Date(doc.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
            : 'Reelytic'}
        </p>
        {renderLegalMarkdown(doc.content)}
      </div>
    </div>
  );
}
