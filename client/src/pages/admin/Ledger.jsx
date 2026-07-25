import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { CopyButton } from '../../components/CopyButton';
import { Shimmer } from '../../components/Shimmer';

export function Ledger() {
  const [ledger, setLedger] = useState([]);
  const [usernames, setUsernames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Populate the username dropdown from real clients instead of making the
  // admin remember and type exact usernames.
  useEffect(() => {
    apiFetch('/admin/clients')
      .then(res => setUsernames((res.clients || []).map(c => c.username).sort()))
      .catch(() => { });
  }, []);

  const fetchLedger = () => {
    setLoading(true);
    let query = `?user=${userFilter}&type=${typeFilter}`;
    apiFetch(`/admin/ledger${query}`)
      .then(res => setLedger(res.ledger || []))
      .catch(() => { })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLedger();
  }, [userFilter, typeFilter]);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s6)' }}>Audited Ledger</h1>

      <div className="card" style={{ display: 'flex', gap: 'var(--s4)', marginBottom: 'var(--s5)', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <label className="input-label">Filter by Type</label>
          <select className="input-field" value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ width: '100%' }}>
            <option value="">All Types</option>
            <option value="reel">Reel</option>
            <option value="profile">Profile</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className="input-label">Filter by Username</label>
          <select className="input-field" value={userFilter} onChange={e => setUserFilter(e.target.value)} style={{ width: '100%' }}>
            <option value="">All Users</option>
            {usernames.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <Shimmer height="300px" />
      ) : (
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Type</th>
                <th>URL</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l, i) => (
                <tr key={i}>
                  <td className="mono" style={{ color: 'var(--text-3)' }}>{new Date(l.at).toLocaleString()}</td>
                  <td style={{ fontWeight: 600 }}>{l.username}</td>
                  <td><span className="chip" style={{ textTransform: 'uppercase' }}>{l.type}</span></td>
                  <td className="mono" style={{ maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.url} <CopyButton text={l.url} />
                  </td>
                  <td>
                    <span className={`chip ${l.result === 'success' ? 'ok' : l.result === 'failed' ? 'err' : 'warn'}`}>
                      {l.result}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}