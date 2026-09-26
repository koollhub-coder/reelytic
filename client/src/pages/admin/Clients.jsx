import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CopyButton } from '../../components/CopyButton';
import { BrandLoader } from '../../components/BrandLoader';
import { Select } from '../../components/Select';
import { useToast } from '../../context/ToastContext';
import { formatDate, formatDateTime, formatDayKey } from '../../utils/date';
import { TableSkeleton } from '../../components/TableSkeleton';
import { Tooltip } from '../../components/Tooltip';
import { DataTable } from '../../components/DataTable';
import { RowMenu } from '../../components/RowMenu';

// override value ->Select value, and back. null/undefined (key never
// touched) reads as "plan", matching hasFeature()'s fallback-to-plan rule.
const OVERRIDE_OPTIONS = [
  { value: 'plan', label: 'Plan default' },
  { value: 'on', label: 'On (override)' },
  { value: 'off', label: 'Off (override)' },
];
const FEATURES = [
  { key: 'reportBranding', label: 'Report branding (custom logo and colors)' },
  { key: 'shareableLinks', label: 'Shareable report links' },
  { key: 'pdfExport', label: 'PDF report download' },
  { key: 'creatorDatabase', label: 'Creator database' },
  { key: 'teamSeats', label: 'Team seats (invite teammates)' },
  { key: 'clientPortal', label: 'Persistent client portal' },
];
const blankDraft = (v) => Object.fromEntries(FEATURES.map((f) => [f.key, v]));
function overrideToSelect(v) { return v === true ? 'on' : v === false ? 'off' : 'plan'; }
function selectToOverride(v) { return v === 'on' ? true : v === 'off' ? false : null; }

