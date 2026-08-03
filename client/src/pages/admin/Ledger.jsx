import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { CopyButton } from '../../components/CopyButton';
import { Shimmer } from '../../components/Shimmer';
import { Select } from '../../components/Select';

const PAGE_SIZE = 50;

export function Ledger() {
  const [ledger, setLedger] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
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

  const fetchLedger = (targetPage = page) => {
    setLoading(true);
    let query = `?user=${userFilter}&type=${typeFilter}&page=${targetPage}&limit=${PAGE_SIZE}`;
    apiFetch(`/admin/ledger${query}`)
      .then(res => {
        setLedger(res.ledger || []);
        setTotal(res.total || 0);
        setPage(res.page || targetPage);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLedger(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userFilter, typeFilter]);

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s6)' }}>Audited Ledger</h1>

      <div className="card" style={{ display: 'flex', gap: 'var(--s4)', marginBottom: 'var(--s5)', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <label className="input-label">Filter by Type</label>
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            options={[{ value: '', label: 'All types' }, { value: 'reel', label: 'Reel' }, { value: 'profile', label: 'Profile' }]}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="input-label">Filter by Username</label>
          <Select
            value={userFilter}
            onChange={setUserFilter}
            options={[{ value: '', label: 'All users' }, ...usernames.map(u => ({ value: u, label: u }))]}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {loading ? (
        <Shimmer height="300px" />
      ) : (
        <>
          <div className="data-table-container" style={{ marginBottom: 'var(--s4)' }}>
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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
              Showing {ledger.length} of {total.toLocaleString()} entries
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" disabled={page <= 1} onClick={() => fetchLedger(page - 1)}>Previous</button>
              <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-data)' }}>
                Page {page} of {totalPages}
              </span>
              <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => fetchLedger(page + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
