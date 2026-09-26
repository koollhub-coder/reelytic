import { DataTable } from '../../components/DataTable';
import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { BrandLoader } from '../../components/BrandLoader';
import { formatDateTime } from '../../utils/date';
import { getEntry } from '../../utils/helpMatcher';

/*
  What people asked the help assistant that it could not answer, and which of
  its answers landed badly. This is the to-do list for the assistant: write
  the missing answer in content/helpKnowledge.js, then dismiss the question
  here so the list stays short.
*/

const RANGE = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

function Stat({ label, value, hint }) {
  return (
    <div className="card" style={{ padding: 'var(--s4) var(--s5)', flex: '1 1 150px' }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-data)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

const titleFor = (id) => {
  const e = getEntry(id);
  return e ? e.q : id;
};

export function HelpInsights() {
  const { addToast } = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    apiFetch(`/help/admin/summary?days=${days}`)
      .then(setData)
      .catch((err) => setError(err.message || 'Could not load.'));
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const dismiss = async (key) => {
    try {
      await apiFetch('/help/admin/dismiss', { method: 'POST', body: JSON.stringify({ key }) });
      setData((d) => (d ? { ...d, questions: d.questions.filter((q) => q.key !== key) } : d));
    } catch (err) {
      addToast(err.message || 'Could not dismiss that.', 'err');
    }
  };

  if (error) return <div style={{ color: 'var(--err)' }}>{error}</div>;
  if (!data) return <BrandLoader variant="page" message="Loading assistant insights..." />;

  const answeredPct = data.asked ? Math.round((data.answered / data.asked) * 100) : null;

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700 }}>Help assistant</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)', marginTop: 4, maxWidth: '62ch' }}>
            Questions the assistant could not answer, and answers people marked unhelpful. Write the missing answer in
            <span className="mono"> content/helpKnowledge.js</span>, then dismiss the question here.
          </p>
        </div>
        <div style={{ display: 'inline-flex', gap: 4, padding: 3, background: 'var(--surface-2)', borderRadius: 'var(--r-md)' }}>
          {RANGE.map((r) => (
            <button key={r.value} type="button" className={`btn ${days === r.value ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '4px 12px', height: 30 }} onClick={() => setDays(r.value)}>{r.label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s6)' }}>
        <Stat label="Questions asked" value={data.asked.toLocaleString()} />
        <Stat label="Answered" value={answeredPct == null ? '-' : `${answeredPct}%`} hint={`${data.answered.toLocaleString()} answered`} />
        <Stat label="Not answered" value={data.unanswered.toLocaleString()} hint="need a new answer" />
        <Stat label="Helpful votes" value={`${data.thumbsUp} / ${data.thumbsDown}`} hint="up / down" />
      </div>

      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>To answer next</h2>
      <div style={{ marginBottom: 'var(--s6)' }}>
        <DataTable
          id="admin-help-questions"
          columns={[
            { key: 'q', label: 'What they typed', type: 'text', accessor: (q) => q.q, render: (q) => <span style={{ fontWeight: 500 }}>{q.q}</span> },
            { key: 'count', label: 'Times', type: 'number', align: 'right', mono: true, accessor: (q) => q.count },
            { key: 'lastAt', label: 'Last asked', type: 'date', mono: true, accessor: (q) => q.lastAt, render: (q) => <span style={{ color: 'var(--text-3)' }}>{formatDateTime(q.lastAt)}</span> },
            { key: 'done', label: '', sortable: false, filterable: false, align: 'right', render: (q) => <button type="button" className="btn btn-secondary" style={{ height: 30, padding: '0 12px' }} onClick={() => dismiss(q.key)}>Done</button> },
          ]}
          rows={data.questions}
          getRowId={(q) => q.key}
          defaultSort={{ key: 'count', dir: 'desc' }}
          emptyTitle="Nothing waiting"
          emptyBody="The assistant answered everything it was asked."
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--s5)' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Most asked</h2>
          <DataTable
            id="admin-help-top"
            columns={[
              { key: 'topic', label: 'Topic', type: 'text', accessor: (r) => titleFor(r.entryId) },
              { key: 'count', label: 'Times', type: 'number', align: 'right', mono: true, accessor: (r) => r.count },
            ]}
            rows={data.topAnswers}
            getRowId={(r) => r.entryId}
            defaultSort={{ key: 'count', dir: 'desc' }}
            emptyTitle="No data yet"
          />
        </div>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s3)' }}>Marked not helpful</h2>
          <DataTable
            id="admin-help-unhelpful"
            columns={[
              { key: 'topic', label: 'Topic', type: 'text', accessor: (r) => titleFor(r.entryId) },
              { key: 'count', label: 'Times', type: 'number', align: 'right', mono: true, accessor: (r) => r.count },
            ]}
            rows={data.notHelpful}
            getRowId={(r) => r.entryId}
            defaultSort={{ key: 'count', dir: 'desc' }}
            emptyTitle="None" emptyBody="Good sign."
          />
        </div>
      </div>
    </div>
  );
}
