import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { Modal } from '../../components/Modal';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CopyButton } from '../../components/CopyButton';
import { Shimmer } from '../../components/Shimmer';
import { useToast } from '../../context/ToastContext';

export function Clients() {
  const { addToast } = useToast();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newModal, setNewModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [tempPasswordResult, setTempPasswordResult] = useState(null);
  const [creditModal, setCreditModal] = useState(null); // the client being adjusted
  const [creditMode, setCreditMode] = useState('add'); // 'add' | 'set'
  const [creditAmount, setCreditAmount] = useState('');

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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s6)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Client Management</h1>
        <button className="btn btn-primary" onClick={() => setNewModal(true)}>+ New Client</button>
      </div>

      {loading ? (
        <Shimmer height="300px" />
      ) : (
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th className="numeric">Credits</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Created</th>
              <th>Last Login</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(c => (
              <tr key={c._id}>
                <td style={{ fontWeight: 600, fontFamily: 'var(--font-data)' }}>{c.username}</td>
                <td><span className="chip" style={{ textTransform: 'uppercase' }}>{c.role}</span></td>
                <td className="numeric mono" style={{ fontWeight: 700 }}>{c.plan === 'unlimited' ? '∞' : (c.credits ?? 0).toLocaleString()}</td>
                <td><span className="chip accent" style={{ textTransform: 'capitalize' }}>{c.plan || 'free'}</span></td>
                <td>
                  <span className={`chip ${c.disabled ? 'err' : 'ok'}`}>
                    {c.disabled ? 'Disabled' : 'Active'}
                  </span>
                </td>
                <td className="mono" style={{ color: 'var(--text-3)' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="mono" style={{ color: 'var(--text-3)' }}>{c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleString() : 'Never'}</td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" style={{ height: '28px', fontSize: 'var(--fs-xs)' }} onClick={() => openCreditModal(c)}>Credits</button>
                    <button className="btn btn-secondary" style={{ height: '28px', fontSize: 'var(--fs-xs)' }} onClick={() => handleResetPassword(c.username)}>Reset Pwd</button>
                    <button className="btn btn-secondary" style={{ height: '28px', fontSize: 'var(--fs-xs)' }} onClick={() => handleRevokeSessions(c.username)}>Revoke</button>
                    <button
                      className="btn btn-secondary"
                      style={{ height: '28px', fontSize: 'var(--fs-xs)' }}
                      onClick={() => handleResetTour(c.username)}
                      disabled={c.hasSeenTour === false}
                      title={c.hasSeenTour === false ? 'Already queued for their next login' : "Show the welcome tour again on this client's next login"}
                    >
                      {c.hasSeenTour === false ? 'Tour queued' : 'Replay tour'}
                    </button>
                    <a
                      className="btn btn-secondary"
                      style={{ height: '28px', fontSize: 'var(--fs-xs)', lineHeight: '28px', padding: '0 10px' }}
                      href={`/api/admin/clients/${c.username}/export.xlsx`}
                      title="Download this client's submitted links and metrics as Excel"
                    >
                      Download ↓ .xlsx
                    </a>
                    <a
                      className="btn btn-secondary"
                      style={{ height: '28px', fontSize: 'var(--fs-xs)', lineHeight: '28px', padding: '0 10px' }}
                      href={`/api/admin/clients/${c.username}/export.csv`}
                      title="Download this client's submitted links and metrics as CSV"
                    >
                      .csv
                    </a>
                    <button
                      className={`btn ${c.disabled ? 'btn-secondary' : 'btn-destructive'}`}
                      style={{ height: '28px', fontSize: 'var(--fs-xs)' }}
                      onClick={() => handleToggleDisable(c.username, c.disabled)}
                    >
                      {c.disabled ? 'Enable' : 'Disable'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}

      {/* Adjust Credits Modal */}
      <Modal isOpen={!!creditModal} onClose={() => setCreditModal(null)} title="Adjust credits">
        <p style={{ color: 'var(--text-2)', marginBottom: 'var(--s4)' }}>
          <strong>{creditModal?.username}</strong> currently has{' '}
          <span className="mono" style={{ fontWeight: 700 }}>
            {creditModal?.plan === 'unlimited' ? '∞' : (creditModal?.credits ?? 0).toLocaleString()}
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
