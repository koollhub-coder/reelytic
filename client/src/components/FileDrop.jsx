import React, { useState, useRef } from 'react';

export function FileDrop({ onFileSelected, type = 'reel' }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const fileInputRef = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelected(e.dataTransfer.files[0]);
    }
  };

  const lineCount = pastedText.split(/\r?\n/).map(l => l.trim()).filter(Boolean).length;

  return (
    <div style={{ width: '100%' }}>
      {!pasteMode ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragOver ? 'var(--accent)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--r-lg)',
            backgroundColor: isDragOver ? 'var(--accent-soft)' : 'var(--surface)',
            padding: 'var(--s8)',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all var(--t-base)'
          }}
        >
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".xlsx,.xls,.csv,.txt"
            onChange={e => e.target.files[0] && onFileSelected(e.target.files[0])}
          />
          <div style={{ fontSize: '36px', marginBottom: 'var(--s3)' }}>📂</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)', fontWeight: 600, marginBottom: 'var(--s2)' }}>
            {isDragOver ? 'Drop it here!' : 'Drop your spreadsheet here, or browse'}
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginBottom: 'var(--s4)' }}>
            Accepts .xlsx, .xls, .csv, .txt · up to 2,000 links per run
          </div>
          <button type="button" className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); setPasteMode(true); }}>
            Or paste links instead
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 'var(--s5)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s3)' }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>Paste links (one per line)</span>
            <button className="btn btn-secondary" style={{ height: '30px', fontSize: 'var(--fs-xs)' }} onClick={() => setPasteMode(false)}>Upload file instead</button>
          </div>
          <textarea
            rows={8}
            className="input-field"
            style={{ width: '100%', height: '140px', padding: 'var(--s3)', resize: 'vertical' }}
            placeholder={`https://www.instagram.com/${type === 'reel' ? 'reel/...' : 'creator_handle'}\n...`}
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--s3)' }}>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
              {lineCount} {lineCount === 1 ? 'link' : 'links'} detected
            </span>
            <button
              className="btn btn-primary"
              disabled={lineCount === 0}
              onClick={() => onFileSelected(pastedText)}
            >
              Process {lineCount} links
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
