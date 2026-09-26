import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../api/client';
import { CopyButton } from '../../components/CopyButton';
import { DataTable } from '../../components/DataTable';
import { formatDateTime } from '../../utils/date';

// The newest entries, filtered and paged in the browser with the same table
// every other screen uses. The full history stays in the database.
const LOAD_LIMIT = 1000;

export function Ledger() {
  const [ledger, setLedger] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    apiFetch(`/admin/ledger?page=1&limit=${LOAD_LIMIT}`)
      .then((res) => { setLedger(res.ledger || []); setTotal(res.total || 0); })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    { key: 'at', label: 'Timestamp', type: 'date', mono: true, accessor: (l) => l.at, render: (l) => <span style={{ color: 'var(--text-3)' }}>{formatDateTime(l.at)}</span> },
    { key: 'username', label: 'User', type: 'select', accessor: (l) => l.username, render: (l) => <span style={{ fontWeight: 600 }}>{l.username}</span> },
    { key: 'type', label: 'Type', type: 'select', accessor: (l) => l.type, optionLabel: (v) => String(v).toUpperCase(), render: (l) => <span className="chip" style={{ textTransform: 'uppercase' }}>{l.type}</span> },
    {
      key: 'url', label: 'URL', type: 'text', mono: true, accessor: (l) => l.url,
      render: (l) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: 360 }}>
          <span className="rl-clip" title={l.url}>{l.url}</span>
          <CopyButton text={l.url} />
        </span>
      ),
    },
    { key: 'result', label: 'Result', type: 'select', accessor: (l) => l.result, render: (l) => <span className={`chip ${l.result === 'success' ? 'ok' : l.result === 'failed' ? 'err' : 'warn'}`}>{l.result}</span> },
  ];

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>Audited Ledger</h1>
      <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginBottom: 'var(--s5)' }}>
        Every link a client has submitted. {total > LOAD_LIMIT ? `Showing the newest ${LOAD_LIMIT.toLocaleString()} of ${total.toLocaleString()}.` : `${total.toLocaleString()} entries.`}
      </p>
      <DataTable
        id="admin-ledger"
        loading={loading}
        columns={columns}
        rows={ledger}
        getRowId={(l) => String(l._id)}
        defaultSort={{ key: 'at', dir: 'desc' }}
        emptyTitle="Nothing in the ledger yet"
        search={search}
        searchText={(l) => `${l.username} ${l.url} ${l.type} ${l.result}`}
        toolbar={<input type="text" className="input-field" style={{ height: 34, width: 280 }} placeholder="Search user or link" value={search} onChange={(e) => setSearch(e.target.value)} />}
      />
    </div>
  );
}
