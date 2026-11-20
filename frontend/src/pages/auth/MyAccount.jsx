import { useState } from 'react';
import { KeyRound, UserCheck, LogOut, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS } from '../../routes/navItems';
import StatusBadge from '../../components/StatusBadge';

function PasswordInput({ id, value, onChange, autoComplete, placeholder }) {
  const [visible, setVisible] = useState(false);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        style={{ width: '100%', paddingLeft: 12, paddingRight: 40 }}
        required
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'transparent',
          border: 'none',
          padding: 4,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: 'var(--muted, #6b7280)',
        }}
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}

function PasswordForm({ onSuccess }) {
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [nextPass, setNextPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (nextPass.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (nextPass !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    setError('');
    const res = await changePassword(current, nextPass);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setCurrent('');
    setNextPass('');
    setConfirm('');
    onSuccess?.();
  };

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="pw-curr">Current / temporary password</label>
        <PasswordInput
          id="pw-curr"
          autoComplete="current-password"
          placeholder="Enter current password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="pw-new">New password (min. 8 characters)</label>
        <PasswordInput
          id="pw-new"
          autoComplete="new-password"
          placeholder="Enter new password"
          value={nextPass}
          onChange={(e) => setNextPass(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="pw-conf">Confirm new password</label>
        <PasswordInput
          id="pw-conf"
          autoComplete="new-password"
          placeholder="Re-enter new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <KeyRound size={16} aria-hidden="true" /> {busy ? 'Updating...' : 'Update password'}
        </button>
      </div>
    </form>
  );
}

export function ForcePasswordChange() {
  const { user, logout } = useAuth();
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--cream)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 440 }}>
        <div className="session-head">
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: '1.4rem' }}>Choose your password</h1>
            <p className="muted" style={{ margin: 0 }}>
              Signed in as <strong>{user.name}</strong> (<code>{user.username}</code>). Your account has a temporary
              password—set your own password before accessing the system.
            </p>
          </div>
        </div>
        <PasswordForm />
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12, textAlign: 'right' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={logout}>
            <LogOut size={15} aria-hidden="true" /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MyAccount() {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>My account</h1>
          <p className="muted" style={{ margin: 0 }}>
            View your profile details and update your sign-in password.
          </p>
        </div>
      </div>

      {saved && (
        <div className="notice notice-ok" role="status">
          <span>Password updated. Any other active sessions on other devices have been signed out.</span>
          <button type="button" className="icon-btn" onClick={() => setSaved(false)} aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="charts-grid" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="section-head" style={{ marginTop: 0 }}>
            <UserCheck size={18} aria-hidden="true" />
            <h2 style={{ margin: 0 }}>Profile details</h2>
          </div>
          <ul className="list">
            <li>
              <span className="muted">Full name</span>
              <strong>{user.name}</strong>
            </li>
            <li>
              <span className="muted">Username</span>
              <code>{user.username}</code>
            </li>
            <li>
              <span className="muted">Role</span>
              <StatusBadge tone="info">{ROLE_LABELS[user.role] || user.role}</StatusBadge>
            </li>
          </ul>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Change password</h2>
          <p className="muted">
            Changing your password immediately signs out any other open sessions for your account.
          </p>
          <PasswordForm onSuccess={() => setSaved(true)} />
        </div>
      </div>
    </section>
  );
}