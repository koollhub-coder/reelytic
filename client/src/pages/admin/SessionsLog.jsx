import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { DataTable } from '../../components/DataTable';
import { formatDateTime } from '../../utils/date';

// The newest entries, filtered and paged in the browser with the same table
// every other screen uses. The full history stays in the database.
const LOAD_LIMIT = 1000;

export function SessionsLog() {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiFetch(`/admin/sessions?page=1&limit=${LOAD_LIMIT}`)
      .then((res) => { setSessions(res.sessions || []); setTotal(res.total || 0); })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    { key: 'at', label: 'Timestamp', type: 'date', mono: true, accessor: (s) => s.at, render: (s) => <span style={{ color: 'var(--text-3)' }}>{formatDateTime(s.at)}</span> },
    { key: 'username', label: 'Username', type: 'select', accessor: (s) => s.username, render: (s) => <span style={{ fontWeight: 600 }}>{s.username}</span> },
    { key: 'ip', label: 'IP address', type: 'text', mono: true, accessor: (s) => s.ip || '' },
    { key: 'userAgent', label: 'Device', type: 'text', accessor: (s) => s.userAgent || '', render: (s) => <span className="rl-clip" title={s.userAgent} style={{ color: 'var(--text-2)', maxWidth: 380 }}>{s.userAgent}</span> },
    { key: 'success', label: 'Status', type: 'select', accessor: (s) => (s.success ? 'success' : 'failed'), optionLabel: (v) => (v === 'success' ? 'Success' : 'Failed'), render: (s) => <span className={`chip ${s.success ? 'ok' : 'err'}`}>{s.success ? 'Success' : 'Failed'}</span> },
  ];

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>Sessions &amp; Login Log</h1>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s5)' }}>
        Every sign-in attempt. {total > LOAD_LIMIT ? `Showing the newest ${LOAD_LIMIT.toLocaleString()} of ${total.toLocaleString()}.` : `${total.toLocaleString()} entries.`}
      </p>
      <DataTable
        id="admin-sessions"
        loading={loading}
        columns={columns}
        rows={sessions}
        getRowId={(s) => String(s._id)}
        defaultSort={{ key: 'at', dir: 'desc' }}
        emptyTitle="No sign-ins recorded yet"
        search={search}
        searchText={(s) => `${s.username} ${s.ip || ''} ${s.userAgent || ''}`}
        toolbar={<input type="text" className="input-field" style={{ height: 34, width: 280 }} placeholder="Search user, IP or device" value={search} onChange={(e) => setSearch(e.target.value)} />}
      />
    </div>
  );
}
