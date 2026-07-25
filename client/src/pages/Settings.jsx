import React, { useState } from 'react';
import { PasswordInput } from '../components/PasswordInput';
import { apiFetch } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export function Settings() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      addToast('Password updated successfully', 'ok');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      addToast(err.message || 'Failed to update password', 'err');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, marginBottom: 'var(--s6)' }}>Workspace Settings</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 'var(--s5)', maxWidth: 1100 }}>
        <div className="card">
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Account Information</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 'var(--s3)', fontSize: 'var(--fs-base)' }}>
            <span style={{ color: 'var(--text-2)' }}>Username:</span>
            <span style={{ fontFamily: 'var(--font-data)', fontWeight: 600 }}>{user?.username}</span>
            <span style={{ color: 'var(--text-2)' }}>Role:</span>
            <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{user?.role}</span>
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-lg)', fontWeight: 700, marginBottom: 'var(--s4)' }}>Change Password</h3>
          <form onSubmit={handlePasswordChange}>
            <div className="input-group">
              <label className="input-label">Current password</label>
              <PasswordInput value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">New password</label>
              <PasswordInput value={newPassword} onChange={e => setNewPassword(e.target.value)} showStrength={true} autoComplete="new-password" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}