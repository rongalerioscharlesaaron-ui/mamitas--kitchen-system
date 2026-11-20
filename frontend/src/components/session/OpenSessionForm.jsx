import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { useSession } from '../../context/SessionContext';
import { SHOP } from '../../config/shop';

const QUICK_FLOATS = [0, 50, 100, 200];

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
  };

  return (
    <form className="card open-session" onSubmit={submit} noValidate>
      <div className="open-session-head">
        <span className="open-session-icon" aria-hidden="true"><Wallet size={20} /></span>
        <div>
          <h2>{title}</h2>
          <p className="muted" style={{ margin: 0 }}>
            Count the cash in your drawer to record Time IN and unlock POS ordering.
          </p>
        </div>
      </div>

      <div className="field">
        <label htmlFor="os-cash">Opening cash in the drawer ({SHOP.currency})</label>
        <input
          id="os-cash" type="number" min="0" step="0.01" placeholder="0.00" value={cash}
          onChange={(e) => setCash(e.target.value)} autoFocus
        />
        <div className="quick" role="group" aria-label="Quick opening float presets">
          {QUICK_FLOATS.map((amt) => (
            <button
              key={amt}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { setCash(String(amt)); setError(''); }}
            >
              ${amt}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <button className="btn btn-primary btn-lg" type="submit" disabled={busy} style={{ width: '100%' }}>
        {busy ? 'Starting...' : 'Start session'}
      </button>
    </form>
  );
}