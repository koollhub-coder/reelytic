import React, { useRef, useState } from 'react';
import { Modal } from './Modal';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { UploadIcon } from './Icon';

/*
  Fix a report's sheet after it was uploaded: swap in a corrected file, or add
  more links, and carry on from where the report was. Two steps on purpose.
  "Check changes" asks the server what WOULD happen (a dry run, nothing
  written) and shows it in plain words; only "Apply changes" does it. That
  matters because replacing a sheet can remove links that already have
  results, and nobody should find that out afterwards.

  The rules live server-side (sheetEdit.service.js). In short: links that
  already finished keep their results and are never charged again, links that
  failed before get another try, and new links are queued to run. The report
  is left paused. Nothing runs, and nothing is charged, until Resume is
  pressed.
*/

const MODES = [
  { value: 'replace', title: 'Replace with a new file', body: 'Use this if you uploaded the wrong sheet or want to fix it. Links that are not in the new file are removed.' },
  { value: 'add', title: 'Add more links', body: 'Keep everything as it is and add the links from this file.' },
];

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function Line({ children }) {
  return (
    <li style={{ display: 'flex', gap: 'var(--s2)', fontSize: 'var(--fs-sm)', color: 'var(--text)', lineHeight: 1.5 }}>
      <span aria-hidden="true" style={{ color: 'var(--accent)', fontWeight: 700 }}>•</span>
      <span>{children}</span>
    </li>
  );
}

