import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { Shimmer } from '../components/Shimmer';

export function History() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/jobs')
      .then(data => {
        setJobs(data.jobs || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s6)' }}>Report History</h1>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Shimmer key={i} height="52px" borderRadius="10px" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon="⏱️"
          title="No reports yet"
          description="Your finished and running reports will live here across sessions."
          action={<button className="btn btn-primary" onClick={() => navigate('/reels')}>New reel report</button>}
        />
      ) : (
        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>File Name</th>
                <th className="numeric">Links</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id} style={{ cursor: 'pointer' }} onClick={() => navigate(j.type === 'reel' ? '/reels' : '/profiles')}>
                  <td>
                    <span className={`chip ${j.type === 'reel' ? 'accent' : 'ok'}`} style={{ textTransform: 'uppercase' }}>
                      {j.type}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{j.fileName}</td>
                  <td className="numeric mono">{j.counts?.total || 0}</td>
                  <td>
                    <span className={`chip ${j.status === 'done' ? 'ok' : j.status === 'running' ? 'accent' : 'warn'}`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="mono" style={{ color: 'var(--text-3)' }}>
                    {new Date(j.createdAt).toLocaleDateString()} {new Date(j.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
