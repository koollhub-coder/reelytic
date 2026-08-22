import React, { useState, useRef } from 'react';
import { CloudUploadIcon, UploadIcon, CopyIcon, ArrowRightIcon } from './Icon';

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

  const lineCount = pastedText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length;

  return (
    <div className="rl-upload-card">
      {!pasteMode ? (
        <div
          className={`rl-upload-dropzone${isDragOver ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".xlsx,.xls,.csv,.txt"
            onChange={(e) => e.target.files[0] && onFileSelected(e.target.files[0])}
          />
          <div className="rl-upload-icon-circle"><CloudUploadIcon size={22} /></div>
          <div className="rl-upload-title">Upload your campaign sheet</div>
          <div className="rl-upload-sub">Excel, CSV or TXT &middot; Up to 2,000 links per run</div>
          <button
            type="button"
            className="btn btn-primary rl-upload-choose-btn"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          >
            <UploadIcon size={16} />Choose file
          </button>
          <div className="rl-upload-divider"><span>or</span></div>
          <button
            type="button"
            className="rl-upload-paste-link"
            onClick={(e) => { e.stopPropagation(); setPasteMode(true); }}
          >
            <CopyIcon size={15} />Paste links instead<ArrowRightIcon size={14} />
          </button>
        </div>
      ) : (
        // Same card, swapped in place -- no modal, no second screen. A
        // click on "Paste links instead" used to open a full dialog on top
        // of this card, which meant leaving the upload screen to do
        // something that's really just an alternate way of feeding the
        // same dropzone.
        <div className="rl-upload-dropzone rl-upload-paste-panel">
          <div className="rl-upload-paste-header">
            <span>Paste links (one per line)</span>
            <button type="button" className="rl-upload-paste-back" onClick={() => setPasteMode(false)}>
              Upload file instead
            </button>
          </div>
          <textarea
            rows={6}
            className="input-field rl-upload-paste-textarea"
            placeholder={`https://www.instagram.com/${type === 'reel' ? 'reel/...' : 'creator_handle'}\n...`}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            autoFocus
          />
          <div className="rl-upload-paste-footer">
            <span>{lineCount} {lineCount === 1 ? 'link' : 'links'} detected</span>
            <button
              type="button"
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
