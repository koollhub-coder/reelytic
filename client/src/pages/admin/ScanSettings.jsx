import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { BrandLoader } from '../../components/BrandLoader';
import { useToast } from '../../context/ToastContext';

// Fallback so a failed/incomplete API response never crashes the page (see
// the `error` state below for the actual failure UI) -- info[m].label on a
// null info used to throw and blank the whole screen.
const FALLBACK_PROFILE_INFO = {
  legacy: { mode: 'legacy', label: 'Standard', steps: [], approxCostInr: '-' },
  v2: { mode: 'v2', label: 'Express', steps: [], approxCostInr: '-' },
};
const FALLBACK_REEL_INFO = {
  standard: { mode: 'standard', label: 'Standard', steps: [], approxCostInr: '-' },
  express: { mode: 'express', label: 'Express', steps: [], approxCostInr: '-' },
};

const cardStyle = (active) => ({
  background: 'var(--surface)',
  border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
  borderRadius: 'var(--r-lg)',
  padding: 'var(--s5)',
  flex: 1,
  minWidth: '280px',
});

function PipelineHistoryTable({ log, infoSafe }) {
  if (log.length === 0) {
    return <p style={{ color: 'var(--text-3)', fontSize: 'var(--fs-sm)' }}>No changes yet, still on the default.</p>;
  }
  return (
    <div className="data-table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th>When</th>
            <th>By</th>
            <th>From</th>
            <th>To</th>
          </tr>
        </thead>
        <tbody>
          {log.map((entry, i) => (
            <tr key={i}>
              <td className="mono" style={{ color: 'var(--text-3)' }}>{new Date(entry.at).toLocaleString()}</td>
              <td style={{ fontWeight: 600 }}>{entry.by}</td>
              <td>{infoSafe[entry.from]?.label || entry.from}</td>
              <td>{infoSafe[entry.to]?.label || entry.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScanSettings() {
  const { addToast } = useToast();

  // ---- Profile Report pipeline ----
  const [mode, setMode] = useState(null);
  const [info, setInfo] = useState(null);
  const [log, setLog] = useState([]);
  const [pendingMode, setPendingMode] = useState(null);
  const [switching, setSwitching] = useState(false);

  const [tuning, setTuning] = useState(null); // { fetchDepth, cacheTtlDays }
  const [fetchDepthInput, setFetchDepthInput] = useState('');
  const [cacheTtlInput, setCacheTtlInput] = useState('');
  const [savingTuning, setSavingTuning] = useState(false);

  // ---- Reel Report pipeline ----
  const [reelMode, setReelMode] = useState(null);
  const [reelInfo, setReelInfo] = useState(null);
  const [reelLog, setReelLog] = useState([]);
  const [reelPendingMode, setReelPendingMode] = useState(null);
  const [reelSwitching, setReelSwitching] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([
      apiFetch('/admin/settings/profile-pipeline'),
      apiFetch('/admin/settings/profile-pipeline/log'),
      apiFetch('/admin/settings/profile-v2-tuning'),
      apiFetch('/admin/settings/reel-pipeline'),
      apiFetch('/admin/settings/reel-pipeline/log'),
    ])
      .then(([settings, logRes, tuningRes, reelSettings, reelLogRes]) => {
        setMode(settings.mode);
        setInfo(settings.info);
        setLog(logRes.log || []);
        setTuning(tuningRes);
        setFetchDepthInput(String(tuningRes.fetchDepth));
        setCacheTtlInput(String(tuningRes.cacheTtlDays));
        setReelMode(reelSettings.mode);
        setReelInfo(reelSettings.info);
        setReelLog(reelLogRes.log || []);
        setError('');
      })
      .catch((err) => setError(err.message || "Couldn't load scan settings"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const saveTuning = async () => {
    const fetchDepth = Number(fetchDepthInput);
    const cacheTtlDays = Number(cacheTtlInput);
    if (!Number.isFinite(fetchDepth) || fetchDepth < 4 || fetchDepth > 20) {
      addToast('Reels per profile must be between 4 and 20', 'err');
      return;
    }
    if (!Number.isFinite(cacheTtlDays) || cacheTtlDays <= 0) {
      addToast('Cache window must be a positive number of days', 'err');
      return;
    }
    setSavingTuning(true);
    try {
      const res = await apiFetch('/admin/settings/profile-v2-tuning', {
        method: 'PATCH',
        body: JSON.stringify({ fetchDepth, cacheTtlDays }),
      });
      setTuning({ fetchDepth: res.fetchDepth, cacheTtlDays: res.cacheTtlDays });
      addToast('Express tuning saved. Applies to the next report.', 'ok');
    } catch (err) {
      addToast(err.message || "Couldn't save, try again", 'err');
    } finally {
      setSavingTuning(false);
    }
  };

  const confirmSwitch = async () => {
    setSwitching(true);
    try {
      await apiFetch('/admin/settings/profile-pipeline', {
        method: 'PATCH',
        body: JSON.stringify({ mode: pendingMode })
      });
      addToast(`Profile scan method switched to ${(info || {})[pendingMode]?.label || pendingMode}`, 'ok');
      setPendingMode(null);
      load();
    } catch (err) {
      addToast(err.message || "Couldn't switch scan method, try again", 'err');
    } finally {
      setSwitching(false);
    }
  };

  const confirmReelSwitch = async () => {
    setReelSwitching(true);
    try {
      await apiFetch('/admin/settings/reel-pipeline', {
        method: 'PATCH',
        body: JSON.stringify({ mode: reelPendingMode })
      });
      addToast(`Reel scan method switched to ${(reelInfo || {})[reelPendingMode]?.label || reelPendingMode}`, 'ok');
      setReelPendingMode(null);
      load();
    } catch (err) {
      addToast(err.message || "Couldn't switch scan method, try again", 'err');
    } finally {
      setReelSwitching(false);
    }
  };

  if (loading) return <BrandLoader message="Loading scan settings..." />;

  if (error || !info || !reelInfo) {
    return (
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Scan Settings</h1>
        <div className="card" style={{ color: 'var(--err)' }}>
          {error || "Couldn't load scan settings."}
          <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: 'var(--s2)', fontWeight: 400 }}>
            If this just started happening after an update, the server process may need a restart to pick up new routes. Node doesn't hot-reload server code.
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 'var(--s3)' }} onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  const infoSafe = info;
  const reelInfoSafe = reelInfo;

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>Scan Settings</h1>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s6)' }}>
        This controls the method used to scan Profile and Reel reports. <strong>Standard</strong> is the original, most-tested method for
        each report type; <strong>Express</strong> is a cheaper alternative that returns the same data. Switching is instant and global: it
        applies to every client's <em>next</em> report of that type, with no per-client override and no partial rollout, so you can trial
        Express and roll straight back to Standard if anything looks off. See <a href="/admin/usage" style={{ color: 'var(--accent)' }}>Usage & Spend</a> for
        real cost per client under whichever method is active.
      </p>

      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Profile reports</h2>
      <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', marginBottom: 'var(--s5)' }}>
        {['legacy', 'v2'].map((m) => {
          const entry = infoSafe[m] || FALLBACK_PROFILE_INFO[m];
          return (
            <div key={m} style={cardStyle(mode === m)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s3)' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{entry.label}</h3>
                {mode === m && <span className="chip ok">Active now</span>}
              </div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
                {entry.approxCostInr}
              </div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--s2)' }}>
                What it does
              </div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
                {(entry.steps || []).map((s, i) => <div key={i} style={{ marginBottom: 2 }}>{i + 1}. {s}</div>)}
              </div>
              {mode !== m && (
                <button className="btn btn-primary" onClick={() => setPendingMode(m)}>
                  Switch to this
                </button>
              )}
            </div>
          );
        })}
      </div>

      {mode === 'v2' && tuning && (
        <div className="card" style={{ marginBottom: 'var(--s6)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>Express tuning</h3>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
            Only applies while Express is the active method. Changes take effect on the next report, no restart needed.
          </p>
          <div className="rl-stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)', marginBottom: 'var(--s4)' }}>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Reels fetched per profile
              </label>
              <input
                type="number"
                min={4}
                max={20}
                className="input-field"
                style={{ width: '100%', fontFamily: 'var(--font-data)', fontWeight: 700 }}
                value={fetchDepthInput}
                onChange={(e) => setFetchDepthInput(e.target.value)}
              />
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 6 }}>
                Lower = cheaper per report, but the reported average gets noisier. 8 is the current recommendation.
              </div>
            </div>
            <div>
              <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Reuse a profile's scrape for (days)
              </label>
              <input
                type="number"
                min={1}
                className="input-field"
                style={{ width: '100%', fontFamily: 'var(--font-data)', fontWeight: 700 }}
                value={cacheTtlInput}
                onChange={(e) => setCacheTtlInput(e.target.value)}
              />
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 6 }}>
                A repeat report on the same profile within this window skips re-scraping entirely, at no cost. Longer windows save more but risk showing slightly stale numbers.
              </div>
            </div>
          </div>
          <button className="btn btn-primary" onClick={saveTuning} disabled={savingTuning}>
            {savingTuning ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 'var(--s6)' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Profile change history</h3>
        <PipelineHistoryTable log={log} infoSafe={infoSafe} />
      </div>

      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Reel reports</h2>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s4)' }}>
        Express uses the exact same reel-metrics data as Standard (views, likes, comments, shares, reposts, saves) --
        the only difference is how follower counts are looked up: a cheaper path is tried first, and any creator it
        can't handle automatically falls back to Standard's method, so Express is never less reliable, only
        potentially cheaper.
      </p>
      <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', marginBottom: 'var(--s6)' }}>
        {['standard', 'express'].map((m) => {
          const entry = reelInfoSafe[m] || FALLBACK_REEL_INFO[m];
          return (
            <div key={m} style={cardStyle(reelMode === m)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--s3)' }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700 }}>{entry.label}</h3>
                {reelMode === m && <span className="chip ok">Active now</span>}
              </div>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s2)' }}>
                {entry.approxCostInr}
              </div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--s2)' }}>
                What it does
              </div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-3)', marginBottom: 'var(--s4)' }}>
                {(entry.steps || []).map((s, i) => <div key={i} style={{ marginBottom: 2 }}>{i + 1}. {s}</div>)}
              </div>
              {reelMode !== m && (
                <button className="btn btn-primary" onClick={() => setReelPendingMode(m)}>
                  Switch to this
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Reel change history</h3>
        <PipelineHistoryTable log={reelLog} infoSafe={reelInfoSafe} />
      </div>

      <ConfirmDialog
        isOpen={!!pendingMode}
        title="Switch profile scan method?"
        message={pendingMode ? `This immediately changes the scan method and cost for every client's next profile report, with no partial rollout and no per-client override. Switching to: ${infoSafe[pendingMode]?.label}.` : ''}
        confirmText={switching ? 'Switching...' : 'Switch now'}
        isDestructive={false}
        requiredTextMatch="SWITCH"
        onConfirm={confirmSwitch}
        onClose={() => setPendingMode(null)}
      />

      <ConfirmDialog
        isOpen={!!reelPendingMode}
        title="Switch reel scan method?"
        message={reelPendingMode ? `This immediately changes the scan method for every client's next reel report, with no partial rollout and no per-client override. Switching to: ${reelInfoSafe[reelPendingMode]?.label}.` : ''}
        confirmText={reelSwitching ? 'Switching...' : 'Switch now'}
        isDestructive={false}
        requiredTextMatch="SWITCH"
        onConfirm={confirmReelSwitch}
        onClose={() => setReelPendingMode(null)}
      />
    </div>
  );
}
