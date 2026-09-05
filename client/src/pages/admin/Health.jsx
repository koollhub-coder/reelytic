import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../api/client';
import { BrandLoader } from '../../components/BrandLoader';
import { EmptyState } from '../../components/EmptyState';
import { formatDateTime } from '../../utils/date';
import { WarningIcon, SuccessIcon, InfoIcon } from '../../components/Icon';
import { Tooltip } from '../../components/Tooltip';

/*
  Application health.

  The job of this page is to answer one question quickly: is anything broken
  right now that I do not already know about. Everything here serves that and
  nothing else -- no charts, no trends, no vanity metrics.

  Rows are FAULTS, not occurrences. One bug hit nine thousand times is one row
  saying 9,000, because the count is a severity signal and the list stays
  readable during an incident. Ordered by most recent activity rather than by
  volume: a new fault that has happened twice in the last minute matters more
  than a known one that happened a thousand times last week.
*/

const KIND_LABEL = {
  server: 'Server error',
  'client-crash': 'Screen crashed',
  'client-error': 'Script error',
  'client-rejection': 'Unhandled promise',
  'api-failure': 'API call failed',
  'console-error': 'Logged error',
};

// Server faults and white screens are the ones that actually stop someone
// working, so they are the ones allowed to look alarming.
const KIND_TONE = {
  server: 'err',
  'client-crash': 'err',
  'api-failure': 'warn',
  'client-error': 'warn',
  'client-rejection': 'warn',
  'console-error': 'warn',
};

function timeAgo(iso) {
  if (!iso) return '';
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

function ErrorRow({ row, onResolve }) {
  const [open, setOpen] = useState(false);
  const tone = KIND_TONE[row.kind] || 'warn';
  const ctx = row.lastContext || {};

  return (
    <div className="card" style={{ padding: 'var(--s4) var(--s5)', marginBottom: 'var(--s3)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--s4)', flexWrap: 'wrap' }}>
        <span className={`chip ${tone}`} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
          {KIND_LABEL[row.kind] || row.kind}
        </span>

        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', lineHeight: 1.5, wordBreak: 'break-word' }}>
            {row.message}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 4, display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
            {row.route && <span className="mono">{row.route}</span>}
            {row.status ? <span>HTTP {row.status}</span> : null}
            {/* The page the user was on, and the component that threw. These
                are the two things you need before you can reproduce anything,
                so they sit in the summary rather than behind "Show detail". */}
            {ctx.extra && ctx.extra.pagePath && ctx.extra.pagePath !== row.route && (
              <span>on <span className="mono">{ctx.extra.pagePath}</span></span>
            )}
            {ctx.extra && ctx.extra.component && (
              <span>in <strong style={{ color: 'var(--text-2)' }}>{ctx.extra.component}</strong></span>
            )}
            <span>Last seen {timeAgo(row.lastSeenAt)}</span>
            {row.affectedUsers && row.affectedUsers.length > 0 && (
              <span>{row.affectedUsers.length} user{row.affectedUsers.length === 1 ? '' : 's'} affected</span>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="mono" style={{ fontWeight: 700, fontSize: 'var(--fs-md)', color: `var(--${tone})` }}>
            {(row.count || 0).toLocaleString()}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>times</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--s3)', marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ height: 28, fontSize: 'var(--fs-xs)', padding: '0 var(--s3)' }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide detail' : 'Show detail'}
        </button>
        {row.resolvedAt ? (
          <>
            <button type="button" className="btn btn-ghost" style={{ height: 28, fontSize: 'var(--fs-xs)', padding: '0 var(--s3)' }} onClick={() => onResolve(row._id, false)}>
              Reopen
            </button>
            {row.autoResolved && (
              <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-3)' }}>
                Auto-resolved &mdash; no recurrence in a while
              </span>
            )}
          </>
        ) : (
          <button type="button" className="btn btn-secondary" style={{ height: 28, fontSize: 'var(--fs-xs)', padding: '0 var(--s3)' }} onClick={() => onResolve(row._id, true)}>
            Mark fixed
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 'var(--s4)', paddingTop: 'var(--s4)', borderTop: '1px solid var(--border)', fontSize: 'var(--fs-xs)' }}>
          <div style={{ color: 'var(--text-3)', marginBottom: 'var(--s2)' }}>
            First seen {formatDateTime(row.firstSeenAt)} · Group {row._id}
          </div>
          {ctx.stack && (
            <pre style={{
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0 0 var(--s3)',
              padding: 'var(--s3)', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)',
              color: 'var(--text-2)', fontFamily: 'var(--font-mono)', maxHeight: '220px', overflow: 'auto',
            }}>
              {ctx.stack}
            </pre>
          )}
          {ctx.extra && ctx.extra.componentStack && (
            <pre style={{
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0 0 var(--s3)',
              padding: 'var(--s3)', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)',
              color: 'var(--text-2)', fontFamily: 'var(--font-mono)', maxHeight: '180px', overflow: 'auto',
            }}>
              {ctx.extra.componentStack}
            </pre>
          )}
          {row.affectedUsers && row.affectedUsers.length > 0 && (
            <div style={{ color: 'var(--text-2)' }}>
              Affected: <span className="mono">{row.affectedUsers.join(', ')}</span>
            </div>
          )}
          {ctx.extra && (ctx.extra.pagePath || ctx.extra.viewport) && (
            <div style={{ color: 'var(--text-2)', marginTop: 4 }}>
              {ctx.extra.pagePath && <>Page <span className="mono">{ctx.extra.pagePath}</span></>}
              {ctx.extra.viewport && <> · Viewport <span className="mono">{ctx.extra.viewport}</span></>}
            </div>
          )}
          {ctx.userAgent && (
            <div style={{ color: 'var(--text-3)', marginTop: 4, wordBreak: 'break-word' }}>{ctx.userAgent}</div>
          )}
        </div>
      )}
    </div>
  );
}

