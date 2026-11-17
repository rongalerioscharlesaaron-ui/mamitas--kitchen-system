import { useState } from 'react';
import { useSession } from '../../context/SessionContext';

export default function OpenSessionForm({ title = 'Start your shift' }) {
  const { openSession } = useSession();
  const [cash, setCash] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (cash === '') {
      setError('Enter the cash in the drawer. Enter 0 if it is empty.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await openSession(cash);
    setBusy(false);
    if (!result.ok) setError(result.message);
    // on success the page switches to the current session by itself
  };

  return (
    <form className="card open-session" onSubmit={submit} noValidate>
      <h2>{title}</h2>
      <p className="muted">
        Count the cash in your drawer and enter it below. Your Time IN is recorded when you start. You need an open
        session to take orders.
      </p>
      <div className="field">
        <label htmlFor="os-cash">Opening cash in the drawer (SGD)</label>
        <input
          id="os-cash" type="number" min="0" step="0.01" value={cash}
          onChange={(e) => setCash(e.target.value)} autoFocus
        />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
        {busy ? 'Starting...' : 'Start session'}
      </button>
    </form>
  );
}