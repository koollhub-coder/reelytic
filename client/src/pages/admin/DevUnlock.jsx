import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PasswordInput } from '../../components/PasswordInput';
import { apiFetch } from '../../api/client';
import { useToast } from '../../context/ToastContext';

export function DevUnlock() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    try {
      await apiFetch('/auth/dev-unlock', {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      addToast('Developer mode unlocked', 'ok');
      navigate('/admin/dashboard');
    } catch (err) {
      setError(true);
      addToast("That's not it.", 'err');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg)', padding: 'var(--s5)' }}>
      <div className={`card ${error ? 'shake' : ''}`} style={{ width: '100%', maxWidth: '400px', padding: 'var(--s7)', textAlign: 'center' }}>
        <div style={{ fontSize: '36px', marginBottom: 'var(--s3)' }}>🔐</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>Developer Unlock</h2>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)', marginBottom: 'var(--s5)' }}>Enter administrator developer password to access control surfaces.</p>
        
        <form onSubmit={handleSubmit}>
          <div className="input-group" style={{ textAlign: 'left' }}>
            <PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="Developer password" />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '40px' }} disabled={loading}>
            {loading ? 'Verifying...' : 'Unlock Admin Mode'}
          </button>
        </form>
      </div>
    </div>
  );
}
