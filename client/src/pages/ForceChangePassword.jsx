import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PasswordInput } from '../components/PasswordInput';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export function ForceChangePassword() {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const { addToast } = useToast();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords don\'t match.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword })
      });
      await refreshUser();
      addToast('Password updated. Welcome to Reelytic 👋', 'ok');
      navigate('/reels');
    } catch (err) {
      setError(err.message || 'Failed to update password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg)', padding: 'var(--s5)' }}>
      <div className="card" style={{ width: '100%', maxWidth: '420px', padding: 'var(--s7)' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-xl)', fontWeight: 700, marginBottom: 'var(--s2)' }}>Set your password</h2>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--fs-base)', marginBottom: 'var(--s5)' }}>
          You're using a temporary password. Choose your own to continue.
        </p>

        {error && (
          <div className="chip err" style={{ width: '100%', padding: 'var(--s3)', marginBottom: 'var(--s4)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">New password</label>
            <PasswordInput
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoComplete="new-password"
              showStrength={true}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Confirm new password</label>
            <PasswordInput
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%', height: '40px', marginTop: 'var(--s3)' }} disabled={loading}>
            {loading ? 'Updating...' : 'Set password & continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