/*
  Pre-deploy checks, on the machine you are developing on.

  The whole section is driven by whether /devtools/tasks answers. On a
  deployed server that route is not mounted, the probe 404s, and none of
  this renders -- there is no flag to remember to turn off, because the
  absence of the endpoint IS the switch.
*/
function DevChecks() {
  const [tasks, setTasks] = useState(null);
  const [run, setRun] = useState(null);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const logRef = React.useRef(null);
  const seenRef = React.useRef(0);

  useEffect(() => {
    apiFetch('/devtools/tasks')
      .then(setTasks)
      // A 404 here is the normal, expected answer on any deployed server.
      .catch(() => setTasks(null));
  }, []);

  // Poll while something is running, asking only for output it has not
  // already been given.
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(async () => {
      try {
        const res = await apiFetch(`/devtools/run?since=${seenRef.current}`);
        if (res.run) {
          if (res.run.chunk) {
            seenRef.current = res.run.length;
            setOutput((prev) => prev + res.run.chunk);
          }
          setRun(res.run);
          if (res.run.status === 'done') setBusy(false);
        }
      } catch (e) {
        setErr(e.message || 'Lost contact with the check.');
        setBusy(false);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [busy]);

  // Follow the tail, the way a terminal does.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [output]);

  const start = async (task) => {
    if (task.spends && !window.confirm(
      'This runs one real reel and one real profile through Apify, which costs about a rupee. Continue?'
    )) return;
    setErr('');
    setOutput('');
    seenRef.current = 0;
    try {
      const res = await apiFetch(`/devtools/run/${task.id}`, { method: 'POST' });
      setRun({ ...res, status: 'running' });
      setBusy(true);
    } catch (e) {
      setErr(e.message || 'Could not start that check.');
    }
  };

  const stop = async () => {
    try { await apiFetch('/devtools/stop', { method: 'POST' }); } catch (e) { /* already gone */ }
    setBusy(false);
  };

  if (!tasks || !tasks.available) return null;

  // A deliberate Stop leaves exitCode null, same shape as a real failure
  // would if the process never got the chance to exit -- without this check
  // stopping a check on purpose would render the same red "something failed"
  // banner as an actual broken build.
  const stopped = run && run.status === 'done' && run.exitCode === null;
  const passed = run && run.status === 'done' && run.exitCode === 0;
  const failed = run && run.status === 'done' && run.exitCode !== 0 && run.exitCode !== null;

  return (
    <div className="card" style={{ padding: 'var(--s5)', marginBottom: 'var(--s5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', marginBottom: 'var(--s2)', flexWrap: 'wrap' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>
          Pre-deploy checks
        </h2>
        <span className="chip" style={{ flexShrink: 0 }}>Local machine only</span>
      </div>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)', maxWidth: '72ch', lineHeight: 1.6 }}>
        Run these before you deploy. They use a throwaway test database and stubbed scrapers, so nothing here can touch
        real client data. This section does not exist on the deployed site.
      </p>

      {err && <div style={{ color: 'var(--err)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s3)' }}>{err}</div>}

      <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
        {tasks.tasks.map((t) => (
          <Tooltip key={t.id} content={t.description}>
            <button
              type="button"
              className={t.spends ? 'btn btn-ghost' : 'btn btn-secondary'}
              style={{ flexDirection: 'column', alignItems: 'flex-start', height: 'auto', padding: 'var(--s3) var(--s4)', textAlign: 'left', maxWidth: '260px' }}
              disabled={busy}
              onClick={() => start(t)}
            >
              <span style={{ fontWeight: 600 }}>{t.label}</span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', fontWeight: 400 }}>
                about {t.minutes} min{t.spends ? ' · spends ~₹1' : ' · free'}
              </span>
            </button>
          </Tooltip>
        ))}
        {busy && (
          <button type="button" className="btn btn-ghost" onClick={stop} style={{ alignSelf: 'flex-start' }}>
            Stop
          </button>
        )}
      </div>

      {run && (
        <div style={{
          padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r-md)', marginBottom: 'var(--s3)',
          fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px',
          background: (busy || stopped) ? 'var(--surface-2)' : `color-mix(in srgb, var(--${passed ? 'ok' : 'err'}) 12%, transparent)`,
          color: (busy || stopped) ? 'var(--text-2)' : `var(--${passed ? 'ok' : 'err'})`,
        }}>
          {(busy || stopped) ? null : (passed ? <SuccessIcon size={16} /> : <WarningIcon size={16} />)}
          <span>
            {busy && `Running ${run.label}...`}
            {stopped && `${run.label}: stopped before it finished. This tells you nothing either way.`}
            {passed && `${run.label}: everything passed. Safe to deploy.`}
            {failed && `${run.label}: something failed. The detail is below, do not deploy until it is green.`}
          </span>
        </div>
      )}

      {output && (
        <pre
          ref={logRef}
          className="mono"
          style={{
            background: 'var(--surface-2)', borderRadius: 'var(--r-md)', padding: 'var(--s4)',
            fontSize: 'var(--fs-xs)', lineHeight: 1.6, maxHeight: '420px', overflow: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
          }}
        >
          {output}
        </pre>
      )}
    </div>
  );
}

export function Health() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/admin/health/errors?includeResolved=${showResolved}`);
      setData(res);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load health data.');
    }
  }, [showResolved]);

  useEffect(() => { load(); }, [load]);

  // Refreshed on a timer because this is the page you leave open during a
  // deploy to watch whether anything starts failing.
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const resolve = async (id, resolved) => {
    try {
      await apiFetch(`/admin/health/errors/${id}`, { method: 'PATCH', body: JSON.stringify({ resolved }) });
      load();
    } catch (err) {
      setError(err.message || 'Could not update that.');
    }
  };

  if (!data && !error) return <BrandLoader variant="page" message="Checking application health..." />;

  const rows = (data && data.errors) || [];
  const unresolved = (data && data.unresolved) || 0;

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
        Application health
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s5)', maxWidth: '68ch', lineHeight: 1.6 }}>
        Errors your clients hit, grouped so one fault is one row however many times it happened. Server faults and
        crashed screens are the ones worth acting on first. Refreshes itself every 30 seconds.
      </p>

      {error && (
        <div className="card" style={{ padding: 'var(--s4)', marginBottom: 'var(--s4)', color: 'var(--err)' }}>{error}</div>
      )}

      <DevChecks />

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)', marginBottom: 'var(--s5)', flexWrap: 'wrap' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 'var(--s3)',
          padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r-md)',
          background: unresolved > 0 ? 'color-mix(in srgb, var(--err) 12%, transparent)' : 'color-mix(in srgb, var(--ok) 12%, transparent)',
          border: `1px solid color-mix(in srgb, var(--${unresolved > 0 ? 'err' : 'ok'}) 28%, transparent)`,
          color: `var(--${unresolved > 0 ? 'err' : 'ok'})`,
        }}>
          {unresolved > 0 ? <WarningIcon size={16} /> : <SuccessIcon size={16} />}
          <span style={{ fontWeight: 700, fontSize: 'var(--fs-sm)' }}>
            {unresolved > 0 ? `${unresolved} open issue${unresolved === 1 ? '' : 's'}` : 'No open issues'}
          </span>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: 'var(--fs-sm)', color: 'var(--text-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Include ones I have marked fixed
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={showResolved ? 'Nothing recorded yet' : 'Nothing is broken'}
          description="No errors have been reported. This page fills in automatically when a client hits a server fault, a failed API call, or a screen that crashes."
        />
      ) : (
        rows.map((row) => <ErrorRow key={row._id} row={row} onResolve={resolve} />)
      )}

      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 'var(--s5)', display: 'flex', gap: '6px', alignItems: 'flex-start', maxWidth: '68ch', lineHeight: 1.6 }}>
        <InfoIcon size={13} style={{ marginTop: 2 }} />
        <span>
          Passwords, tokens and session ids are stripped before anything is written, and email addresses are reduced to
          their domain. An open issue that goes quiet for a week resolves itself, so you do not have to clear things by
          hand -- and whether you mark it fixed or it resolves on its own, it reopens automatically the moment it
          actually happens again.
        </span>
      </p>
    </div>
  );
}