export function Clients() {
  const { addToast } = useToast();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clientSearch, setClientSearch] = useState('');
  const [newModal, setNewModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [tempPasswordResult, setTempPasswordResult] = useState(null);
  const [creditModal, setCreditModal] = useState(null); // the client being adjusted
  const [creditMode, setCreditMode] = useState('add'); // 'add' | 'set'
  const [creditAmount, setCreditAmount] = useState('');
  const [featureModal, setFeatureModal] = useState(null); // the client being adjusted
  const [featureDraft, setFeatureDraft] = useState(blankDraft('plan'));
  const [featureSaving, setFeatureSaving] = useState(false);

  const fetchClients = () => {
    apiFetch('/admin/clients')
      .then(res => setClients(res.clients || []))
      .catch(() => { })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const handleCreateClient = async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/admin/clients', {
        method: 'POST',
        body: JSON.stringify({ username: newUsername })
      });
      setTempPasswordResult({ username: res.username, tempPassword: res.tempPassword });
      setNewModal(false);
      setNewUsername('');
      fetchClients();
      addToast('Client created successfully', 'ok');
    } catch (err) {
      addToast(err.message || "Couldn't create that client, try again", 'err');
    }
  };

  const handleToggleDisable = async (username, currentDisabled) => {
    try {
      await apiFetch(`/admin/clients/${username}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled: !currentDisabled })
      });
      fetchClients();
      addToast(`Client ${!currentDisabled ? 'disabled' : 'enabled'}`, 'accent');
    } catch (err) {
      addToast('Action failed', 'err');
    }
  };

  const handleResetPassword = async (username) => {
    try {
      const res = await apiFetch(`/admin/clients/${username}`, {
        method: 'PATCH',
        body: JSON.stringify({ resetPassword: true })
      });
      setTempPasswordResult({ username, tempPassword: res.tempPassword });
      addToast('Password reset successfully', 'ok');
    } catch (err) {
      addToast('Password reset failed', 'err');
    }
  };

  const openCreditModal = (client) => {
    setCreditModal(client);
    setCreditMode('add');
    setCreditAmount('');
  };

  const handleAdjustCredits = async (e) => {
    e.preventDefault();
    const amount = parseInt(creditAmount, 10);
    if (Number.isNaN(amount)) { addToast('Enter a number', 'err'); return; }
    const body = creditMode === 'set' ? { setCredits: amount } : { creditsDelta: amount };
    try {
      const res = await apiFetch(`/admin/clients/${creditModal.username}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      addToast(`Credits updated: ${creditModal.username} now has ${res.credits?.toLocaleString?.() ?? res.credits}`, 'ok');
      setCreditModal(null);
      fetchClients();
    } catch (err) {
      addToast(err.message || "Couldn't update credits, try again", 'err');
    }
  };

  const handleRevokeSessions = async (username) => {
    try {
      await apiFetch(`/admin/clients/${username}`, {
        method: 'PATCH',
        body: JSON.stringify({ revokeSessions: true })
      });
      addToast('All sessions revoked for user', 'ok');
    } catch (err) {
      addToast("Couldn't sign that client out everywhere, try again", 'err');
    }
  };

  // Re-arms the welcome tour for exactly one more login -- e.g. you tested
  // the account yourself before handing off credentials, so the client's own
  // first login should still feel like a first login. It's a one-time flag,
  // not a standing "always show" mode: the moment they finish or skip it,
  // it's marked seen again automatically, same as any brand-new signup.
  const handleResetTour = async (username) => {
    try {
      await apiFetch(`/admin/clients/${username}`, {
        method: 'PATCH',
        body: JSON.stringify({ resetTour: true })
      });
      addToast(`${username} will see the welcome tour on their next login`, 'ok');
      fetchClients();
    } catch (err) {
      addToast("Couldn't reset the tour for that client, try again", 'err');
    }
  };

  const openFeatureModal = (client) => {
    const overrides = client.featureOverrides || {};
    setFeatureModal(client);
    setFeatureDraft(Object.fromEntries(FEATURES.map((f) => [f.key, overrideToSelect(overrides[f.key])])));
  };

  const handleSaveFeatures = async () => {
    setFeatureSaving(true);
    try {
      await apiFetch(`/admin/clients/${featureModal.username}`, {
        method: 'PATCH',
        body: JSON.stringify({
          featureOverrides: Object.fromEntries(FEATURES.map((f) => [f.key, selectToOverride(featureDraft[f.key])])),
        }),
      });
      addToast(`Feature access updated for ${featureModal.username}`, 'ok');
      setFeatureModal(null);
      fetchClients();
    } catch (err) {
      addToast(err.message || "Couldn't update feature access, try again", 'err');
    } finally {
      setFeatureSaving(false);
    }
  };

  const columns = [
    { key: 'username', label: 'Username', type: 'text', accessor: (c) => c.username, render: (c) => (
      <span style={{ fontWeight: 600, fontFamily: 'var(--font-data)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {c.username}
        {c.role === 'admin' && <span className="chip" style={{ textTransform: 'uppercase', fontSize: 10 }}>Admin</span>}
      </span>
    ) },
    { key: 'email', label: 'Email', type: 'text', accessor: (c) => c.email || '', render: (c) => <span className="mono rl-clip" title={c.email || ''} style={{ color: 'var(--text-2)', maxWidth: 150 }}>{c.email || '-'}</span> },
    { key: 'credits', label: 'Credits', type: 'number', align: 'right', mono: true, accessor: (c) => c.credits ?? 0, render: (c) => <strong>{(c.credits ?? 0).toLocaleString()}</strong> },
    { key: 'plan', label: 'Plan', type: 'select', accessor: (c) => c.plan || 'free', render: (c) => <span className="chip accent" style={{ textTransform: 'capitalize' }}>{c.plan || 'free'}</span> },
    { key: 'status', label: 'Status', type: 'select', accessor: (c) => (c.disabled ? 'disabled' : 'active'), optionLabel: (v) => (v === 'disabled' ? 'Disabled' : 'Active'), render: (c) => <span className={`chip ${c.disabled ? 'err' : 'ok'}`}>{c.disabled ? 'Disabled' : 'Active'}</span> },
    { key: 'createdAt', label: 'Created', type: 'date', mono: true, accessor: (c) => c.createdAt, render: (c) => <span style={{ color: 'var(--text-3)' }}>{formatDate(c.createdAt)}</span> },
    { key: 'lastLoginAt', label: 'Last login', type: 'date', mono: true, accessor: (c) => c.lastLoginAt, render: (c) => <span title={c.lastLoginAt ? formatDateTime(c.lastLoginAt) : ''} style={{ color: 'var(--text-3)' }}>{c.lastLoginAt ? formatDate(c.lastLoginAt) : 'Never'}</span> },
    {
      key: 'actions', label: '', sortable: false, filterable: false, align: 'right', sticky: 'right',
      render: (c) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button className="btn btn-secondary" style={{ height: '30px', fontSize: 'var(--fs-xs)' }} onClick={() => openCreditModal(c)}>Credits</button>
          <RowMenu
            label={`Actions for ${c.username}`}
            items={[
              { label: 'Features', onClick: () => openFeatureModal(c) },
              { label: 'Reset password', onClick: () => handleResetPassword(c.username) },
              { label: 'Revoke sessions', onClick: () => handleRevokeSessions(c.username) },
              { label: c.hasSeenTour === false ? 'Tour queued' : 'Replay tour', onClick: c.hasSeenTour === false ? undefined : () => handleResetTour(c.username) },
              { label: 'Download .xlsx', href: `/api/admin/clients/${c.username}/export.xlsx`, divider: true },
              { label: 'Download .csv', href: `/api/admin/clients/${c.username}/export.csv` },
              { label: c.disabled ? 'Enable account' : 'Disable account', onClick: () => handleToggleDisable(c.username, c.disabled), danger: !c.disabled, divider: true },
            ]}
          />
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s6)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Client Management</h1>
        <button className="btn btn-primary" onClick={() => setNewModal(true)}>+ New Client</button>
      </div>

      <DataTable
        id="admin-clients"
        loading={loading}
        columns={columns}
        rows={clients}
        getRowId={(c) => c._id}
        defaultSort={{ key: 'createdAt', dir: 'desc' }}
        emptyTitle="No clients yet"
        searchText={(c) => [c.username, c.email].filter(Boolean).join(' ')}
        search={clientSearch}
        toolbar={(
          <input type="text" className="input-field" style={{ height: 34, width: 260 }} placeholder="Search username or email" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
        )}
      />

      {/* Adjust Credits Modal */}
      <Modal isOpen={!!creditModal} onClose={() => setCreditModal(null)} title="Adjust credits">
        <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s4)' }}>
          <strong>{creditModal?.username}</strong> currently has{' '}
          <span className="mono" style={{ fontWeight: 700 }}>
            {(creditModal?.credits ?? 0).toLocaleString()}
          </span>{' '}credits.
        </p>

        <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s4)' }}>
          <button type="button" className={`chip ${creditMode === 'add' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }} onClick={() => setCreditMode('add')}>Add / remove</button>
          <button type="button" className={`chip ${creditMode === 'set' ? 'accent' : ''}`} style={{ cursor: 'pointer', padding: '6px 12px' }} onClick={() => setCreditMode('set')}>Set exact</button>
        </div>

        <form onSubmit={handleAdjustCredits}>
          <div className="input-group">
            <label className="input-label">
              {creditMode === 'set' ? 'Set balance to' : 'Amount to add (use a negative number to remove)'}
            </label>
            <input
              type="number"
              className="input-field"
              value={creditAmount}
              onChange={e => setCreditAmount(e.target.value)}
              placeholder={creditMode === 'set' ? 'e.g. 5000' : 'e.g. 500 or -100'}
              autoFocus
            />
          </div>

          {creditMode === 'add' && (
            <div style={{ display: 'flex', gap: 'var(--s2)', flexWrap: 'wrap', marginBottom: 'var(--s4)' }}>
              {[100, 500, 1000, 5000].map(v => (
                <button key={v} type="button" className="btn btn-secondary" style={{ height: '30px', fontSize: 'var(--fs-xs)' }} onClick={() => setCreditAmount(String(v))}>+{v.toLocaleString()}</button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: 'var(--s4)' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCreditModal(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Apply</button>
          </div>
        </form>
      </Modal>

      {/* Per-account feature override, independent of plan. "Plan default"
          means this account just gets whatever its plan grants -- see
          features.service.js on the server for how the two combine. */}
      <Modal isOpen={!!featureModal} onClose={() => setFeatureModal(null)} title="Feature access">
        <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s4)' }}>
          Override plan-gated features for <strong>{featureModal?.username}</strong> (currently on the{' '}
          <span style={{ textTransform: 'capitalize' }}>{featureModal?.plan || 'free'}</span> plan).
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--s4)' }}>
          <button type="button" className="btn btn-secondary" style={{ height: 30, fontSize: 'var(--fs-xs)' }} onClick={() => setFeatureDraft(blankDraft('on'))}>Turn everything on</button>
          <button type="button" className="btn btn-ghost" style={{ height: 30, fontSize: 'var(--fs-xs)' }} onClick={() => setFeatureDraft(blankDraft('plan'))}>Reset all to plan default</button>
        </div>
        {FEATURES.map((f) => (
          <div className="input-group" key={f.key}>
            <label className="input-label">{f.label}</label>
            <Select
              value={featureDraft[f.key]}
              onChange={(v) => setFeatureDraft((d) => ({ ...d, [f.key]: v }))}
              options={OVERRIDE_OPTIONS}
            />
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: 'var(--s4)' }}>
          <button type="button" className="btn btn-secondary" onClick={() => setFeatureModal(null)}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={featureSaving} onClick={handleSaveFeatures}>
            {featureSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </Modal>

      {/* New Client Modal */}
      <Modal isOpen={newModal} onClose={() => setNewModal(false)} title="Provision New Client">
        <form onSubmit={handleCreateClient}>
          <div className="input-group">
            <label className="input-label">Username</label>
            <input
              type="text"
              className="input-field"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              placeholder="e.g. zenith_agency"
              required
              autoFocus
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '24px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setNewModal(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Client</button>
          </div>
        </form>
      </Modal>

      {/* Temp Password Modal Result */}
      <Modal isOpen={!!tempPasswordResult} onClose={() => setTempPasswordResult(null)} title="Temp Password Generated">
        <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s3)' }}>
          Temporary password for <strong>{tempPasswordResult?.username}</strong>. Save this now, it will never be shown again:
        </p>
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--surface-2)', marginBottom: 'var(--s5)' }}>
          <span className="mono" style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{tempPasswordResult?.tempPassword}</span>
          <CopyButton text={tempPasswordResult?.tempPassword || ''} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={() => setTempPasswordResult(null)}>Done</button>
        </div>
      </Modal>
    </div>
  );
}
