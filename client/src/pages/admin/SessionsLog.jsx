import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { Shimmer } from '../../components/Shimmer';

export function SessionsLog() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/admin/sessions')
      .then(res => setSessions(res.sessions || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s6)' }}>Sessions & Login Log</h1>

      {loading ? (
        <Shimmer height="300px" />
      ) : (
        <div className="data-table-container">
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
      )}
    </div>
  );
}