export function EditSheetDialog({ isOpen, onClose, jobId, started, onApplied }) {
  const { user } = useAuth();
  const [mode, setMode] = useState('replace');
  const [file, setFile] = useState(null);
  const [links, setLinks] = useState('');
  const [pasting, setPasting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState(null);
  const fileRef = useRef(null);

  const reset = () => {
    setMode('replace'); setFile(null); setLinks(''); setPasting(false);
    setBusy(false); setError(''); setReview(null);
  };
  const close = () => { reset(); onClose(); };

  const haveInput = !!file || links.trim().length > 0;

  const send = async (dryRun) => {
    const body = new FormData();
    if (file) body.append('file', file); else body.append('links', links);
    body.append('mode', mode);
    body.append('dryRun', dryRun ? '1' : '0');
    // Pausing hands over a moment before the engine has finished the batch it
    // was in. The server says so with JOB_BUSY, and a couple of seconds later
    // it is ready, so wait and try again rather than making anyone click.
    for (let attempt = 0; ; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await apiFetch(`/jobs/${jobId}/sheet`, { method: 'POST', body });
      } catch (err) {
        if (err.code === 'JOB_BUSY' && attempt < 6) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          throw err;
        }
      }
    }
  };

  const check = async () => {
    setBusy(true); setError('');
    try {
      const res = await send(true);
      setReview(res.summary);
    } catch (err) {
      setError(err.message || "We couldn't read that. Check the file and try again.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true); setError('');
    try {
      const res = await send(false);
      reset();
      onApplied(res);
    } catch (err) {
      setError(err.message || "Couldn't update the sheet, try again.");
      setBusy(false);
    }
  };

  const skipped = review ? review.duplicates + review.alreadyInReport : 0;
  const balance = user?.credits ?? 0;
  const short = review && balance != null && review.creditsNeeded > balance;

  return (
    <Modal isOpen={isOpen} onClose={close} title="Edit your sheet" width="540px">
      {!review ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6, margin: 0 }}>
            {started
              ? 'Links that already have results keep them and are never charged again. Only new links run, and nothing runs until you press Resume.'
              : 'This report has not started, so nothing has been charged. Swap in a corrected file or add more links.'}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }} role="radiogroup" aria-label="What to do with the new file">
            {MODES.map((m) => (
              <label
                key={m.value}
                style={{
                  display: 'flex', gap: 'var(--s3)', alignItems: 'flex-start', cursor: 'pointer',
                  padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r-md)',
                  border: `1px solid ${mode === m.value ? 'var(--accent)' : 'var(--border)'}`,
                  background: mode === m.value ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                <input type="radio" name="edit-mode" checked={mode === m.value} onChange={() => setMode(m.value)} style={{ marginTop: '3px' }} />
                <span>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{m.title}</span>
                  <span style={{ display: 'block', color: 'var(--text-2)', fontSize: 'var(--fs-xs)', lineHeight: 1.5 }}>{m.body}</span>
                </span>
              </label>
            ))}
          </div>

          {!pasting ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv,.txt"
                style={{ display: 'none' }}
                onChange={(e) => { setFile(e.target.files[0] || null); setError(''); }}
              />
              <button type="button" className="btn btn-secondary" onClick={() => fileRef.current && fileRef.current.click()} style={{ gap: 'var(--s2)' }}>
                <UploadIcon size={15} />{file ? 'Choose a different file' : 'Choose file'}
              </button>
              <span style={{ fontSize: 'var(--fs-sm)', color: file ? 'var(--text)' : 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '220px' }}>
                {file ? file.name : 'Excel, CSV or TXT'}
              </span>
              <button type="button" className="rl-text-link" style={{ marginLeft: 'auto', fontSize: 'var(--fs-sm)' }} onClick={() => { setPasting(true); setFile(null); }}>
                Paste links instead
              </button>
            </div>
          ) : (
            <div>
              <textarea
                className="input-field"
                style={{ width: '100%', minHeight: '120px', resize: 'vertical' }}
                placeholder="Paste one Instagram link per line"
                value={links}
                onChange={(e) => { setLinks(e.target.value); setError(''); }}
              />
              <button type="button" className="rl-text-link" style={{ fontSize: 'var(--fs-sm)', marginTop: '4px' }} onClick={() => { setPasting(false); setLinks(''); }}>
                Upload a file instead
              </button>
            </div>
          )}

          {error && <div role="alert" style={{ color: 'var(--err)', fontSize: 'var(--fs-sm)' }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={check} disabled={busy || !haveInput}>
              {busy ? 'Checking...' : 'Check changes'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>Here is what will change</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
            {review.kept > 0 && <Line><strong>{plural(review.kept, 'link keeps', 'links keep')}</strong> its results. No charge for these again.</Line>}
            {review.added > 0 && <Line><strong>{plural(review.added, 'new link', 'new links')}</strong> will run.</Line>}
            {review.retry > 0 && <Line><strong>{plural(review.retry, 'link', 'links')}</strong> that did not go through last time will be tried again.</Line>}
            {review.removed > 0 && (
              <Line>
                <strong>{plural(review.removed, 'link', 'links')}</strong> from the old sheet {review.removed === 1 ? 'is' : 'are'} not in the new one and will be removed
                {review.removedWithResults > 0 ? `, ${review.removedWithResults === review.removed ? 'and all of them' : `${review.removedWithResults} of them`} already had results. Credits already spent are not refunded` : ''}.
              </Line>
            )}
            {skipped > 0 && <Line>{plural(skipped, 'repeated link', 'repeated links')} will be skipped.</Line>}
            {review.invalid > 0 && <Line>{plural(review.invalid, 'entry is', 'entries are')} not a valid Instagram link and will be skipped.</Line>}
            {review.kept + review.added + review.retry + review.removed + skipped + review.invalid === 0 && <Line>Nothing would change.</Line>}
          </ul>

          <div style={{ padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', fontSize: 'var(--fs-sm)', lineHeight: 1.6 }}>
            {review.toRun > 0 ? (
              <>
                {plural(review.toRun, 'link is', 'links are')} still to run, about <strong>{review.creditsNeeded.toLocaleString()} credits</strong>.
                {balance != null && <> You have {balance.toLocaleString()}.</>}
                {short && <div style={{ color: 'var(--err)', marginTop: '4px' }}>That is more than you have right now. You can still save the changes, but you will need to top up before you can resume.</div>}
              </>
            ) : (
              <>Nothing is left to run, so this will not use any credits.</>
            )}
          </div>

          {error && <div role="alert" style={{ color: 'var(--err)', fontSize: 'var(--fs-sm)' }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s2)' }}>
            <button type="button" className="btn btn-secondary" onClick={() => { setReview(null); setError(''); }} disabled={busy}>Back</button>
            <button type="button" className="btn btn-primary" onClick={apply} disabled={busy}>
              {busy ? 'Saving...' : 'Apply changes'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
