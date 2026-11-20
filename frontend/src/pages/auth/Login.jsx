import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, Lock, User } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import mamitasLogo from '../../assets/mamitas-logo.png';

export default function Login() {
  const { user, loading, login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">Loading...</p>
      </div>
    );
  }

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await login(username.trim(), password);
    setBusy(false);
    if (!result.ok) setError(result.message);
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        {/* Left Brand Panel */}
        <div className="login-showcase">
          <div className="login-logo-frame">
            <img
              src={mamitasLogo}
              alt="Mamita's Kitchen Logo"
              className="login-logo-img"
            />
          </div>
          <p className="login-tagline">
            Mamita's Inventory & POS System
          </p>
          <div className="login-accent-bar" aria-hidden="true" />
        </div>

        {/* Right Form Panel */}
        <form className="login-form-panel" onSubmit={handleSubmit} noValidate>
          <div className="login-header">
            <h1>Welcome Back</h1>
            <p className="muted">Sign in </p>
          </div>

          {error && (
            <div className="login-alert" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="field">
            <label htmlFor="username">Username</label>
            <div className="input-wrap">
              <User size={18} className="input-icon" aria-hidden="true" />
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
                autoFocus
                aria-invalid={Boolean(error)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="input-wrap">
              <Lock size={18} className="input-icon" aria-hidden="true" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                aria-invalid={Boolean(error)}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            className="btn btn-primary login-submit"
            type="submit"
            disabled={busy}
          >
            {busy ? 'Signing in...' : 'Log in'}
          </button>

          <p className="login-footer-note">
            Authorized Personnel Only
          </p>
        </form>
      </div>
    </div>
  );
}