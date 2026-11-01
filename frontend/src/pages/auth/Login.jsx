import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChefHat } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    const result = login(username.trim(), password);
    if (result.ok) navigate('/', { replace: true });
    else setError(result.message);
  };

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={handleSubmit} noValidate>
        <div className="login-brand">
          <span className="brand-mark"><ChefHat size={22} aria-hidden="true" /></span>
          <div>
            <h1>Mamitas’ Kitchen</h1>
            <p className="muted">Sign in to your account</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            aria-invalid={Boolean(error)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={Boolean(error)}
          />
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <button className="btn btn-primary" type="submit" style={{ width: '100%' }}>
          Log in
        </button>

        <div className="demo-box">
          <p><strong>Demo accounts (testing only)</strong></p>
          <p>cashier / cashier123</p>
          <p>kitchen / kitchen123</p>
          <p>owner / owner123</p>
        </div>
      </form>
    </div>
  );
}