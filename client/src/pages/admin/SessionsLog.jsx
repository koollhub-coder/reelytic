import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { BrandLoader } from '../../components/BrandLoader';

const PAGE_SIZE = 50;

export function SessionsLog() {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetchSessions = (targetPage = 1) => {
    setLoading(true);
    apiFetch(`/admin/sessions?page=${targetPage}&limit=${PAGE_SIZE}`)
      .then(res => {
        setSessions(res.sessions || []);
        setTotal(res.total || 0);
        setPage(res.page || targetPage);
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSessions(1);
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s6)' }}>Sessions & Login Log</h1>

      {loading ? (
        <BrandLoader message="Loading sessions..." />
      ) : (
        <>
          <div className="data-table-container" style={{ marginBottom: 'var(--s4)' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Username</th>
                  <th>IP Address</th>
                  <th>User Agent / Device</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ color: 'var(--text-3)' }}>{new Date(s.at).toLocaleString()}</td>
                    <td style={{ fontWeight: 600 }}>{s.username}</td>
                    <td className="mono">{s.ip}</td>
                    <td style={{ color: 'var(--text-2)' }}>{s.userAgent}</td>
                    <td>
                      <span className={`chip ${s.success ? 'ok' : 'err'}`}>
                        {s.success ? 'Success' : 'Failed'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
              Showing {sessions.length} of {total.toLocaleString()} entries
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" disabled={page <= 1} onClick={() => fetchSessions(page - 1)}>Previous</button>
              <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-data)' }}>
                Page {page} of {totalPages}
              </span>
              <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => fetchSessions(page + 1)}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
